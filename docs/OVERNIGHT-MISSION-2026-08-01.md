# Next Bar overnight mission — 2026-08-01 (stored-goal edition)

This replaces the earlier launch-prompt draft: `/mission` has now run and the queue below is
persisted in the multi-session goal store with the IDs listed. Do not re-run `/mission` for these
items — recreating them produces duplicates.

## Safety rules (binding for every goal, every tick)

- Work only in `C:\Users\cdfee\projects\nb-overnight` on the current feature branch. Run
  `worktree-guard` and the overnight guard before the first write and before every checkpoint; stop
  before writing while another live session holds a lease here.
- `LOOP_UNATTENDED=1` is exported for every tick; unattended safety gates (account/delete 503,
  remote-write lock) stay closed. Never remove, edit, bypass, or weaken the lock or its hooks.
- Local edits, tests, screenshots, review artifacts, and focused local commits are allowed. Stage
  exact paths only; never `git add -A`.
- Never: push, fetch-and-merge, open/edit/merge a PR, deploy, promote, contact Supabase or Vercel,
  apply/reset/baseline a database, invoke a migration runner, use Production credentials, upload to
  Apple, send email, spend API money, create external accounts, add credentials, enable data
  collection, or change any dashboard/external service.
- Do not modify migrations 0000–0036. Do not read or print secret values. Do not modify
  operator-owned dirty files: `docs/MASTER-TODO-2026-07-30.md`, `docs/OPERATOR-BUGS-2026-07-28.md`,
  `docs/CTO-OPERATOR-PLAN-2026-07-31.md`.
- Deterministic tier classifier (tool-result, upgrade-only). Real `/code` and `/santa-loop`
  wrappers; tier-prescribed quorum; Kimi K3 deep for UI synthesis or material dissent. Silence,
  timeout, malformed output, or a one-byte response is never agreement; an evidence-backed dissent
  stays unresolved until fixed or honestly blocked.
- Never weaken/skip/rewrite a failing test to go green; prove claimed pre-existing failures by
  comparison against base.
- "Green" means locally verified, reviewed, and ready for attended operator acceptance — NOT
  pushed, deployed, database-applied, or externally enabled.

## Prerequisite ledger (settled — do not respend)

| Item | Status | Evidence |
| --- | --- | --- |
| Goal zero: cross-device stale-session auth fix (`g-a345b6fc-885f-4878-81c8-caf33e0b1bd1`) | complete | local commit `9c80a8f`; 3-round full Santa panel, all lanes SHIP; vitest 1695/1695; revert point `0f71333` |
| Migration 0036 (ledger protection) | complete | committed at `0f71333`; staging evidence in `docs/MIGRATION-0036-STAGING-RUNBOOK-2026-08-01.md`; do not re-review or re-apply |
| T0 post-deploy smoke for goal zero | pending operator | attended deploy + smoke, then done |

## Ordered stored goals

| # | goal_id | Title | Tier (tool-result) |
| --- | --- | --- | --- |
| 1 | `g-4531bbf0-9203-4f33-9b76-1643c5c1d446` | Offline census rewrite — provider command, mocked adapters | T1 |
| 2 | `g-649592c7-52f1-48c4-b745-60709eb11f1f` | PostHog foundation — allowlisted envelopes, disabled adapter | T1 |
| 3 | `g-d494ba90-3e87-443b-814a-a061940b853f` | Feature safety + continuation infrastructure | T1 |
| 4 | `g-f9a3e003-f316-44b3-bfd2-945573286724` | Motion foundation — motion/react migration | T1 |
| 5 | `g-c8da7452-89ad-406a-87f3-eabb900ffa1e` | TestFlight + monorepo readiness evidence (no move) | T2 |
| 6 | `g-8557db39-1684-4cb1-9a76-acf910cb9106` | Restore Want to Go writers | T1 |
| 7 | `g-6cc99120-a83f-4984-bc7d-db60e0c792eb` | Exact-filter recovery — honest empty state | T1 |
| 8 | `g-2c788c17-b944-45d0-9dc3-d10d451e63b2` | Cancel/BottomNav overlap fix | T1 |
| 9 | `g-f81ccdfc-dc9d-43e7-a8a1-05472bc297dc` | Distance widening reruns full pipeline | T1 |
| 10 | `g-b4529acc-006a-4705-9a19-165264c05a3d` | Static RLS/SECURITY DEFINER packet 0000–0036 | T2 |
| 11 | `g-4914f4e9-3e73-4d73-b4a0-fad96def31a0` | Draft migration 0037 (GATED on 0036 acceptance) | T0 |

The first overnight run processes at most goals 1–6. Goals 7–11 remain stored for continuation
(`docs/CONTINUATION-2026-08-02.md`). Goal 11 is additionally gated on an operator decision recorded
in its Open Questions.

## Launch contract

The `/mission` that produced this queue is recorded in this file's git history. Launch the run with
exactly:

```text
/goal Use the global /overnight skill to process these goal IDs in order: g-4531bbf0-9203-4f33-9b76-1643c5c1d446, g-649592c7-52f1-48c4-b745-60709eb11f1f, g-d494ba90-3e87-443b-814a-a061940b853f, g-f9a3e003-f316-44b3-bfd2-945573286724, g-c8da7452-89ad-406a-87f3-eabb900ffa1e, g-8557db39-1684-4cb1-9a76-acf910cb9106. Stop at 8:00 AM America/New_York, after six processed goals, or when no safe runnable item remains. Set LOOP_UNATTENDED=1 for every tick, verify the remote-write lock and both worktree guards before writing, stop before writing while another lease is live, reuse stored goal IDs and resume only compatible checkpoints, reject stale checkpoint config/code hashes, and skip blocked work continuing with the next independent safe goal.
```
