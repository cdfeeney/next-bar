------------------------------------------------------------------------------
-- 0051_night_outs_suggest_recheck_before_cap.sql — the seam 0050 missed
------------------------------------------------------------------------------
-- Eighth file. 0044-0050 are applied and checksum-recorded, so they are
-- immutable and corrections are additive. Apply the run in ONE transaction on a
-- database that has none of them.
--
-- **CORRECTION TO 0050's HEADER.** 0050 calls itself "the last check-then-act
-- seam". That was wrong when it was written, and 0050 is applied and therefore
-- cannot be edited to say so — this header is the correction. A cold review of
-- the whole tree (Claude) found `suggest_night_out_bar` carrying the identical
-- shape, and it had been carrying it since 0044 while four separate fixes went
-- past it. Do not read 0050's claim as a survey; it was an assumption made
-- while fixing the fourth instance.
--
-- The defect (cold panel, Claude, medium): the "idempotent re-suggest never
-- spends the cap" check runs BEFORE the advisory lock. At the 3-per-member
-- boundary:
--
--   A: suggest bar X, holds its transaction open (takes the per-(plan,user)
--      lock, inserts X as the member's third suggestion)
--   B: suggest bar X too — misses the pre-lock exists check, waits on the lock
--   A: COMMIT — the member now has 3 live suggestions and X IS on the board
--   B: proceeds, counts 3, hits the cap, returns FALSE
--
-- B's caller asked "is X suggested?" and the honest answer is yes. Returning
-- false contradicts this function's own documented contract — an idempotent
-- re-suggest is supposed to return true and never spend the cap — and it is the
-- same class as the criterion-8 HIGH: a question answered before the lock, then
-- acted on after it.
--
-- Same fix as 0048 (join) and 0050 (invite): re-read your own subject under the
-- lock and answer the caller's actual question before asking about capacity,
-- because a suggestion that already exists consumes no NEW capacity.
--
-- Everything else in the body is 0044's, unchanged — including the per-(plan,
-- user) lock key and the `found` gate on the event, both of which are load
-- bearing for reasons 0044 documents.
------------------------------------------------------------------------------

create or replace function public.suggest_night_out_bar(
  p_night_out uuid,
  p_bar text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  suggestion_cap constant integer := 3;  -- live suggestions per member/plan
  v_uid uuid := auth.uid();
  v_live integer;
begin
  if v_uid is null or p_night_out is null
     or p_bar is null or p_bar !~ '^[a-z0-9-]{1,60}$' then
    return false;
  end if;
  if public.night_out_role(p_night_out) is null then
    return false;  -- criterion 10
  end if;
  if not exists (
    select 1 from public.night_outs n
     where n.id = p_night_out and n.status in ('draft', 'open')
  ) then
    return false;
  end if;

  -- Fast path (optimisation only): an idempotent re-suggest never spends the
  -- cap (0011 pattern).
  if exists (
    select 1 from public.night_out_suggestions s
     where s.night_out_id = p_night_out and s.bar_id = p_bar
  ) then
    return true;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('night_out_suggestions:' || p_night_out::text || ':' || v_uid::text, 0));

  -- Re-read under the lock. A row here means the bar reached the board while we
  -- waited — the caller's request is already satisfied and no capacity is being
  -- spent, so this returns BEFORE the cap check. That ordering is the fix.
  if exists (
    select 1 from public.night_out_suggestions s
     where s.night_out_id = p_night_out and s.bar_id = p_bar
  ) then
    return true;
  end if;

  select count(*) into v_live
    from public.night_out_suggestions s
   where s.night_out_id = p_night_out and s.suggested_by = v_uid;
  if v_live >= suggestion_cap then
    return false;
  end if;

  insert into public.night_out_suggestions (night_out_id, bar_id, suggested_by)
  values (p_night_out, p_bar, v_uid)
  on conflict on constraint night_out_suggestions_pkey do nothing;

  -- Event only when a row was actually created. The advisory lock above is
  -- keyed per (plan, USER), so two DIFFERENT members racing on the same bar
  -- never serialize against each other: both pass the pre-insert exists check,
  -- one insert loses the conflict, and without this gate the loser still
  -- appended a second 'bar_suggested' event attributed to the wrong actor.
  if found then
    insert into public.night_out_events (night_out_id, actor_id, kind, bar_id)
    values (p_night_out, v_uid, 'bar_suggested', p_bar);
  end if;
  return true;
end;
$$;

revoke all on function public.suggest_night_out_bar(uuid, text) from public, anon, authenticated;
grant execute on function public.suggest_night_out_bar(uuid, text) to authenticated;
