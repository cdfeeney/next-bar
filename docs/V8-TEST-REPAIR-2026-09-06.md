# V8 test repair — 2026-09-06

Base: `release/v8-ship` at `fac12ac`, plus the uncommitted files identified below.
Scope: refine the distance plan, then fix the two reported V8 Vitest failures.
No application behavior, schema, grants, production deployment, or API activation changed.
Distance implementation is still pending the decisions in `DISTANCE-PLAN-2026-09-06.md`.

## Direct staging evidence corrects the handoff

Read through `stagingDatabaseTarget` with the pinned CA, in a READ ONLY transaction.
Staging ledger: 68 rows, head `0077_orphan_sweep_forward_progress.sql`.

| Function | CRLF pairs in applied body | Equal to committed body after CRLF -> LF |
| --- | ---: | --- |
| decline_night_out_by_token | 53 | yes |
| join_night_out_by_token | 69 | yes |
| night_out_is_full_by_token | 18 | yes |
| night_out_seat_count | 5 | yes |
| respond_night_out | 83 | yes |

All five also have `security definer` and exactly `search_path=public`.
The prior claim of unresolved functional/schema drift in these five bodies was too strong: the observed difference is CRLF/LF only. This is not proof that unrelated staging objects have no drift.

On `public.stories`, anon SELECT privilege is false and authenticated SELECT is true. Migration 0065 lines 353–357 explicitly revoke anon access and grant authenticated SELECT. The old test incorrectly expected anon to reach RLS and receive zero rows.

## Changes and checks

- Stories test now requires PostgreSQL error 42501 and the specific stories-table permission denial. It still creates a real story fixture first; no grant was added.
- Function-body comparison folds CRLF on both sides. Security attributes remain exact; no trimming, case folding, comment stripping, or code/literal normalization was added apart from line endings. Eight regression cases cover accepted transport endings and rejected meaningful/content differences.
- The broader check exposed a 5-second timeout in the 22-identity cap fixture, followed by a role-permission failure on the shared connection. Unfinished async work after the timeout is the supported explanation, not independently observed lock evidence. The two 50+-round-trip cap cases now have the existing 30-second live-test budget, with no retries or weakened assertions.

| Check | Result |
| --- | --- |
| Before edits: two originally failing assertions, isolated | exit 1; both reproduced |
| First broader three-file check | exit 1; 62 passed, 2 failed, 1 skipped; original failures passed, new failures were cap timeout and following role error |
| Final `npm run typecheck` | exit 0 |
| Final `npm test -- --maxWorkers=1 --no-file-parallelism --reporter=dot` | exit 0; 190 files passed, 1 skipped; 3073 tests passed, 7 skipped; 753.63 seconds |
| `npm run test:e2e` | exit 1; 707 passed, 2 skipped, 1 failed; 14.0 minutes; production build, both configured viewports, default 3 workers, zero retries, port 57730 |
| `npm run check:contract` | exit 1; two existing validator-file digest mismatches, described below |

Vitest ran with verified staging TLS. `NEXT_BAR_ALLOW_COMMITTING_TESTS` was not enabled. Existing opt-in skips remain visible, not called passing. No independent DB scripts run alongside the browser gate.

## Browser failure under investigation (no retry or UI change)

The iPhone home coverage check in `e2e/mobile-controls.spec.ts:250` reports Flute Champagne Bar at x=16, y=598, width=358, height=57, covered by the fixed bottom navigation. The saved screenshot confirms overlap at that measurement. Evidence is in `test-results/mobile-controls-mobile-con-686ca-red-at-its-resting-position-iPhone-13/` (`error-context.md`, `test-failed-1.png`, `trace.zip`).

Read-only trace extraction found the scroll-to-end call at monotonic 262179.728–262314.172 ms, but the final `/rest/v1/bars` page at 262266.368 ms took 100.822 ms, completing about 53 ms AFTER scrolling ended. The coverage measurement starts at 263721.417 ms. `CatalogRefresh.tsx` replaces the catalog only after collecting all pages; the spec's `settle` waits a fixed second, not catalog readiness. This is direct evidence that scrolling preceded catalog completion and supports a loading-race explanation. Persistent layout failure versus a stale scroll position has not been independently reproduced.

Proposed follow-up: wait for actual catalog readiness (and refuse fallback as a full-catalog success) before positioning and measuring the page; retain all coverage assertions. Owner approval requested to extend this focused repair. No padding changes, retry, or quarantining has been applied.

The full run completed at 17:38 America/New_York. The wrapper's captured exit code is 1, and `test-results/.last-run.json` independently records `status: failed` with one failed test. The Pixel 7 counterpart passed in this run. Browser evidence therefore does NOT make the release green or establish a persistent-layout diagnosis; the readiness correction still needs implementation and verification in its own approved follow-up.

## Separate contract blocker — reconciliation proposed, not applied

Commit `c08408f` added validator JSDoc types, removed an obsolete TypeScript suppression, and modeled `product_bindings: []` in the test fixture. Direct diff inspection found no validator executable-code or assertion change. The frozen ledger still binds the prior files.

| Current contract part | Recorded SHA-256 | Actual LF-normalized SHA-256 |
| --- | --- | --- |
| scripts/check-release-contract.mjs | 4a06253092e243a3015fd210e42c442e37dead03a30a741a14276dd0b1f1730b | 351cb0f3821b078198b863104d12a84d801b67bdc0dd9aeafc6a93920863ec53 |
| scripts/check-release-contract.test.ts | fc1ef0ecc18ad697c3e94aa404c981ff25c620128cdfa9ed7cd0108bf8e0d0e8 | 73b9af7f9ac3b873f1b8c541f98323f21ba2bfe0f169e36dbb7572d663622732 |

Requested owner approval to rebind only these two current-file hashes and record the maintenance reconciliation. Preserve historical founder approval and product requirements. Until that happens, do not call the release admission gate green. The separate distance draft has six requirement rows and passed a structural/path check, but is NOT admitted by the frozen contract checker.

## Candidate identity (SHA-256, LF-normalized)

```text
a34c784a3caee694f79bf960d6c5ee7a6849d492ac9e042342fa0ea4f6b8efeb  src/lib/effectiveMigration.ts
9f120ef6d0939de0a2e1a0fbcfbb763d3d02a0513b1cd266f095c466e3718b86  src/lib/effectiveMigration.body.test.ts
70744baf2925cc29de217d074ab4b8ba84eb669954f207e651da6e0465b8b68a  src/lib/storiesRls.live.test.ts
d65dbdcac13ed5933666212387dd033a0d7193035c7db94f6c228ffe5b176dbc  src/lib/nightOutsRls.live.test.ts
18be99d6c53e9f387db6f9715820e37be01e3ed0bc000bb9f0e39879758f21b8  docs/DISTANCE-PLAN-2026-09-06.md
acb291e05f07f2a6c28d67aaa36085fc5991479cdd179388f79979889e498490  docs/DISTANCE-PLAN-2026-09-06.json
```
