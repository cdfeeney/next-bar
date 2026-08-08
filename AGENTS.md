# AGENTS.md — operating rules for automated contributors

This file is **policy, not documentation**. It is the contract every automated
contributor (Claude Code, Codex, or any other agent) follows in this
repository. The tier classifier floors it at **T0** for that reason: a change
here can instruct an agent to skip a gate, which is a larger blast radius than
most code changes.

Humans should read `docs/ENGINEERING-HARNESS.md` for how the workflow actually
runs. This file states what is *required*.

---

## 1. Instruction authority

When instructions conflict, the **more specific and more recent** source wins,
with one exception: safety rules are never overridden by convenience.

Precedence, highest first:

1. **A direct instruction from the operator in the current session.**
2. **This file (`AGENTS.md`)** and `CLAUDE.md` — repository-level operating rules.
3. **The stored mission/goal spec** for the item being worked on.
4. **Global harness rules** in the operator's `~/.claude/rules/`.
5. **Inferred convention** from surrounding code.

**Current repository and runtime facts outrank all prose.** If this file, a
stored goal, or a memory says a script exists and the repository says otherwise,
the repository is right and the prose is stale. Verify before relying on any
claim about what exists.

An agent may **not** grant itself authority it was not given. Resetting a
blocked item to runnable, widening a goal's scope, or deciding a design question
the goal left open are operator actions.

## 2. One-writer operation

**Exactly one write-capable agent per worktree at a time.**

- Take the write lease before the first repository write, and release it when
  handing off, pausing, or blocking.
- Never run two write-capable agents against the same files concurrently.
- A lease held by another session is a stop condition. Never force, steal, or
  relocate a goal to evade one. Read-only inspection of another worktree is
  fine; mutating it is not.
- All edits and all mutating git commands stay rooted in the claimed worktree.
  Never use `git -C`, `--work-tree`, or a shell opened elsewhere to write into a
  sibling checkout.

## 3. Bounded evidence collection

Every external command runs under a timeout. An unbounded command that hangs
consumes the entire session and produces no evidence.

- Default 10 minutes for builds, type-checks, linters, and unit tests.
- Default 15 minutes for browser/E2E runs.
- A timeout is **not** a test failure. Record the command and its output tail,
  confirm the process tree was terminated, and treat the result as unknown.
- If process-tree termination cannot be confirmed, stop the run rather than
  starting more work beside an orphan.
- **Playwright runs in the foreground only.** Backgrounding it throttles the run
  roughly tenfold and strands `next-dev` processes holding port 3000.

Evidence means the **verbatim tool result** — command, exit code, output. A
narrated "I verified it" is not evidence and is not accepted.

## 4. Preservation of worktrees and user changes

Destroying uncommitted human work is unrecoverable and is treated as the most
serious process failure in this repository.

- **Never** delete, clean, reset, stash, prune, move, or archive an existing
  worktree, branch, or user file.
- **Never** `git checkout --`, `git reset --hard`, or `git clean` over changes
  you did not create in this session.
- Preserve all dirty and untracked work you find. Unrelated pre-existing
  modifications are a reason to stop and ask, not to tidy up.
- **Never** create a junction or symlink for `node_modules`. A junction plus a
  recursive delete has twice destroyed the real `node_modules` in this project.

## 5. Risk tiers — T0 / T1 / T2

Tier sets how much process a change gets. **Classification is computed, not
self-assigned:**

```bash
npm run tier-changed      # classify what you actually changed
npm run tier-validate     # check the tier map against every tracked file
```

| Tier | Meaning | Gate |
|------|---------|------|
| **T0** | Irreversible destruction, privilege escalation, credential exposure, or control of the release path | Full pipeline, independent multi-model review, a focused test on the exact path, and a recorded revert point |
| **T1** | Application and business logic that is reviewable and recoverable | Review required; tests for logic that can silently corrupt data or produce wrong numbers |
| **T2** | Demonstrably inert content — docs, fixtures, plain text | Do not break the build |

Classification is **capability-based and fails closed**. What a change *can do*
decides its tier, largely regardless of where the file sits, so moving or
renaming a destructive script does not lower it **below the capability floor
its content earns**. That guarantee is exactly as good as the signature list in
`scripts/lib/tier-capabilities.mjs`: a destructive operation expressed in a form
no signature matches — SQL assembled at runtime, a delete behind an
indirection — will not be caught. Treat the classifier as a floor, not a proof,
and raise the tier yourself when you know better.

If the classifier cannot establish that a change lacks a high-risk capability,
it returns **T0 with `escalated: true`**.

**Deleting a file is classified by what was deleted.** A removed path has no
content on disk, so its prior content is recovered from git — every revision
that still holds it (`HEAD`, the merge base, the base tip) plus the current file
if the path was re-created — and the tier is the highest any version earns.
Removing a purge script still earns its T0 floor; removing a plain component
does not. If no version can be recovered, the path stays unanalyzable and fails
closed at T0. Git's status is the provenance: recreating a path does not erase
the deletion that preceded it.

**Instruction-bearing markdown is policy, not documentation.** `AGENTS.md` and
`CLAUDE.md` are **T0 at any depth** — a coding agent executes them, so
`src/AGENTS.md` carries the same weight as this file. Ordinary documentation
stays inert: prose that *quotes* a destructive command cannot run it, and
scanning prose as capability once put 15 real documentation files at T0.

**Run `tier-changed` against the right base.** The changed set includes
working-tree edits, untracked files, *and* `base...HEAD`. With no base resolved
it can only see uncommitted work, so committed changes would go unclassified —
pass `--base origin/main` when in doubt.

**Tier is upgrade-only.** A reviewer may raise a tier; nobody may lower one.
Never self-label work T2 to skip a gate. The tier map may escalate a path but
can never lower it below a baked-in capability floor.

**Safety is not tiered.** Security review triggers (auth, user input, secrets,
crypto, payments) and the credential rules below apply at *every* tier,
including T2.

## 6. Remote, credential, and release safety

Unless the operator explicitly authorizes that exact action for that exact item:

- **Never** push, force-push, open or merge a pull request, or write to
  `main`/`master`.
- **Never** deploy, restart a production service, change DNS, or publish to an
  app store.
- **Never** run a migration, destructive SQL, `--apply`, or any bulk or
  irreversible data write.
- **Never** contact an external system, call a paid provider, or use
  credentials.
- **Never** print, log, echo, or transmit a secret, environment value, private
  key, credential, or secret-bearing URL — including into a routed model
  prompt. Report variable *names* and whether they are set, never values.
- Local branches and local commits only. Committing locally is expected;
  publishing is an operator decision.

## 7. Regression-test expectations

**Every bug fix starts with a failing test**, at every tier. Write the test that
reproduces the bug, watch it fail, then fix it.

A regression test that has never failed proves nothing. Demonstrate RED before
GREEN — either by running the test against the pre-fix code or, for gate and
classifier work, with the shared RED proof:

```bash
npm run tier-redproof     # runs the adversarial cases against the OLD classifier
```

**Every interactive feature gets an E2E test.** This project shipped a P0 that
1,100 green unit tests never saw. Specifically:

- A smoke assertion that the route renders, for every new route.
- An interaction assertion for every control that changes user-visible state —
  including the **negative** case ("tapping this does *not* change the URL").
- Assertions that hold on both configured viewports (iPhone 13, Pixel 7).
- Coverage of both signed-in and signed-out paths where behavior diverges.

## 8. Canonical verification

Use the repository's named commands. Never hand-roll an equivalent inline — CI
runs these same scripts, and an inline copy silently drifts from the gate.

| Command | What it runs |
|---------|--------------|
| `npm run verify:changed` | Fast gate: typecheck + unit tests + tier classification of changed paths |
| `npm run verify:full` | check-env + typecheck + unit tests + production build + tier validation |
| `npm run test:e2e:gate` | The canonical browser gate |
| `npm run tier-changed` / `tier-validate` | Tier classification and tier-map validation |

**E2E is deliberately excluded from `verify:full`.** Roughly 25 worktrees cannot
run concurrent Playwright against port 3000, and making every doc-only change
wait on a browser suite is what breeds gate-skipping. It is a separate, named,
required gate — not an optional one.

Passing the static gate is **necessary, not sufficient**. A T0 or substantial
T1 change must additionally be **behaviorally verified**: exercise the changed
path and observe the outcome, with the verbatim tool result as evidence.

## 9. Independent review

No agent's own review counts as the review of its own work.

- Work reaches `ready_for_review`; an **independent** reviewer decides whether
  it is complete.
- Review draws on models from different families so the check is not the author
  grading itself. A reviewer lane that timed out, returned empty, returned
  `BLOCKED`, or was dispatched and never collected is **missing** — silence is
  never approval and never a passing quorum.
- Fix verified high and medium findings. Style preferences do not block.
- When reviewers disagree, direct repository or test evidence wins. Otherwise
  reproduce the claim or report the uncertainty honestly.

## 10. `ready_for_review` is the handoff, not the finish

An implementing agent **never marks its own work complete.**

On finishing implementation and deterministic verification:

1. Record the verification evidence (or a justified skip, with the reason).
2. Set the item to `ready_for_review`.
3. Release the write lease.
4. Report the exact review command to run next.

Only the independent review step may mark an item `complete`, and only with
recorded evidence and a satisfied reviewer quorum. An item that cannot proceed
is set **`blocked`** — a terminal state — with the blocking question recorded.
Leaving a stopped item runnable because it is convenient for the next run is a
process violation.

## 11. Evidence environments are not interchangeable

Never conflate these. Each proves strictly less than the one after it, and
describing one as another is a misreport:

| Environment | What it proves |
|-------------|----------------|
| **Local** | The change builds and its tests pass on one developer machine, against local or mocked data. Proves nothing about deployed behavior. |
| **Staging** | The change works against deployed infrastructure with non-production data. Does not prove production behavior or production data shape. |
| **Native TestFlight (internal)** | The iOS build installs and runs for internal testers. Internal approval is **not** external App Review approval. |
| **Production** | The change serves real users against real data. Only a post-deploy check against production proves this. |

A local pass is an *intermediate* result for anything on the release path. For
T0 work the authoritative check is the **post-deploy smoke check**: confirm the
deployed system still serves and that the response is newer than the deploy. If
it fails, roll back to the recorded revert point **first** and diagnose second.
