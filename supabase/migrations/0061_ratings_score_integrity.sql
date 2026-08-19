------------------------------------------------------------------------------
-- 0061_ratings_score_integrity.sql — backfill null scores, constrain the range
------------------------------------------------------------------------------
-- Goal g-575e68bb (P-A). Additive and idempotent. Numbered above the highest
-- file here (0060) per CLAUDE.md.
--
-- WHY NOW. `ratings.score numeric(3,1)` has been nullable and unconstrained
-- since 0001:39, and the client validator `isBarRating` (src/lib/ratings.ts)
-- never checks it. That was latent until the V8 cascade ranker shipped
-- (2221cbf..d173948): `deriveLearnedTaste` counts only ratings that carry a
-- numeric score, so a user whose rows are all scoreless computes N = 0, hence
-- c = N/(N+10) = 0, and they rank as a COLD START with no error anywhere.
--
-- Pre-flight against staging, 2026-08-19 (read-only, recorded in the goal):
--   18 ratings, 16 scored, 2 unscored (both tier='loved')
--   0 rows outside 1.0-10.0
--   1 of 3 rating users would be a silent cold start today
--
-- ⚠ THESE COUNTS ARE STAGING'S. They do NOT license applying this to
-- production. Re-run the same read-only pre-flight against production before
-- any promotion: if production holds rows outside 1.0-10.0, step 2 below
-- ABORTS the transaction rather than silently rewriting user data, which is
-- the intended behavior. Decide the correction for those rows first.
--
-- WHY THE COLUMN STAYS NULLABLE. NULL is a live, intentional state, not just
-- legacy debris: src/lib/ratings.server.ts:59 clears the score when a bar's
-- tier CHANGES, because the old score was interpolated inside the old tier.
-- `NOT NULL` would break that write path. This migration therefore repairs the
-- existing null population and constrains the RANGE; it does not forbid null.
-- Corollary, and NOT fixed here: a tier change will still drop that bar's
-- evidence, so the backfill is a one-time repair rather than a permanent cure.
------------------------------------------------------------------------------

------------------------------------------------------------------------------
-- 1. Backfill from the tier band midpoints the product already uses
------------------------------------------------------------------------------
-- 9.0 / 6.5 / 2.5 are TIER_BANDS' midpoints (src/lib/pairwise.ts:29), the same
-- values e2e/rankings-score.spec.ts documents for unscored rows. Using them
-- reproduces the ordering users already see instead of inventing a new one.
--
-- Note on 2.5 for tier='pass': that is below 5.0, and under the V8 Option B
-- decision (resolved 2026-08-19) that is correct and harmless — a low score is
-- negative evidence, never suppression. Do NOT add an exclusion for it.

-- ⚠ updated_at MUST be bumped, or this statement silently does NOTHING.
-- 0005 installed `ratings_lww` — a BEFORE UPDATE trigger whose function
-- `ratings_lww_guard()` RETURNS NULL (skipping the row, with no error) unless
-- `new.updated_at > old.updated_at`. A plain `set score = …` leaves updated_at
-- untouched, so new = old, so every row is skipped and the migration still
-- reports success. That false green was observed on staging on 2026-08-19:
-- the constraint landed, the backfill did not, and nothing said so.
--
-- `greatest(now(), updated_at + interval '1 microsecond')` is strictly newer
-- than the stored value even for a row whose client-generated clock ran ahead
-- of the server's.

update public.ratings
   set score = case tier
                 when 'loved' then 9.0
                 when 'liked' then 6.5
                 when 'pass'  then 2.5
               end,
       updated_at = greatest(now(), updated_at + interval '1 microsecond')
 where score is null;

------------------------------------------------------------------------------
-- 2. Refuse to constrain data we would have to rewrite blind
------------------------------------------------------------------------------
-- If any row sits outside the range, stop the whole transaction with a clear
-- message. Adding the constraint would fail anyway; failing HERE says why.

do $$
declare
  bad_rows bigint;
begin
  select count(*) into bad_rows
    from public.ratings
   where score is not null and (score < 1.0 or score > 10.0);

  if bad_rows > 0 then
    raise exception
      'refusing to add the score range constraint: % row(s) already sit outside '
      '1.0-10.0. Decide how those are corrected before constraining the column.',
      bad_rows;
  end if;
end
$$;

------------------------------------------------------------------------------
-- 3. The range constraint
------------------------------------------------------------------------------
-- Idempotent: re-applying must not error. NULL stays permitted (see header).
-- This makes the clamp in src/lib/tasteAffinity.ts a second line of defense
-- rather than the only one — 0.0 was previously reachable and TIER_BANDS
-- still permits it in code.

alter table public.ratings
  drop constraint if exists ratings_score_range;

alter table public.ratings
  add constraint ratings_score_range
  check (score is null or (score >= 1.0 and score <= 10.0));
