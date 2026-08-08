# Overnight run — 2026-08-08

## Run status: BLOCKED (preflight, before any coding)

No code was written, no tests were run, no commits were made beyond this report.
The night stopped at the safety preflight, not during implementation.

Queue outcome is terminal: `overnight-guard finish` exits 0, `QUEUE_TERMINAL`,
`{"complete":0,"blocked":1,"abandoned":0}`.

## Run parameters

| Field | Value |
| --- | --- |
| Started | 2026-08-08 01:31 EDT (America/New_York) |
| Stopped | 2026-08-08 01:41 EDT |
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

```json
{"ok":false,"status":"TIER_MAP_BLOCKED","tierMapSource":"default",
 "t0RuleCount":0,"liveT0RuleCount":0,
 "problems":["project .claude/tier-map.json is missing",
             "project tier-map declares no T0 rules",
             "1 tier rule(s) match no tracked file"]}
```

`.claude/` does not exist on this branch. With no project tier policy the classifier
falls back to generic defaults declaring **zero** T0 globs, so every destructive path —
`supabase/migrations/**`, the account-deletion path, every deletion script — would
classify T1 and the T0 gate could never fire. The contract fails closed by design.

The stale ENOSPC blocker from 2026-08-07 (0.01 GB free) is **cleared**: C: has 5.18 GB
free. It is not what stopped this run.

## Correction to an earlier claim in this same report

An earlier revision of this file and the first `skip` evidence entry on the goal claimed
that porting the tier-map would let Item 1's T0 policy artifacts be built and reviewed at
T1 — a "safety inversion." **That claim was overstated and should not be relied on.**

Verified by running `classifyPaths` from `~/.claude/lib/tier-classify.mjs` against the
`d2fcd2f` map with Item 1's likely new paths. The classifier carries a **built-in policy
self-edit guard**:

```
warnings: ["change touches .claude/tier-map.json — forcing T0 (policy self-edit)"]
tier: "T0",  t0FileCount: 0,  escalated: false
```

So any change touching the tier-map already draws the full T0 five-family panel. Editing
the map is well-guarded, not weakly guarded.

The narrower claim that **does** hold — the guard is keyed specifically on
`.claude/tier-map.json`, so Item 1's other new files never trip it:

| Path | Tier | Matched glob |
| --- | --- | --- |
| `AGENTS.md` | **T2** | `**/*.md` (nonRuntime) |
| `.claude/tier-map.json` | T1 by rules → **T0 by self-edit guard** | none |
| `scripts/tier-classify.mjs` | **T1** | none |
| `scripts/verify-tiers.mjs` | **T1** | none |
| `.github/workflows/verify.yml` | **T1** | `.github/**` |

A repo-owned classifier introduced at an unlisted path *without* touching
`.claude/tier-map.json` lands **T1**, and the self-edit guard does not fire. That is a
real concern worth designing around, but it is **not by itself sufficient** to stop the
item, and it should not be recorded as if it were.

## Why the item is still attended-only

The stop rests on two independent grounds, neither affected by the correction above:

1. **Preflight exit 2.** `.claude/tier-map.json` is absent on this branch and the
   installed overnight contract states exit 2 blocks unattended work. An unattended run
   does not get to satisfy its own tier gate.
2. **An unresolved design decision, already recorded in this goal's evidence.**
   Acceptance criterion 5 as written is fail-closed on unknown **paths**. The Kimi K3
   lane argues that decays within two quarters under repo churn — one scaffolding tool,
   codegen step or bulk rename produces hundreds of T0 classifications, operators
   experience false positives continuously and false negatives never, and the rational
   response is warn-then-allowlist-then-wildcard, producing a new enumeration file with
   *worse* provenance. It proposes fail-closed on **capability** instead — classify by
   what a change does (destructive SQL, privilege grants, network egress, dependency
   additions), using path rules only to *lower* the tier of demonstrably inert locations.
   Its own words: "Item 1 should be scoped this way; consider revising AC5 before
   implementing." That changes what the classifier *is*. The contract forbids guessing it.

Per the skill — "Never guess a product/data/legal decision. Mark only that item
`blocked`, record the question" — the goal was moved `planned` → **`blocked`** (revision
10). An earlier revision of this report left it `planned` for operator convenience; that
was optimizing convenience over the contract and has been corrected.

## Supporting findings

- `.claude/tier-map.json` exists on `chore/prime-foundation`, newest at `d2fcd2f`,
  reviewed 2026-08-07 by a converging Claude/FABLE + GLM-5.2 + DeepSeek-V4-Pro panel.
- That branch is a **strict fast-forward descendant** of this HEAD:
  `git rev-list --left-right --count HEAD...chore/prime-foundation` → `0  13`,
  merge base `6ec5e5d`.
- Validated read-only against this branch's 3,852 tracked files it returns
  `TIER_MAP_READY`, 11 T0 rules, 11 live, 0 dead. Porting is mechanically clean.
- **Item 1 remains substantially unimplemented on both branches.** Those 13 commits add
  only three files — `.claude/tier-map.json`,
  `docs/FILE-MANAGEMENT-PLAN-2026-08-07.md`, `docs/PROD-MIGRATION-ADDENDUM-2026-08-07.md`.
  No AGENTS.md, no classifier, no verify scripts, no CI exist anywhere. Prior nights
  produced the tier-map port and its review record; the classifier was never built.

## Queue outcome

| Goal | Before | After | Outcome |
| --- | --- | --- | --- |
| `g-134e4680-…f43f` | `planned` | **`blocked`** (rev 10) | Not started — preflight blocked |

- Completed: none · Blocked: `g-134e4680-…f43f` · Skipped: none · Remaining: none
- `assert-terminal` → `ok:true, TERMINAL` · `finish` → exit 0, `QUEUE_TERMINAL`
- `loop-guard done` **not** called: no run state exists (`start` was never reached).
  Starting a run solely to close it would fabricate a record of a night that never ran.

## Reviewer lanes

None dispatched. Nothing reached `ready_for_review`, so no Claude / Codex / DeepSeek /
GLM / Kimi panel ran. No routed spend was incurred.

## Timed-out commands

None. No `bounded-run.mjs` invocation was made; no process tree needed termination.

## Safety confirmation

- Nothing pushed, deployed, or migrated. No external system contacted; no credentials used.
- No branch created, switched, merged, or rebased.
- No file deleted, pruned, or archived.
- No goal created, recreated, overwritten, or broadened — only a status transition and
  appended evidence, both contract-sanctioned.
- Only repository writes are this report and its narrow commits.

## Human decisions needed

Pick one; the queue runs unattended afterward.

**A (recommended) — fast-forward onto the work that already exists.** 13 ahead / 0
behind, so this is a fast-forward, not a merge. Brings the reviewed tier-map and both
planning docs onto this base:

```
cd C:\Users\cdfee\projects\.harness-worktrees\nb-20260807\foundation
git merge --ff-only chore/prime-foundation
node ~/.claude/bin/overnight-guard.mjs preflight --json   # expect ok:true
```

**B — port the tier-map only.** Greens preflight without the two docs:

```
git checkout chore/prime-foundation -- .claude/tier-map.json
git commit -m "chore: [T0] port reviewed project tier-map onto harness/nb-20260807/foundation"
```

**C — settle AC5 first.** Path-based vs capability-based fail-closed (see above). This is
the one that changes what gets built, and it is the reason the item is `blocked` rather
than merely waiting on a file. Worth deciding before A or B if you want the classifier
built right the first time.

After A or B, reset the goal to `planned` so the queue picks it up:

```
node ~/.claude/bin/harness-state.mjs set-status g-134e4680-da31-4a53-a44e-8d02f237f43f planned --json
```
