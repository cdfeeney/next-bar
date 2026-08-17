------------------------------------------------------------------------------
-- 0058_night_outs_respond_expected_status_atomic.sql — the guard moves into the write
------------------------------------------------------------------------------
-- (Panel round 1 on candidate 4bf6e108, HIGH, found independently by Codex
-- gpt-5.6-sol and Claude claude-fable-5, then REPRODUCED against the serving
-- database.) 0057 checks p_expected_status against a NON-LOCKING read and then
-- issues an UPDATE whose own predicate is only `invite_status <> v_new`. The
-- expected status never reaches the write, and the decline path takes no
-- advisory lock (0057 takes it only when accepting). So:
--
--   1. Accept and decline race. The accept blocks on the decline's row lock.
--   2. The decline commits: invite_status = 'declined'.
--   3. Under READ COMMITTED the blocked accept is re-evaluated by EvalPlanQual
--      against the POST-COMMIT row. 'declined' <> 'accepted' passes.
--   4. The committed decline is overwritten and a second 'accepted' event is
--      logged. Observed: final invite_status = accepted, events =
--      [accepted x1, invited x1].
--
-- 0057's own comment says a call carrying a stale view "is refused rather than
-- applied" — that is exactly right, and this makes it true of the write as well
-- as the read. One added predicate; everything else is 0057 verbatim.
--
-- `<> v_new` stays: when p_expected_status already equals v_new (a user
-- re-submitting a decision they have made) it still suppresses the redundant
-- write and the duplicate 'accepted' event.
--
-- NUMBERING: ledger head on the serving database is 0057. 0055/0056 belong to
-- the V8-4 branch and are applied nowhere.
------------------------------------------------------------------------------

create or replace function public.respond_night_out(
  p_night_out uuid,
  p_accept boolean,
  p_expected_status text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new text := case when p_accept then 'accepted' else 'declined' end;
  v_current text;
  v_changed boolean;
begin
  if v_uid is null or p_night_out is null or p_accept is null then
    return false;
  end if;
  if p_expected_status is null
     or p_expected_status not in ('pending', 'accepted', 'declined') then
    return false;
  end if;
  -- A cancelled plan takes no further responses.
  if not exists (
    select 1 from public.night_outs n
     where n.id = p_night_out and n.status <> 'cancelled'
  ) then
    return false;
  end if;

  if p_accept then
    -- Same lock every other membership-count decision takes, held for the
    -- read-then-write below so two rejoins cannot both see room for one seat.
    perform pg_advisory_xact_lock(
      hashtextextended('night_out_members:' || p_night_out::text, 0));
  end if;

  -- Read the current state under the lock when accepting, and plainly when
  -- declining. The expected-state check happens HERE, before any write: a call
  -- carrying a stale view of the world is refused rather than applied.
  select m.invite_status into v_current
    from public.night_out_members m
   where m.night_out_id = p_night_out and m.user_id = v_uid;

  if v_current is null then
    return false;  -- not a member; nothing to respond to
  end if;
  if v_current <> p_expected_status then
    -- The caller acted on a state that is no longer true. This is the replay
    -- case, and it is also a stale UI: either way the honest answer is no.
    return false;
  end if;

  if p_accept and v_current = 'declined'
     and public.night_out_seat_count(p_night_out) >= public.night_out_member_cap() then
    return false;  -- rejoining is taking a seat, and there is none
  end if;

  update public.night_out_members m
     set invite_status = v_new, responded_at = now()
   where m.night_out_id = p_night_out
     and m.user_id = v_uid
     and m.role <> 'owner'          -- the owner cannot decline their own plan
     and m.invite_status = p_expected_status  -- the guard belongs in the WRITE, not only the read
     and m.invite_status <> v_new;
  v_changed := found;
  if v_changed and p_accept then
    insert into public.night_out_events (night_out_id, actor_id, kind)
    values (p_night_out, v_uid, 'accepted');
  end if;
  -- true when the row ends at the requested state (changed OR already there);
  -- false only for nonmembers and an owner trying to decline their own plan.
  return v_changed or exists (
    select 1 from public.night_out_members m
     where m.night_out_id = p_night_out
       and m.user_id = v_uid
       and m.invite_status = v_new
  );
end;
$$;

revoke all on function public.respond_night_out(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.respond_night_out(uuid, boolean, text) to authenticated;
