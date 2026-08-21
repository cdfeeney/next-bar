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
-- The bump is `updated_at + interval '1 microsecond'` and NOT
-- `greatest(now(), …)`. Adding a microsecond is already strictly greater for
-- every finite timestamp, including one whose client clock ran ahead of the
-- server, so now() buys nothing — and it costs real user data (Codex review,
-- HIGH): advancing rows to deployment time makes every offline write stamped
-- BEFORE the deploy lose. Such an update is silently skipped by the LWW
-- trigger, and a stamped delete fails `.lte('updated_at', at)` at
-- src/lib/ratings.server.ts:145. Both paths read "no error, zero rows" as
-- acknowledgement and clear their journal, so the user's edit vanishes with no
-- error anywhere. Keep the bump as small as the trigger allows.

update public.ratings
   set score = case tier
                 when 'loved' then 9.0
                 when 'liked' then 6.5
                 when 'pass'  then 2.5
               end,
       updated_at = updated_at + interval '1 microsecond'
 where score is null
   and tier in ('loved', 'liked', 'pass');

------------------------------------------------------------------------------
-- 1b. Prove the backfill actually landed
------------------------------------------------------------------------------
-- The original failure mode of this migration was a backfill that silently
-- affected zero rows while the tool printed "ok". One assertion closes every
-- known way that can happen again:
--   * a `tier` value outside the three canonical ones (the CASE would return
--     NULL and quietly re-null the row);
--   * `updated_at = 'infinity'`, where +1 microsecond is still infinity, so the
--     LWW trigger skips the row;
--   * any future trigger that skips rows for a reason we have not thought of.
-- If a null score survives this statement, STOP rather than constrain a table
-- we only think we repaired.

do $$
declare
  remaining bigint;
begin
  select count(*) into remaining from public.ratings where score is null;

  if remaining > 0 then
    raise exception
      'backfill did not land: % row(s) still have score IS NULL. Do not assume '
      'the UPDATE ran — check tier values outside (loved,liked,pass), an '
      'updated_at of infinity, and the ratings_lww BEFORE UPDATE trigger.',
      remaining;
  end if;
end
$$;

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
-- PROMOTION NOTES — read before running this against production
------------------------------------------------------------------------------
-- 1. LOCK. `add constraint … check` takes an ACCESS EXCLUSIVE lock and scans
--    the table, and the repository's runner holds one transaction for the whole
--    set, so the lock is held until commit. On staging's 18 rows that is
--    nothing; on a large, hot production table it is an outage. If production's
--    ratings table is big, split the promotion: `add … not valid`, commit, then
--    `validate constraint` in a SEPARATE transaction. Doing both here gains
--    nothing (Codex review, MEDIUM).
-- 2. NOT TEMPORALLY IDEMPOTENT. The backfill fills whatever is NULL AT THE TIME
--    IT RUNS. After the first apply, new NULLs are legitimate — a tier change
--    clears the score (src/lib/ratings.server.ts:59). Re-running this later
--    would overwrite those with band midpoints and change live rating
--    semantics. The apply tool refuses an already-ledgered migration, which is
--    what normally prevents this; do not defeat that.
-- 3. RE-RUN THE READ-ONLY PRE-FLIGHT against production first. Staging's counts
--    say nothing about production's shape.

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
