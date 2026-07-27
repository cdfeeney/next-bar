# Operating cadence

How this company is actually run at 8 hours a week, by one person, with a full-time job.

There is no dashboard and no admin app. **This repository is the headquarters.** `ceo/state.json` is the
state, `ceo/reports/` is the record, `decisions/` is the memory, and git history is the audit log. A fifth
surface to maintain, for an audience of one who already reads markdown, would cost more than it returns.
Revisit when a second person joins.

## The week

| When | What | Time |
|---|---|---|
| Any one evening | **Talk to one person** — a bar-goer, a bartender, an owner. This is not optional; the cycle refuses to run without it. | 30 min |
| Sunday | Count the numbers by hand into `ceo/measurements/latest.json`, then run the cycle. | 20 min |
| Sunday | Read the report. Do the one thing it recommends, or say why not. | 5 min |
| Rest of the week | Build the one thing. | ~6 hrs |

```bash
node scripts/ceo-cycle.mjs                 # dry run: report only
node scripts/ceo-cycle.mjs --commit        # persist the new state
```

The measurement file is **operator-owned**. The orchestrator reads it and can never write it, because the
kill criterion is evaluated against those numbers. Counting by hand is a legitimate source; inventing one is
not, and `TRUSTED_MEASUREMENT_SOURCES` is the list of the two ways a number is allowed to arrive.

## What refuses to run, and why

These are not warnings. They stop.

| Rail | Fires when | Remedy |
|---|---|---|
| **Discovery floor** | `user_interviews_this_week` is 0 | Talk to one person. The orchestrator is not a substitute for that conversation. |
| **GO_MEASURE** | two consecutive cycles with nothing readable | Instrument something. The plans may be fine; nobody can tell. |
| **STOP_AND_REASSESS** | two consecutive cycles with a real reading that did not improve | Stop planning. A third plan is not the fix. |
| **Theater tax** | two cycles with nothing provable shipped | Ship something a user can see. A merged `chore` does not count. |
| **Bet closure** | a bet passed its review cycle unjudged | Call it hit or miss. `pending` is not a verdict. |
| **Board** | quarterly, and at the 2026-12-31 deadline | `KILL` / `RESCOPE` / `CONTINUE` / `UNMEASURABLE`. It only ever returns one of the four, and any verdict but `CONTINUE` halts the cycle with no plan. |

The board is the part with teeth. It is separate from the cycle on purpose: the function that reports
progress must not also be the one that judges whether progress was enough.

## The quarterly audit

The cycle asks "what next?"; the audit asks "should this continue at all?". Run it once a quarter,
and on 2026-12-31 whatever else is happening:

```bash
node scripts/ceo-board-audit.mjs
# 0 CONTINUE · 4 RESCOPE · 5 KILL · 6 UNMEASURABLE · 1 refused
```

It reads state and the measurement, writes the verdict to `ceo/audits/<date>-<VERDICT>.md`, and
mutates nothing. Three things it refuses to do, all for the same reason — an audit you can steer is
not an audit:

- **It will not let you choose the date.** There is no `--at` flag. The date comes from the
  measurement envelope, because an auditor that picks its own "as of" date can always find one where
  the numbers look better.
- **It will not judge stale numbers.** A measurement more than 30 days old describes a different
  company.
- **It will not re-run.** The record is created exclusively, so a second audit for the same date
  refuses rather than overwrites. To audit again, count new numbers under a new date.

Put it on a calendar reminder rather than a cron job for now. The point is that a person sees the
verdict, and a job that mails itself is how a KILL goes unread.

## Coding throughput — how many terminals

The binding constraint is review attention, not terminals. The rules that keep parallel sessions from
eating each other, learned the expensive way (a commit landed on a protected `main` on 2026-07-26):

- **One session = one folder = one branch, always, via `git worktree`.** A branch is not isolation; a peer's
  `git checkout` moves your HEAD mid-edit.
- **Run the guard before the first write**, every time — a clean goal lease is not evidence the directory is
  yours:
  ```bash
  node ~/.claude/bin/worktree-guard.mjs check     # 0 safe · 3 someone else is here · 2 unknown, fail closed
  git worktree add ../next-bar-<topic> -b feat/<topic>
  ```
- Worktrees do **not** share `node_modules` or untracked files. `npm install` in each.
- **Cap at 2–3 concurrent worktrees.** Beyond that the operator becomes the bottleneck: every branch still
  needs a PR read by the one person who can read it.
- The default branch stays clean and is the integration point. `main` is protected — PR + `gates` CI,
  squash-only. Never push to it.
- Freeze the interface between two parallel slices *before* fanning out. Two agents negotiating a contract
  through merge conflicts is slower than one agent doing both.

**Model routing** — match the model to the failure it is good at catching, not to the task's importance:

| Work | Who |
|---|---|
| Requirements, integration, final verification | Claude (lead) |
| Independent review of Claude-authored code | Codex |
| Cross-file architecture, "what did I not consider" | GLM |
| Security, concurrency, error paths, adversarial critique | DeepSeek |

One routed consultant by default; two only when architecture *and* logic/security are independently
material. Every routed call goes through `~/.claude/bin/harness-consult.mjs` — never the launcher directly,
or the cross-session cost coordinator is bypassed.

## Outreach, when it starts

Not yet — the sequence in `decisions/2026-07-26-next-bar-gtm-sequence.md` puts in-person venue recruitment
first. When it does start:

1. A human adds venues to `ceo/contacts/approved.json` and commits them. The orchestrator may read that
   file; nothing in this repository can write it.
2. The cycle drafts at most **5** emails into `ceo/outbox/`, each carrying a commercial disclosure, a postal
   address, and a one-step opt-out — in the body, where the recipient will see them.
3. **A person reads all five and sends them** from their own mailbox. There is no transport here.
4. The operator records a `sent_receipt_…` user event. A `pr_sha` does not close an outreach cycle:
   committing five drafts is not sending them.

The audience is ~265 venues. It is finite, small, and shared with every future attempt.
