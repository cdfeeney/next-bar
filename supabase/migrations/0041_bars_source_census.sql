-- Next Bar — 0041 allow 'census' as a bars.source value
--
-- DRAFT GATE: authored during the attended census pilot (goal g-7104aed0,
-- 2026-08-05). Applied ONLY through the ledgered runner in an attended
-- session with explicit operator approval. Numbers 0038 (venue pins),
-- 0039 (Social Phase B), and 0040 (night photos) are RESERVED by
-- docs/MIGRATION-PLAN-RECONCILIATION-2026-08-04.md — hence 0041.
--
-- Why. 0019_bars_catalog.sql pinned bars.source to
-- ('curated','places','import','user-submitted'). The census apply path
-- (scripts/census/apply.ts) stamps its rows source='census' — that value
-- is the provenance marker the census's duplicate protection, rollback
-- scope (DELETE ... WHERE source='census'), and audit queries key on.
-- The FIRST live attended apply was rejected by this constraint
-- (bars_source_check violation, 2026-08-05) — the mock-client unit tests
-- can never see a real CHECK, so the live pilot is what caught it.
--
-- Idempotency. DROP CONSTRAINT IF EXISTS then ADD — the file is safe to
-- replay, and a fresh environment replays it after 0019 by lexical order.
-- The ADD re-validates all existing rows: every current Staging row is
-- source='curated' (verified live pre-authoring), so validation is a
-- no-op scan of ~411 rows; on any environment a non-conforming row would
-- fail the ADD loudly rather than pass silently.
--
-- Compatibility. Purely widens the allowed set — no existing row, column,
-- policy, grant, or RLS posture is touched. Old app clients are
-- unaffected (they never write bars.source; reads are unconstrained).
--
-- Rollback (emergency only): restoring the previous constraint is valid
-- ONLY while no source='census' rows exist — delete them first or the
-- ADD will (correctly) refuse:
--   alter table public.bars drop constraint if exists bars_source_check;
--   alter table public.bars add constraint bars_source_check
--     check (source in ('curated', 'places', 'import', 'user-submitted'));

alter table public.bars drop constraint if exists bars_source_check;
alter table public.bars add constraint bars_source_check
  check (source in ('curated', 'places', 'import', 'user-submitted', 'census'));
