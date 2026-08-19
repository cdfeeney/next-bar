------------------------------------------------------------------------------
-- REVERT for 0061_ratings_score_integrity.sql (goal g-575e68bb, STAGING)
------------------------------------------------------------------------------
-- Runnable as-is, and it REFUSES rather than guesses.
--
-- Two independent reviews shaped this file. The first draft was a no-op twice
-- over (undo commented out, and skipped by the LWW trigger even uncommented).
-- The second draft was runnable but destructive: it blanked the pinned rows
-- unconditionally, so a score the user had legitimately written since the
-- migration would be erased, and the assertion still passed.
--
-- Pre-apply state, captured read-only BEFORE the first apply:
--   * NO constraint named ratings_score_range existed.
--   * 18 rows in public.ratings; exactly 2 had score IS NULL, both tier='loved':
--       11d5a1a8-fc66-45ee-a36a-585c570c4159  (bar_id smithfield-hall)
--       c623ce6a-9d36-4701-a9cf-aa2b01d54d69  (bar_id bar-54)
--   * 0 rows outside 1.0-10.0.
--
-- Post-apply fingerprint, captured after the final apply — this is the fence:
--   both rows: score = 9.0, updated_at = 2026-08-19 19:18:40.661073+00
--   (captured via updated_at::text — a JS Date round-trip truncates to
--    milliseconds and the fence then matches NOTHING, which the revert's own
--    test caught before this file was trusted)
--
-- ⚠ WHAT THIS CANNOT RESTORE. The pre-apply `updated_at` values were never
-- captured, so this file restores score exactly but NOT the original
-- timestamps. Where that matters, restore from a backup instead.
------------------------------------------------------------------------------

begin;

------------------------------------------------------------------------------
-- 1. The constraint. Exact inverse of the migration's step 3.
------------------------------------------------------------------------------

alter table public.ratings
  drop constraint if exists ratings_score_range;

------------------------------------------------------------------------------
-- 2. The backfill undo — fenced, LWW-aware, and self-checking
------------------------------------------------------------------------------
-- LWW: `ratings_lww` (0005) is a BEFORE UPDATE trigger whose function RETURNS
-- NULL — silently skipping the row — unless new.updated_at > old.updated_at.
-- Without the bump this statement would report success and change nothing.
--
-- FENCE: the pinned ids prove what these rows looked like BEFORE the apply,
-- not that they still hold the backfill's output. Matching also on score 9.0
-- AND the exact updated_at the backfill wrote means any later legitimate write
-- moves the row out of range, zero rows change, and the check below RAISES.
-- Refusing is correct; blanking a score the user has since earned is not a
-- revert, it is data loss wearing a revert's name.

do $$
declare
  reverted bigint;
begin
  update public.ratings
     set score = null,
         updated_at = updated_at + interval '1 microsecond'
   where id in ('11d5a1a8-fc66-45ee-a36a-585c570c4159',
                'c623ce6a-9d36-4701-a9cf-aa2b01d54d69')
     and score = 9.0
     and updated_at = timestamptz '2026-08-19 19:18:40.661073+00';

  -- Count what THIS statement changed, never "are both rows NULL now" — that
  -- question passes when the revert worked AND when it clobbered a real score.
  get diagnostics reverted = row_count;

  if reverted <> 2 then
    raise exception
      'revert did not land: % of 2 rows changed. Either the LWW trigger '
      'skipped the update, or a row no longer matches the post-apply '
      'fingerprint (score 9.0 at the recorded updated_at) because something '
      'has written to it since. DO NOT widen the predicate to force it — '
      'inspect the rows first.', reverted;
  end if;
end
$$;

------------------------------------------------------------------------------
-- 3. The ledger — defensive; on staging today a no-op
------------------------------------------------------------------------------
-- Verified 2026-08-19 that public.schema_migrations holds NO 0061 row: this
-- file was applied with apply-one-migration.mts, which neither reads nor
-- writes the ledger. Only apply-migration-set.ts does
-- (scripts/apply-migration-set.ts:191 checks, :265 records). Kept so this
-- revert stays correct if 0061 is later promoted through the SET path, which
-- WOULD record it. Column is `name`; the value is the bare filename.

delete from public.schema_migrations
 where name = '0061_ratings_score_integrity.sql';

commit;
