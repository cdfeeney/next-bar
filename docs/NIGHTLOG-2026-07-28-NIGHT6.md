# Night Loop 6 — 2026-07-27/28

Parent goal: `g-e32c61a4-299e-4aad-ab04-f5b1bda3ef69`
(`Phase 1: compliance-safe media + provenance foundation`).

This file is the authoritative unattended-loop contract. The operator can stop
the loop by adding `[STOP]` as the first line. Re-read this file at the start of
every tick.

## Entry command

From `C:\Users\cdfee\projects\next-bar`, start normal Claude Code:

```text
claude
```

Then run:

```text
/loop-start sequential --mode safe
/code g-e32c61a4-299e-4aad-ab04-f5b1bda3ef69
```

After `/code` binds the goal, tell it:

```text
Execute docs/NIGHTLOG-2026-07-28-NIGHT6.md as the authoritative overnight
contract. Work one queue item per tick, run the automatic multi-model gate,
checkpoint locally, re-arm the next tick, and stop after the morning summary.
```

No special launcher is required. The default harness is Opus lead + Codex +
routed GLM/DeepSeek, with Claude helper agents pinned to Sonnet.

## Hard safety boundary

- Work only in this repository and on the existing
  `feat/phase1-compliance-media` branch/worktree.
- Preserve all staged and unstaged work found at loop start. Never reset,
  checkout, clean, stash, or overwrite work to get a clean tree.
- Set and retain `LOOP_UNATTENDED=1` for every tick.
- Local commits are allowed. Never push, merge, deploy, enable Vercel flags,
  change production secrets/quotas, contact venues, or open/auto-merge a PR.
- Never run `db:migrate`, `apply-one-migration`, `refresh-places`,
  `photos-for-table`, `enrich-table-bars`, `rpc-smoke`, or `nights-smoke`.
- Migrations may be reviewed, tested statically, and corrected, but not applied.
- Do not delete `public/bar-photos`, rewrite Git history, remove backups, or
  perform any other irreversible cleanup.
- Do not claim completion for operator-only criteria: Google key restrictions,
  quota screenshots, private backup confirmation, physical iPhone/TestFlight
  testing, production deployment, or post-deploy smoke.
- If a task needs any forbidden action, mark it `PARTIAL — operator action
  required`, add it to the morning queue, and continue to the next safe item.
- Two consecutive failures caused by the same blocker: pause that item, record
  exact evidence, and continue. Never weaken a test or safety control.

## Automatic multi-model gate

Run this gate for every substantive implementation tick before checkpointing:

1. The Opus lead inspects the repository, owns integration, and runs focused
   tests. Model output never outranks current repository/runtime evidence.
2. Run `/review-routed` automatically against the current diff:
   - Codex: repository-grounded correctness, regressions, and missing tests.
   - GLM: architecture, cross-file consistency, and omissions.
   - DeepSeek: security, authorization, concurrency, error paths, and edge
     cases.
3. Verify every routed claim against the files. GLM/DeepSeek have no repository
   tools; fabricated paths or behavior are discarded and logged.
4. Fix every confirmed Critical/High/Medium finding, then run focused tests
   again.
5. Run `/santa-loop --unattended` as the convergence gate. Different recognized
   model families must approve. Same-family fallback or unavailable external
   review fails closed overnight.
6. Allow at most three repair/review rounds. After three, mark the item
   `PAUSED — review did not converge`, record remaining findings, and continue.
7. A duplicate routed-consult result means the same packet was already reviewed;
   reuse its recorded result. Do not force a paid duplicate. A materially
   changed diff is eligible for a fresh review.
8. T2 documentation-only ticks may use one repository-grounded reviewer. Any
   runtime, migration, media-policy, privacy, or security change is substantial
   T1 and must use the full gate above.

No reviewer may edit, commit, push, deploy, apply migrations, or declare its own
finding fixed. The lead verifies and integrates.

## Per-tick contract

At the beginning of each tick:

1. Re-read the first line of this file for `[STOP]`.
2. Inspect branch, worktree occupancy, lease, `git status --short`, and the
   current parent-goal state.
3. Run the loop-guard tick. Stop if its hard iteration cap is reached.
4. Select exactly one first unfinished queue item.

For that item:

1. Write or update the smallest focused test first when behavior changes.
2. Implement only that queue item; do not broaden scope.
3. Run focused tests, then the automatic multi-model gate.
4. Run the proportional verification listed below.
5. Make a local checkpoint commit labeled `[T1]` or `[T2]`. Do not combine
   unrelated pre-existing work into a misleading commit; if the initial diff
   cannot be safely separated, keep it together and describe it honestly.
6. Append one concise tick line under `Tick log`: result, commit SHA, tests,
   reviewer families/verdicts, and any operator action.
7. Re-arm the next tick after roughly 180 seconds while unfinished items remain.

## Queue

### N0 — Recover and audit the existing Phase 1 work

- Inventory every staged/unstaged/untracked file without changing it.
- Map the existing diff to acceptance criteria B–G in the parent goal.
- Identify incomplete, contradictory, or accidental changes.
- Run focused media-policy, open-now, catalog-refresh, and Phase 1 compliance
  tests.
- Use the full automatic multi-model gate on the recovered combined diff.
- Preserve valid work; correct only evidenced defects.

Done when the existing work has an acceptance-criteria matrix, focused tests are
green, and the multi-model gate has converged or documented a bounded pause.

### N1 — Finish provenance and hours safety

- Review migrations `0020_provenance_and_media.sql` and
  `0021_provenance_hardening.sql` together for idempotency, RLS, grants,
  immutable permission evidence, constraints, and upgrade safety.
- Keep migration work author-only; do not apply either migration.
- Ensure Google-derived hours cannot be represented as verified.
- Ensure strict Open Now excludes unverified hours while normal ranking retains
  and de-prioritizes those venues.
- Ensure every affected UI state says `Hours not verified` accurately.
- Add/repair deterministic tests for the behavior and migration invariants.

DeepSeek security review and Codex repository review are mandatory. GLM reviews
cross-file schema/client consistency.

### N2 — Finish centralized media resolution and fallbacks

- Make `BarMedia` the single source-resolution boundary for the Phase 1 scope.
- Enforce precedence: Next Bar-owned → venue → approved user → live Google UI
  Kit → deterministic glyph.
- Preserve `BarLightbox` as the modal wrapper and preserve required attribution.
- Ensure Google media is visibility-gated and never fans out from pickers,
  saved/list views, recaps, dense maps, or markers.
- Ensure the remote kill switch and every network/script/quota failure degrade
  to glyph media without layout shift or console errors.
- Do not invent owner/user upload behavior that belongs to later phases.
- Add unit/component tests for precedence, deduplication, failure, attribution,
  and kill-switch behavior.

### N3 — Complete Phase 1 surface integration

- Inspect all current media consumers with `rg`; migrate only surfaces required
  by the parent goal and source plan.
- Verify recommendation cards and the open lightbox use the centralized policy.
- Verify excluded dense/list surfaces remain glyph-only and trigger no Google
  requests.
- Keep Google Maps links and visible `Powered by Google` attribution wherever
  Places-derived data is rendered without a Google map.
- Add focused Playwright coverage for iPhone 13 and Pixel 7. Use a dedicated
  non-3000 port and stop that server after the run.

### N4 — Full static and behavioral verification

Run, in order:

```text
npx vitest run
npx tsc --noEmit
npm run build
npx playwright test e2e/phase1-compliance.spec.ts
```

Also run any focused e2e added by N2/N3 on both configured devices. One
documented cold-compile navigation flake may be rerun once in isolation; any
other failure is real until disproved with evidence.

Do not run production smoke overnight. Record it as an operator action.

### N5 — Acceptance audit and handoff

- Audit every parent-goal acceptance criterion as `DONE`, `PARTIAL — operator
  action required`, or `PAUSED`, with evidence.
- Confirm no new Google photo bytes/review text were persisted and no existing
  photo files were deleted.
- Confirm migration files remain unapplied by this loop.
- Prepare a concise local handoff with changed SHAs, tests, review verdicts,
  residual risks, and exact attended commands/actions for the operator.
- Do not create follow-on implementation for open-catalog imports, claims,
  uploads, outreach, or deletion. List those as separate future goals.

### N6 — Morning summary and stop

Append the summary below, mark the loop complete/paused truthfully, release the
lease, stop the heartbeat, and stop scheduling ticks.

## Tick log

- Loop authored 2026-07-27; no execution ticks yet.

## Morning summary

To be appended by the loop:

- Queue results N0–N5
- Local commits
- Full verification results
- Reviewer families and final verdicts
- Paused/partial items
- Operator actions, including migrations, keys/quotas, backup confirmation,
  physical-device testing, push/PR/deploy, and production smoke
