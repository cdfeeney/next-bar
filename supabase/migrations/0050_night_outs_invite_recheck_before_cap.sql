------------------------------------------------------------------------------
-- 0050_night_outs_invite_recheck_before_cap.sql — the last check-then-act seam
------------------------------------------------------------------------------
-- Seventh file. 0044-0049 are applied and checksum-recorded, so they are
-- immutable and corrections are additive. Apply the run in ONE transaction on a
-- database that has none of them.
--
-- (Cold whole-artifact panel, Codex, medium) `invite_to_night_out` re-checks
-- nothing after taking the advisory lock. With 19 seats occupied:
--
--   A: invite U, holds its transaction open (takes the lock, inserts U pending)
--   B: invite U as well — misses the pre-lock duplicate check, waits on the lock
--   A: COMMIT — seats are now 20 and U IS ALREADY A MEMBER
--   B: proceeds, counts 20, returns FALSE
--
-- B's caller asked "is U invited?" and the honest answer is yes — U is invited,
-- by A, right now. Returning false says the invite failed, which the docstring
-- and criterion 8 both say a duplicate invite must never do: it is supposed to
-- be an idempotent no-op returning true.
--
-- This is the SAME shape as the original criterion-8 HIGH and as 0048's fix for
-- join: a membership question answered before the lock, then acted on after it.
-- 0048 fixed it for join and rejoin; invite kept the stale pre-lock answer. The
-- fix is identical in spirit — re-read your own subject under the lock, and
-- answer the caller's actual question before asking about capacity, because an
-- already-present member consumes no NEW seat.
------------------------------------------------------------------------------

create or replace function public.invite_to_night_out(
  p_night_out uuid,
  p_user uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_night_out is null or p_user is null then
    return false;
  end if;
  if public.night_out_role(p_night_out) is null then
    return false; -- criterion 3/10: nonmembers cannot act
  end if;
  if not exists (
    select 1 from public.night_outs n
     where n.id = p_night_out and n.status in ('draft', 'open')
  ) then
    return false;
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then
    return false;
  end if;

  -- Fast path (optimisation only): a row of ANY status is left alone, so a
  -- duplicate invite never overwrites a state the user chose (criterion 8).
  if exists (
    select 1 from public.night_out_members m
     where m.night_out_id = p_night_out and m.user_id = p_user
  ) then
    return true;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('night_out_members:' || p_night_out::text, 0));

  -- Re-read under the lock. A row here is a racing invite that committed
  -- between the fast path and the lock — the target IS invited, so the answer
  -- is true and no seat is being taken. Asking about capacity first is what
  -- turned a duplicate invite into a reported failure at the boundary.
  if exists (
    select 1 from public.night_out_members m
     where m.night_out_id = p_night_out and m.user_id = p_user
  ) then
    return true;
  end if;

  -- Genuinely a new member: now capacity is the right question.
  if public.night_out_seat_count(p_night_out) >= public.night_out_member_cap() then
    return false;
  end if;

  insert into public.night_out_members
    (night_out_id, user_id, invited_by)
  values (p_night_out, p_user, v_uid)
  on conflict on constraint night_out_members_pkey do nothing;

  if found then
    insert into public.night_out_events (night_out_id, actor_id, kind)
    values (p_night_out, v_uid, 'invited');
  end if;
  return true;
end;
$$;

revoke all on function public.invite_to_night_out(uuid, uuid) from public, anon, authenticated;
grant execute on function public.invite_to_night_out(uuid, uuid) to authenticated;
