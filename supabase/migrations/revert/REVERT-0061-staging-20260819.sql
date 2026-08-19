------------------------------------------------------------------------------
-- REVERT for 0061_ratings_score_integrity.sql (goal g-575e68bb, STAGING)
------------------------------------------------------------------------------
-- Runnable as-is. Rewritten 2026-08-19 after an independent review found the
-- first draft was a no-op twice over: the backfill undo was commented out, and
-- even uncommented it would have been silently skipped by the LWW trigger.
--
-- Pre-apply state, captured read-only BEFORE the first apply:
--   * NO constraint named ratings_score_range existed.
--   * 18 rows in public.ratings; exactly 2 had score IS NULL, both tier='loved':
--       11d5a1a8-fc66-45ee-a36a-585c570c4159  (bar_id smithfield-hall)
--       c623ce6a-9d36-4701-a9cf-aa2b01d54d69  (bar_id bar-54)
--   * 0 rows outside 1.0-10.0.
--
-- ⚠ WHAT THIS CANNOT RESTORE. The pre-apply `updated_at` values were NOT
-- captured, and the first apply advanced them (it used greatest(now(), …),
-- since corrected). Restoring score to NULL is therefore exact; restoring the
-- original updated_at is NOT possible from this file. On a database where that
-- matters, restore from a backup instead of running this.
------------------------------------------------------------------------------

begin;

-- 1. The constraint. Exact inverse of the migration's step 3.
alter table public.ratings
  drop constraint if exists ratings_score_range;

-- 2. The backfill. LWW-AWARE: `ratings_lww` (0005) is a BEFORE UPDATE trigger
--    whose function RETURNS NULL — silently skipping the row — unless
--    new.updated_at > old.updated_at. Without the bump below this statement
--    would report success and change nothing, which is the exact false green
--    that made this revert necessary to rewrite.
--
--    Selected by the two PINNED ids, never by a predicate like
--    "score = 9.0 and tier = 'loved'" — that would also blank rows the user
--    genuinely earned a 9.0 on.

update public.ratings
   set score = null,
       updated_at = updated_at + interval '1 microsecond'
 where id in (
   '11d5a1a8-fc66-45ee-a36a-585c570c4159',
   'c623ce6a-9d36-4701-a9cf-aa2b01d54d69'
 );

-- 3. Prove step 2 actually wrote. A revert that silently skips is worse than
--    no revert, because it reports success.

do $$
declare
  reverted bigint;
begin
  select count(*) into reverted
    from public.ratings
   where id in ('11d5a1a8-fc66-45ee-a36a-585c570c4159',
                'c623ce6a-9d36-4701-a9cf-aa2b01d54d69')
     and score is null;

  if reverted <> 2 then
    raise exception
      'revert did not land: expected 2 rows back to NULL, found %. The LWW '
      'trigger most likely skipped the update.', reverted;
  end if;
end
$$;

-- 4. The ledger. DEFENSIVE, and on staging today a no-op — verified 2026-08-19
--    that public.schema_migrations holds NO 0061 row, because this file was
--    applied with apply-one-migration.mts, which does not write the ledger;
--    only apply-migration-set.ts does (scripts/apply-migration-set.ts:265).
--    Kept anyway so this revert is still correct if 0061 is later promoted
--    through the SET path, which WOULD record it. Column is `name`, and the
--    recorded value is the bare filename (e.g. '0059_night_outs_respond_revision.sql').

delete from public.schema_migrations
 where name = '0061_ratings_score_integrity.sql';

commit;
