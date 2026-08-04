# Census pipeline readiness check — 2026-08-04 overnight (g-7104aed0, SAFE portion only)

Unattended readiness verification of the already-built census pipeline
(g-4531bbf0) and the 0037 draft (g-4914f4e9). **No activation occurred:**
no credentials bound, no paid provider calls, no 0037 apply, no Staging
read or write. The activation pilot remains a fully attended session.

## What ran (all local, fixture-only)

| Check | Result | Evidence |
|---|---|---|
| Census unit suite | **60/60 pass** | `scripts/census/census.test.ts` (44 its: checkpoint contract, dedupe, google/osm/sla adapters, file adapters, mocked end-to-end runCensus, interruption recovery, apply preconditions) + `src/lib/migration0037.test.ts` static guards + `scripts/lib/runSafety.test.ts` |
| Fixture-only CLI dry run | **complete** | `run-2026-08-04T05-29-22-661Z`: borough manhattan, sources osm+sla, budget used 9/50, 4 candidates, saturated 'complete'; artifacts: report.json/md, per-source checkpoints, apply-sidecar.json, run.json, units/ — all under `scripts/census/out/` only |
| Config/code identity | recorded | configHash `e0499c40…`, codeSha `70356e30…` in report + checkpoints (resume refuses drift via validateCheckpoint) |
| Resume + report regeneration | **works** | `--resume <runId> --report` regenerated the report idempotently |
| Idempotency/budgets/saturation/dedupe/provenance | unit-verified | covered by the 60-test suite above (budget stop, checkpoint resume from lastSuccessfulUnit, PK-idempotent inserts, dedupe, provenance fields) |
| Unattended apply refusal | **REFUSED as designed** | `LOOP_UNATTENDED=1 … --apply … --run <runId>` → "census --apply (bars table write) is forbidden during the unattended loop … Aborting." before any client construction |
| Concurrent-writer refusal | **static + unit only tonight** | The mechanism is DB-side in the 0037 draft (writer leases with expiry, CAS revisions via census_touch, checkpoint writes serialized behind the run row's FOR UPDATE with lock_timeout backoff). No local Postgres engine exists and Staging is out of scope tonight, so the live two-writer proof belongs to the attended apply session. Static guards: migration0037.test.ts. |
| 0037 vs current branch | consistent | Draft sits unapplied at `supabase/migrations/0037_census_provenance.sql`; checkpoint-contract mapping matches checkpoint.ts version 1 (configHash/codeSha/dataVersion on census_runs, CHECK-pinned version on checkpoint rows). No competing 0038 file exists (see docs/MIGRATION-PLAN-RECONCILIATION-2026-08-04.md). |

## Readiness defects found

None. No fix cycle was needed.

## Attended gates that remain before ANY census expansion

1. Operator approval to apply 0037 to protected Staging (after ledger
   verification against the live schema_migrations table).
2. Pilot coverage area + source selection; no-cost sources first.
3. Explicit hard call/cost ceiling + operator approval before any Google
   Places spend.
4. Report-only generation → human curation → curated rows bound to the
   reviewed payload hash/config hash/code SHA → the sole attended apply
   path.
5. Post-apply verification (counts, provenance, RLS/browser-write
 denial, >1,000-row paging, static fallback, catalog swap, duplicate
   protection, matcher/search/map visibility) + pilot-scoped rollback
   instructions.

**No new bars were added tonight.** The 4 fixture candidates are
synthetic test data under `scripts/census/out/` and are not part of any
catalog.
