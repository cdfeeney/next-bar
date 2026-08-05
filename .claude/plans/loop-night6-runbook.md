# Loop Runbook — Night 6 (sequential, --mode safe)

Created 2026-07-27. Pattern: `sequential`. Mode: `safe`.

Authoritative contract: `docs/NIGHTLOG-2026-07-28-NIGHT6.md`.
Parent goal: `g-e32c61a4-299e-4aad-ab04-f5b1bda3ef69`
(Phase 1: compliance-safe media + provenance foundation).

This runbook records loop configuration only. Where it and the nightlog
disagree, **the nightlog wins** — it is the contract.

## 1. Repository state at loop start (verified)

| Fact | Value |
|---|---|
| Branch | `feat/phase1-compliance-media` |
| HEAD | `8ac648ce52a7ba0f400f233413e08404fc90edaa` |
| vs `origin/main` | 0 ahead / 0 behind |
| Worktree | **dirty and must stay that way** — 18 tracked modifications/additions + 3 untracked files |
| Baseline tests | `npx vitest run` → **69 files / 958 tests passed** (32.4s) |

Pre-existing work present at loop start (preserve, never reset):

- staged/modified: `CLAUDE.md`, `scripts/photos-for-table.mts`,
  `scripts/refresh-places.mjs`, `src/components/BarLightbox.tsx`,
  `src/components/BarMedia.tsx`, `src/components/CatalogRefresh.tsx`,
  `src/components/GoogleAttribution.tsx`, `src/components/OpenNowBadge.tsx(+test)`,
  `src/lib/barServer.ts`, `src/lib/catalogServer.ts`,
  `src/lib/mediaPolicy.ts(+test)`, `src/lib/openNow.ts(+test)`,
  `src/types/index.ts`, `e2e/bias-smoke.spec.ts`,
  `supabase/migrations/0020_provenance_and_media.sql`,
  `docs/DATA-MEDIA-AND-VENUE-OUTREACH-PLAN-2026-07-27.md`
- untracked: `docs/NIGHTLOG-2026-07-28-NIGHT6.md`,
  `e2e/phase1-compliance.spec.ts`,
  `supabase/migrations/0021_provenance_hardening.sql`

## 2. Branch strategy

Stay on `feat/phase1-compliance-media`. No new branches, no worktrees, no
rebase, no history rewrite. Local checkpoint commits only. **No push, no PR,
no merge.**

## 3. Model tier strategy

| Role | Model | Reached via |
|---|---|---|
| Lead: decide, integrate, verify | Opus 5 | this session |
| Helper/subagents | **`sonnet`** (pinned) | `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` — verified set |
| Repo-grounded review | Codex | `codex:codex-rescue` |
| Architecture / cross-file | GLM-5.2 | `harness-consult.mjs --route glm` |
| Security / edge cases | DeepSeek V4 Pro | `harness-consult.mjs --route deepseek` |
| Bulk generation / sweeps | GLM (never Opus) | `harness-consult.mjs --route glm` |

Never call `ccr-openrouter-delegate.ps1` directly — it bypasses the cost
coordinator. `harness-consult.mjs` verified present.

## 4. Safety gates (safe mode)

Verified before first iteration:

- [x] Baseline tests pass (958/958)
- [x] `ECC_HOOK_PROFILE` is unset — **not** globally disabled
- [x] Subagent model pinned to `sonnet`
- [x] `harness-consult.mjs` present
- [x] Explicit stop condition defined (§6)
- [ ] **`loop-guard start` — BLOCKED, exit 5**: `weekly utilization unknown —
      pass --weekly-util from /usage; strict mode fails closed`. Operator must
      supply the figure. See §7.

Set `LOOP_UNATTENDED=1` on every tick (PowerShell does not persist env between
tool calls — set it inline per command).

### Forbidden overnight (from the nightlog contract)

Never: push · merge · open/auto-merge a PR · deploy · enable Vercel flags ·
change production secrets or quotas · contact venues · `db:migrate` ·
`apply-one-migration` · `refresh-places` · `photos-for-table` ·
`enrich-table-bars` · `rpc-smoke` · `nights-smoke` · delete
`public/bar-photos` · rewrite history · remove backups · spend Google quota.

`loop-guard rollback` is **also forbidden** — it runs `git reset --hard`, which
would destroy the pre-existing uncommitted work the contract orders preserved.
Use `tick` and `status` only; do checkpoints as ordinary `[T1]`/`[T2]` commits.

Anything requiring a forbidden action → mark `PARTIAL — operator action
required`, queue it for morning, continue to the next safe item.

## 5. Per-tick loop

1. Re-read line 1 of the nightlog for `[STOP]`.
2. Inspect branch, `git status --short`, lease, parent-goal state.
3. `loop-guard tick` — exit 3 means the cap is hit → stop.
4. Take exactly **one** first-unfinished queue item. Do not broaden scope.
5. Failing focused test first when behavior changes.
6. Implement only that item.
7. Focused tests → **automatic multi-model gate** (§5a).
8. Proportional verification for the item.
9. Local checkpoint commit, `[T1]` or `[T2]`.
10. Append one line to the nightlog `Tick log`: result, SHA, tests, reviewer
    families/verdicts, operator actions.
11. Re-arm the next tick ≈180s later while unfinished items remain.

### 5a. Automatic multi-model gate

Substantial T1 (any runtime / migration / media-policy / privacy / security
change) requires the full gate:

1. Opus lead inspects the repo and runs focused tests. Repository evidence
   outranks any model claim.
2. `/review-routed` on the current diff → Codex (correctness, regressions,
   missing tests) + GLM (architecture, omissions) + DeepSeek (security,
   authz, concurrency, error paths).
3. Verify every routed claim against real files. GLM and DeepSeek have no repo
   access — discard and **log** fabricated paths or behavior.
4. Fix every confirmed Critical/High/Medium, re-run focused tests.
5. `/santa-loop --unattended` convergence gate. Different recognized model
   families must approve. Same-family fallback or unavailable external review
   **fails closed**.
6. Max **3** repair/review rounds → then `PAUSED — review did not converge`,
   record findings, continue.
7. Duplicate routed-consult result = already reviewed; reuse it, never force a
   paid duplicate. Materially changed diff earns a fresh review.
8. T2 docs-only ticks may use a single repo-grounded reviewer.

No reviewer may edit, commit, push, deploy, apply a migration, or declare its
own finding fixed. The lead verifies and integrates.

## 6. Queue and stop condition

Sequential, one item per tick: **N0** recover/audit existing work → **N1**
provenance + hours safety → **N2** centralized media resolution → **N3** Phase 1
surface integration → **N4** full static + behavioral verification → **N5**
acceptance audit + handoff → **N6** morning summary and stop.

**The loop stops when any one of these is true:**

- N6 morning summary is appended (normal completion) — then release the lease,
  stop the heartbeat, stop scheduling ticks;
- `[STOP]` is the first line of the nightlog;
- `loop-guard tick` returns exit 3 (hard iteration cap, 12);
- the same blocker causes two consecutive failures on an item → pause that item
  with evidence and move on; if every remaining item is paused, stop;
- the multi-model gate cannot reach independent external reviewers → fail
  closed and stop.

## 7. Commands

Blocked on the quota gate. Once the operator supplies weekly utilization:

```powershell
$env:LOOP_UNATTENDED = "1"
node C:\Users\cdfee\.claude\bin\loop-guard.mjs start --max-iters 12 --weekly-util <PCT> --json
```

Exit 4 = quota skip (util ≥ 70% skip threshold — do not run tonight).
Exit 5 = blocked. Exit 0 = run opened.

Monitor / control:

```powershell
node C:\Users\cdfee\.claude\bin\loop-guard.mjs status --json     # progress + cap
node C:\Users\cdfee\.claude\bin\loop-guard.mjs tick   --json     # top of each tick; exit 3 = cap hit
node C:\Users\cdfee\.claude\bin\loop-guard.mjs done --message "night6 complete"
git -C C:\Users\cdfee\projects\next-bar log --oneline 8ac648c..HEAD   # checkpoints made
```

In-session: `/loop-status`. To halt: add `[STOP]` as line 1 of the nightlog.

Verification suite for N4, in order:

```powershell
npx vitest run
npx tsc --noEmit
npm run build
npx playwright test e2e/phase1-compliance.spec.ts
```

One documented `/quiz` cold-compile navigation flake may be rerun once in
isolation; any other failure is real until disproved with evidence.

## 8. Known operator-only items (never claimed by the loop)

Google key restrictions · quota screenshots · private backup confirmation ·
physical iPhone/TestFlight testing · production deployment · post-deploy smoke ·
applying migrations `0020`/`0021` · push/PR/merge.
