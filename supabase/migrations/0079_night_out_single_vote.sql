-- 0079 — one vote per person on the shortlist, and it moves (S-07b).
--
-- Owner, 2026-09-16: "the one vote sounds good to me, we should be able to swap
-- votes." README §7: tapping a new bar moves your vote off the old one; tapping
-- your current one clears it.
--
-- 0044's vote_night_out_bar (replaced forward in 0068 to take the shortlist
-- advisory lock) is insert-only: one row per (plan, bar, member), ON CONFLICT
-- DO NOTHING, and nothing clears a member's vote except removing the bar. So a
-- member could hold several votes on one plan and could never take one back.
--
-- WHAT CHANGES. Inside the SAME lock and the same guards, vote_night_out_bar
-- now deletes the caller's vote on any OTHER bar of the plan before inserting
-- on the chosen one, so at most one row per (plan, member) results from any
-- sequence of calls. unvote_night_out_bar clears the caller's vote on a bar
-- while voting is open. get_night_out_board is untouched: votes and
-- caller_voted read exactly as before.
--
-- EXISTING ROWS. A member may already hold several votes on one plan (the old
-- writer allowed it). The reconciliation below keeps each member's MOST RECENT
-- vote per plan (ties broken by bar id, so exactly one survives) and drops the rest, then adds the unique index that makes the
-- rule structural. It runs once; on a second apply the delete matches nothing
-- and the index already exists. Pre-count + db:dump are recorded before the
-- owner applies it (guard-db-write consent lives in the session env).
--
-- Applied to STAGING on the owner's word; production gets the same file as its
-- own explicitly authorised step, before any production deploy that carries
-- the moving vote.

------------------------------------------------------------------------------
-- 1. Reconcile, then make one-vote-per-member structural.
------------------------------------------------------------------------------

delete from public.night_out_votes v
 using (
   select ctid,
          row_number() over (
            partition by night_out_id, user_id
            order by created_at desc, bar_id asc
          ) as rn
     from public.night_out_votes
 ) d
 where v.ctid = d.ctid
   and d.rn > 1;

create unique index if not exists night_out_votes_one_per_member
  on public.night_out_votes (night_out_id, user_id);

comment on index public.night_out_votes_one_per_member is
  'S-07b (0079). One vote per member per plan — the moving vote. vote_night_out_bar moves it; unvote_night_out_bar clears it.';

------------------------------------------------------------------------------
-- 2. vote_night_out_bar — MOVE the caller's vote to p_bar.
------------------------------------------------------------------------------

create or replace function public.vote_night_out_bar(
  p_night_out uuid,
  p_bar text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_night_out is null
     or p_bar is null or p_bar !~ '^[a-z0-9-]{1,60}$' then
    return false;
  end if;
  if public.night_out_role(p_night_out) is null then
    return false;  -- criterion 10
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('night_out_shortlist:' || p_night_out::text, 0));

  if not public.night_out_voting_open(p_night_out) then
    return false;
  end if;
  if not exists (
    select 1 from public.night_out_suggestions s
     where s.night_out_id = p_night_out and s.bar_id = p_bar
  ) then
    return false;
  end if;

  -- The move: whatever the caller held on another bar of this plan goes first,
  -- inside the lock, so no reader ever sees two votes from one member.
  delete from public.night_out_votes
   where night_out_id = p_night_out
     and user_id = v_uid
     and bar_id <> p_bar;

  insert into public.night_out_votes (night_out_id, bar_id, user_id)
  values (p_night_out, p_bar, v_uid)
  on conflict on constraint night_out_votes_pkey do nothing;
  return true;
end;
$$;

comment on function public.vote_night_out_bar(uuid, text) is
  '0044''s vote writer, replaced forward in 0068 (shortlist advisory lock) and again in 0079 (S-07b): the caller''s vote MOVES to p_bar — any vote they held on another bar of this plan is deleted in the same locked section. Same guards as before: member, voting open, bar on the shortlist.';

revoke all on function public.vote_night_out_bar(uuid, text) from public, anon, authenticated;
grant execute on function public.vote_night_out_bar(uuid, text) to authenticated;

------------------------------------------------------------------------------
-- 3. unvote_night_out_bar — CLEAR the caller's vote on p_bar.
------------------------------------------------------------------------------

create or replace function public.unvote_night_out_bar(
  p_night_out uuid,
  p_bar text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_night_out is null
     or p_bar is null or p_bar !~ '^[a-z0-9-]{1,60}$' then
    return false;
  end if;
  if public.night_out_role(p_night_out) is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('night_out_shortlist:' || p_night_out::text, 0));

  if not public.night_out_voting_open(p_night_out) then
    return false;
  end if;

  delete from public.night_out_votes
   where night_out_id = p_night_out
     and bar_id = p_bar
     and user_id = v_uid;
  return found;
end;
$$;

comment on function public.unvote_night_out_bar(uuid, text) is
  'S-07b (0079). Clears the caller''s own vote on p_bar while voting is open; false when there was none, the plan is closed, or the caller is not a member. Takes the shortlist advisory lock like the voter and the lock.';

revoke all on function public.unvote_night_out_bar(uuid, text) from public, anon;
grant execute on function public.unvote_night_out_bar(uuid, text) to authenticated;
