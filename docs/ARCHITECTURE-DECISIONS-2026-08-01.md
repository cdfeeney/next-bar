# Architecture decisions — locked 2026-08-01

Decisions below are LOCKED for the overnight runs. Each lists its reopen condition; absent that
condition, executors implement as specified and reviewers do not relitigate.

## 1. Census: provider-command architecture (replaces sweep/ingest/import scripts)

One command under `scripts/census/` with `--borough --sources --budget --resume --report` and
explicit `--apply` as the sole write path (dry-run default; refuses under `LOOP_UNATTENDED=1`).
Adapters: Google Places, OSM, NY SLA, reviewed URL-seed, user-submission. Providers return
normalized candidates, provider cursors, evidence identifiers/URLs/dates, retry metadata, and
saturation state. Checkpoints carry: version, run ID, provider, coverage unit, cursor, call count,
config hash, code SHA, data version, last successful unit. Missing evidence stays `unverified`.
Overnight runs use mocked calls only; live spend is an attended action.
**Reopen if:** a provider cannot express cursor/saturation semantics, or the checkpoint contract
proves incompatible with the ledgered apply path.

## 2. Analytics: PostHog behind the existing facade, disabled by default

Extend `src/lib/analytics.ts` with versioned, allowlisted envelopes and an adapter interface;
PostHog adapter ships inert (no account, no credentials, no collection, no identify, no
dashboards). Supabase's four aggregate counters remain temporarily as the only live sink.
**Reopen if:** the operator makes the attended enablement decision, or allowlisted envelopes prove
insufficient for a concrete product question.

## 3. Feature safety: versioned local manifest

Versioned manifest + environment defaults + compatibility checks + kill-switch metadata + release
snapshots; checkpoint validation (config hash + code SHA), idempotency, concurrent-run refusal.
Local/file-based; no remote flag service.
**Reopen if:** multi-device flag coordination becomes a requirement (remote service decision is an
attended architecture choice).

## 4. Motion: `motion` package via `motion/react` (supported migration)

Replace the single `framer-motion` dependency/import (VibeQuiz.tsx is the only importer) per the
vendor upgrade guide (https://motion.dev/docs/react-upgrade-guide). Shared motion tokens;
`MotionConfig reducedMotion="user"`. Quiz behavior preserved.
**Reopen if:** the migration breaks quiz e2e in a way the guide's supported path cannot resolve.

## 5. shadcn/monorepo: move LOCKED until preconditions exist

Per https://ui.shadcn.com/docs/monorepo the move requires: workspace-level `components.json`,
matching aliases/style across workspace packages, and an exported `packages/ui` contract. Goal 5
records gaps only; NO move overnight.
**Reopen if:** all three preconditions are demonstrated in a readiness doc and the operator
approves the move window.

## 6. Staging/"green" semantics

"Green" = locally verified, reviewed (Santa quorum per tier), and ready for attended operator
acceptance. It never implies push, deploy, database application, or external enablement. T0 items
additionally remain intermediate until the attended post-deploy smoke passes.
**Reopen:** never (this is the safety floor).

## 7. Database: 0036 accepted-as-done; 0037 additive and gated

Migration 0036 is complete (commit `0f71333`, staging evidence) — no further overnight spend.
0037 is drafted ONLY after operator-confirmed 0036 attended acceptance; additive census-run +
source-evidence tables; browser roles revoked (0034 revoke-first pattern); no raw restricted page
content persisted (Google display-vs-persist posture); idempotent, ledger-compatible SQL; never
applied unattended.
**Reopen if:** the Goal-10 static packet surfaces a posture defect that 0037 must correct, in which
case the correction is its own reviewed T0 item — not a silent widening of 0037.
