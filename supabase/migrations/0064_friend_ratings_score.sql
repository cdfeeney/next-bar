-- Next Bar — 0064 friend-visible numeric score
--
-- Founder decision 2026-08-19 (Option B). Group Favorites needs every group
-- member's numeric score for the unanimous `>= 8.0` rule, and night-out
-- planning needs friend scores to influence which bars get suggested. A
-- derived boolean cannot do the second job, so the RAW score crosses.
--
-- THIS SUPERSEDES 0007's "the `score` column must NEVER be added here" rule,
-- FOR THE FRIEND SURFACE ONLY. 0007's file is deliberately NOT edited: it is
-- in the applied `public.schema_migrations` ledger and its checksum is part of
-- that record. This file is the current statement of the rule.
--
-- WHAT DOES NOT CHANGE — this widens COLUMNS, never the audience:
--   * The gate is 0007's edge, byte for byte: a row is returned only when the
--     caller FOLLOWS its owner (`follows.follower_id = auth.uid()`). Not one
--     additional account can read anything after this migration that could not
--     read the tier before it. A pending `follow_requests` row is not a follow
--     and grants nothing; deleting the `follows` row stops the grant on the
--     next call, because the gate is evaluated per call and caches nothing.
--   * The MATERIALIZED fence (DeepSeek review, 0007). PostgreSQL marks uuid
--     `=` LEAKPROOF, so without the fence the planner pushes a caller's
--     `where user_id = X` below the EXISTS gate — a timing side-channel
--     probing whether an UNFOLLOWED user has ratings. Carrying a second
--     column makes that worse, not better, so the fence stays.
--   * The grants: revoked from `public` and `anon`, EXECUTE to `authenticated`
--     only. An unauthenticated caller gets `permission denied`, not an empty
--     set, and `auth.uid()` is NULL for it in any case.
--
-- STILL FORBIDDEN — every PUBLIC surface stays tier-only, and this migration
-- touches none of them: 0015's `get_public_ratings()` (anon-readable, opted-in
-- profiles) and 0016's shared nights. Widening either is a different decision
-- than the one the founder made, and was not made.
--
-- WHY DROP AND RECREATE. `create or replace function` cannot change a
-- RETURNS TABLE signature — Postgres raises "cannot change return type of
-- existing function" — so the old definition is dropped first. Nothing in the
-- database depends on it (0007 already dropped the `friend_ratings` view); the
-- only callers are application code. The function is absent for the width of
-- this transaction, during which a concurrent call errors rather than
-- returning wrong rows.
--
-- 0005's `ratings_lww` BEFORE UPDATE trigger RETURNS NULL — silently skipping
-- the row, reporting success — for any update that does not bump
-- `updated_at`. Checked, per the goal's instruction not to assume: this
-- migration UPDATEs no rows at all. It is one function definition plus grants,
-- so the trap does not apply here.
--
-- Idempotent: drop if exists + create or replace + revoke/grant. Safe to
-- re-run.

drop function if exists public.get_friend_ratings();

create or replace function public.get_friend_ratings()
returns table (user_id uuid, bar_id text, tier text, score numeric, rated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with gated as materialized (
    select r.user_id, r.bar_id, r.tier::text, r.score, r.rated_at
      from public.ratings r
     where exists (
       select 1
         from public.follows f
        where f.follower_id = auth.uid()
          and f.followee_id = r.user_id
     )
  )
  select * from gated;
$$;

comment on function public.get_friend_ratings() is
  'Friend-visible ratings: tier AND numeric score, for accounts the caller '
  'follows (0007''s edge, unchanged). Founder decision 2026-08-19, Option B. '
  'The audience must not be widened here, and the anonymous surface '
  '(0015 get_public_ratings) stays tier-only.';

revoke all on function public.get_friend_ratings() from public, anon;
grant execute on function public.get_friend_ratings() to authenticated;

------------------------------------------------------------------------------
-- Rollback: supabase/migrations/revert/revert-0064-transaction.sql. Read
-- revert/README.md before running it; that file is the single source for the
-- command and for what the revert costs.
--
-- NOT restated here as an executable recipe, breaking this repository's
-- "rollback in comments, per convention" habit on purpose. An earlier version
-- of this block listed a body swap alone - drop the function, re-apply 0007's
-- definition - and omitted deleting this migration's row from
-- public.schema_migrations. Following it produces exactly the split the revert
-- script's own header names as the hazard: the ledger still claiming 0064
-- while the friend read returns no score, check:migrations green over a false
-- picture, and a re-apply refused because the file reads as already applied.
-- The restore and the ledger delete MUST be one transaction, which a comment
-- cannot enforce and the script does.
------------------------------------------------------------------------------
