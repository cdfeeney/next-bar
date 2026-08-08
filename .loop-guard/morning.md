# Overnight run — 2026-08-08

## Run status: BLOCKED (preflight, before any coding)

No code was written, no tests were run, no commits were made beyond this report.
The night stopped at the safety preflight, not during implementation.

## Run parameters

| Field | Value |
| --- | --- |
| Started | 2026-08-08 01:31 EDT (America/New_York) |
| Stopped | 2026-08-08 01:35 EDT |
| Stop time authorized | 2026-08-08 08:00 EDT |
| Worktree | `C:\Users\cdfee\projects\.harness-worktrees\nb-20260807\foundation` |
| Branch | `harness/nb-20260807/foundation` |
| Starting SHA | `6ec5e5d` |
| Ending SHA | `6ec5e5d` (unchanged by implementation) |
| Queue | `g-134e4680-da31-4a53-a44e-8d02f237f43f` (1 item) |
| Loop-guard | never started — preflight blocks before step 5 |

## Preflight results

| Check | Result |
| --- | --- |
| `overnight-recovery.mjs --json` | exit 0, `IDLE` — no interrupted run |
| `git status --short` | clean — no unrelated modifications |
| `harness-state lease inspect` | `{"lease":null,"live":false}` — no live owner |
| `harness-state list --runnable` | 1 goal, status `planned` |
| `overnight-guard.mjs preflight --json` | **exit 2, `TIER_MAP_BLOCKED`** |

Preflight failure detail:

```json
{"ok":false,"status":"TIER_MAP_BLOCKED","tierMapSource":"default",
 "t0RuleCount":0,"liveT0RuleCount":0,
 "problems":["project .claude/tier-map.json is missing",
             "project tier-map declares no T0 rules",
             "1 tier rule(s) match no tracked file"]}
```

`.claude/` does not exist on this branch at all. With no project tier policy, the
classifier falls back to generic defaults that declare **zero** T0 globs, so every
destructive path in the repo — `supabase/migrations/**`, the account-deletion path,
every `scripts/*` deletion helper — would classify T1 and the T0 gate could never
fire. The overnight contract fails closed here by design.

The stale-disk blocker recorded on 2026-08-07 (ENOSPC, 0.01 GB free) is **cleared**:
C: now has 5.18 GB free. It is not what stopped this run.

## Why this was not self-unblocked

The missing file exists in git history and porting it would have turned the
preflight green. It was deliberately **not** ported. Findings, in order:

1. `.claude/tier-map.json` exists on branch `chore/prime-foundation`, newest version
   at `d2fcd2f`. That branch is a **strict fast-forward descendant** of this
   worktree's HEAD — `git rev-list --left-right --count HEAD...chore/prime-foundation`
   returns `0  13`, and the merge base is `6ec5e5d` (this HEAD).
2. That map was reviewed on 2026-08-07 by a converging three-model panel
   (Claude/FABLE + GLM-5.2 + DeepSeek-V4-Pro) across Santa rounds 1–3.
3. Validated read-only against this branch's 3,852 tracked files, it comes back
   `TIER_MAP_READY`, 11 T0 rules, 11 live, 0 dead. Porting is mechanically clean.

**It was still not ported, because a clean validation is not evidence of a covered
surface.** `validateTierMap` only asserts that each rule matches ≥1 tracked file. It
does not assert that every destructive file is matched by a rule. The stored review
evidence on this goal says so explicitly: every T0 rule in that map is a *path
enumeration*, with no pattern rule and no behavioural catch-all, so any new file at
an unlisted path lands at T1 no matter how destructive.

That is not hypothetical for this item. Item 1 exists to **add new files** — AGENTS.md,
a repo-owned tier classifier, verify scripts, CI workflows. Under the ported map every
one of those new paths classifies **T1**, including the classifier that defines the T0
surface itself. Porting the map would have let the T0 policy artifact be built and
reviewed under T1 process on the strength of a green check that does not mean what it
appears to mean. That is a safety inversion, so the run stopped instead.

It is also the exact decay path the Kimi K3 lane predicted in this goal's own evidence:
an enumeration file extended under time pressure, at night, with no review.

## Queue outcome

| Goal | Status before | Status after | Outcome |
| --- | --- | --- | --- |
| `g-134e4680-…f43f` | `planned` | `planned` (unchanged) | Not started — preflight blocked |

Status was deliberately left `planned` rather than moved to `blocked`: the blocker is
environmental and attended-fixable, and leaving it `planned` means the next attended
run picks it up with no extra unblock step. A `skip` evidence entry was appended to
the goal recording this.

- Completed: none
- Blocked: none (the *run* is blocked, not the item)
- Skipped: none
- Remaining: `g-134e4680-da31-4a53-a44e-8d02f237f43f`

## Reviewer lanes

None dispatched. No item reached `ready_for_review`, so no Claude / Codex / DeepSeek /
GLM / Kimi panel was invoked. No routed spend was incurred.

## Timed-out commands

None. No `bounded-run.mjs` invocation was made; no process tree needed termination.

## Safety confirmation

- Nothing was pushed. Nothing was deployed. No migration was run.
- No branch was created, switched, merged, or rebased.
- No external system was contacted; no credentials were used.
- No file was deleted, pruned, or archived.
- No goal was created, recreated, overwritten, or broadened.
- The only repository write is this report, narrow-committed on its own.

## Human decisions needed

Item 1's foundation work is **still substantially undone** anywhere. The 13 commits on
`chore/prime-foundation` add only three files — `.claude/tier-map.json`,
`docs/FILE-MANAGEMENT-PLAN-2026-08-07.md`, `docs/PROD-MIGRATION-ADDENDUM-2026-08-07.md`.
There is no AGENTS.md, no repo-owned classifier, no verify scripts, and no CI on either
branch. The prior nights produced the tier-map port and its review record; the classifier
itself was never built.

Pick one and the queue runs unattended after it:

**Option A — fast-forward this worktree onto the work that already exists (recommended).**
`chore/prime-foundation` is 13 ahead / 0 behind, so this is a fast-forward, not a merge.
It brings the reviewed tier-map and both planning docs onto the working base:

```
cd C:\Users\cdfee\projects\.harness-worktrees\nb-20260807\foundation
git merge --ff-only chore/prime-foundation
node ~/.claude/bin/overnight-guard.mjs preflight --json   # expect ok:true
```

This is a branch change and was left for you deliberately.

**Option B — port the tier-map onto this branch only.**

```
git checkout chore/prime-foundation -- .claude/tier-map.json
git commit -m "chore: [T0] port reviewed project tier-map onto harness/nb-20260807/foundation"
```

Greens the preflight without the two docs. Carries the same known structural gap.

**Option C — attend the design question first.** The goal's stored evidence holds an
unresolved disagreement about acceptance criterion 5. AC5 as written is fail-closed on
unknown **paths**; the Kimi lane argues that decays within two quarters under repo churn
and proposes fail-closed on **capability** instead — classify by what a change does
(destructive SQL, privilege grants, network egress, dependency additions), using path
rules only to *lower* the tier of demonstrably inert locations. That rewrite changes what
Item 1 builds, so resolving it before implementation avoids building the wrong classifier.
This is the decision an unattended run must not make.

Under A or B the preflight passes and the item proceeds through `/code` → `/santa-loop`
normally. Under C, revise the goal's acceptance criteria first.
