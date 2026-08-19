------------------------------------------------------------------------------
-- REVERT for 0061_ratings_score_integrity.sql (goal g-575e68bb, staging)
------------------------------------------------------------------------------
-- Recorded BEFORE applying, per the T0 gate. Rollback must be one step.
--
-- Pre-apply state, verified read-only on 2026-08-19 against the staging
-- target (project ref wqxo…gby, aws-0-ca-central-1 pooler):
--   * NO constraint named ratings_score_range existed.
--   * 18 rows in public.ratings; 2 of them had score IS NULL, both tier='loved'.
--   * 0 rows outside 1.0-10.0.
--
-- WHAT THIS UNDOES, AND WHAT IT CANNOT.
-- Dropping the constraint is exact. The backfill is NOT losslessly reversible
-- in general: once a null becomes 9.0 we can no longer distinguish it from a
-- 9.0 the user actually earned. It is reversible HERE only because the exact
-- pre-apply null set is known and small, and is pinned below by primary key.
-- If this revert is ever needed on a database whose null set was not captured
-- first, restore the backfilled rows from a backup instead of guessing.

begin;

-- 1. The constraint (exact inverse of step 3).
alter table public.ratings
  drop constraint if exists ratings_score_range;

-- 2. The backfill. Re-null ONLY the rows this migration filled. Fill the id
--    list from the capture taken immediately before applying:
--
--      select id, user_id, bar_id, tier from public.ratings where score is null;
--
--    Paste those ids here before running. An EMPTY list is a no-op, which is
--    safer than a predicate like "where score = 9.0 and tier = 'loved'" —
--    that would also blank genuinely-scored rows.
--
-- CAPTURED 2026-08-19, immediately before applying. These are the exact two
-- rows that had score IS NULL on staging. Uncomment to revert the backfill.
--
-- update public.ratings set score = null where id in (
--   '11d5a1a8-fc66-45ee-a36a-585c570c4159',  -- tier=loved, bar_id=smithfield-hall
--   'c623ce6a-9d36-4701-a9cf-aa2b01d54d69'   -- tier=loved, bar_id=bar-54
-- );

commit;
