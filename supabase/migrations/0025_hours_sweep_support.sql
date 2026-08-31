-- Next Bar — 0025: support the hours sweep (goal g-3eedd7a1, H3 slice 5)
--
-- WHAT THIS INDEX IS ACTUALLY FOR, stated plainly because the goal's wording is
-- misleading: H3 asked for "the index the strict filter needs". The strict filter
-- does NOT need one. `openNowStrict` / `hasTrustworthyHours` run CLIENT-SIDE over
-- the whole catalog, because the client is still shipped all 1,265 venues (that
-- is L4, the catalog-size ceiling, and a Phase 2 architectural change). No query
-- filters by hours_confidence today, so an index aimed at the filter would be
-- dead weight and a false claim of optimisation.
--
-- The queries that DO exist and DO scale with the catalog are the sweep's own:
--   * which venues have no trustworthy hours yet (candidates to fetch)
--   * which trustworthy rows are going stale and need re-checking
-- Both filter on hours_confidence and order by hours_verified_at, which is
-- exactly what this covers.
--
-- Cheap either way at 1,265 rows — Postgres will often seq-scan a table this
-- small regardless. It is here so the nightly sweep stays O(index) as the catalog
-- grows toward the 100k-users/day target, not because it is hot today.
--
-- Idempotent: IF NOT EXISTS.

create index if not exists bars_hours_provenance_idx
  on public.bars (hours_confidence, hours_verified_at);

comment on index public.bars_hours_provenance_idx is
  'Serves the hours sweep: find venues lacking trustworthy hours, and trustworthy rows due a re-check. Not used by the client-side open-now filter.';

------------------------------------------------------------------------------
-- Rollback (in comments, per convention):
--   drop index if exists public.bars_hours_provenance_idx;
------------------------------------------------------------------------------
