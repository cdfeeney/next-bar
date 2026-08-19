------------------------------------------------------------------------------
-- 0057_night_outs_respond_expected_status.sql — a replay cannot undo a decision
------------------------------------------------------------------------------
-- NUMBERING: this is 0057, not 0055, on purpose. 0055 and 0056 are taken by the
-- V8-4 branch (native device tokens, notification outbox) — unapplied, but
-- committed there. Those two already collided with this branch's 0051/0052 once
-- and had to be renumbered; leaving a gap costs nothing and a second collision
-- costs a merge. Ledger head on the serving database is 0054.
--
-- (Cold panel, Codex, HIGH) respond_night_out takes no request identity and no
-- expected state, so it treats every call as current intent:
--
--   1. Invitee accepts     -> accepted
--   2. Invitee declines    -> declined      (their real, later decision)
--   3. The step-1 request is REPLAYED — a retried fetch, a double tap, a
--      request that sat in a queue — and the row goes back to accepted,
--      with a second 'accepted' event recorded.
--
-- Criterion 8 is explicit that an idempotent no-op "must not lose a legitimate
-- later state change", and this loses exactly that: the person said no and the
-- system recorded yes. It is also the worst kind of wrong, because it reverses
-- a CONSENT decision rather than a preference.
--
-- The fix is optimistic concurrency: the caller states which state it was
-- looking at when the user acted. A replay carries the state from BEFORE the
-- decline, no longer matches, and is refused. The UI always knows this — the
-- invitation card and the plan page both render from `invite_status`.
--
-- The two-argument overload is dropped. Leaving it would leave the hole open
-- for any caller that simply omits the argument, which is how the unprotected
-- create path survived until 0054 removed it.
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

drop function if exists public.respond_night_out(uuid, boolean);

revoke all on function public.respond_night_out(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.respond_night_out(uuid, boolean, text) to authenticated;
