# Engineering harness

How work actually moves through this repository: the commands, the tier gate,
and how the two fit together.

`AGENTS.md` states the rules automated contributors must follow. This document
explains the machinery those rules refer to, and is the one to read first if
you are a human trying to run the gates.

---

## The commands

Everything is a named npm script. CI runs the same scripts you do — that is the
whole point, so the local gate and the CI gate cannot drift apart.

| Command | Runs | Use it when |
|---|---|---|
| `npm run verify:changed` | typecheck → unit tests → tier classification of **changed** paths | While working. The fast loop. |
| `npm run verify:full` | check-env → typecheck → unit tests → production build → tier validation → tier sweep | Before handing work off for review. |
| `npm run test:e2e:gate` | Playwright against iPhone 13 + Pixel 7 | Before shipping anything interactive. |
| `npm run tier-changed` | Classifies what you changed | To find out how much process a change needs. |
| `npm run tier-validate` | Checks every tier-map **rule** against every tracked file | After editing `.claude/tier-map.json`. |
| `npm run tier-sweep` | Classifies every tracked **file** and prints the T0/T1/T2 distribution | To see whether a signature change re-tiered the repository. |
| `npm run tier-redproof` | Runs the adversarial cases against the **old** classifier | To prove a gate test is not coverage theater. |
| `npm run check-env` | Validates environment variable shape | Standalone; also the first step of `verify:full`. |

### Why E2E is not in `verify:full`

Deliberate, and it is not a weakening. This project runs roughly 25 worktrees,
and Playwright binds port 3000 — concurrent runs collide. Folding the browser
suite into the fast gate would make every documentation change wait on it, and
a gate that is expensive on trivial changes is a gate people learn to route
around. So E2E is a **separate, named, required** gate (`test:e2e:gate`) with
its own CI job, rather than an optional afterthought.

The tradeoff is explicit: `verify:full` passing does **not** mean the UI works.
For anything interactive, the E2E gate is the one that matters.

### Known flake, not a bug

The Next.js dev server's cold compile of `/quiz` occasionally races
`page.goto('/quiz')`, producing:

```
Error: page.goto: Navigation to "http://localhost:3000/quiz" is interrupted by
another navigation to "/"
```

Production builds are unaffected. If this is the **only** failure, re-run once
before investigating. Do not "fix" it with waits or restructuring.

---

## The tier gate

### What it is

Every change is classified **T0**, **T1**, or **T2**, and the tier decides how
much process the change gets — how it is reviewed, what must be tested, and
whether a revert point is required. `AGENTS.md` section 5 has the table.

The classifier is `scripts/tier-classify.mjs`. It has **zero runtime
dependencies** (Node built-ins only), so it *can* run before `npm ci` and
cannot be disabled by a dependency resolution failure. In the current CI
workflow the tier classification step runs after `npm ci`, and `tier-validate`
and `tier-sweep` run last inside `verify:full`.

### Capability-based, not path-based

This is the design decision that matters, and it was made deliberately after
the path-based approach was tried and found wanting.

The old policy classified by **path enumeration**: a list of globs, each naming
a known-dangerous file. It failed in a specific, repeatable way — *any new file
at an unlisted path landed at T1, however destructive.* Confirmed evasions
included a new `purge-photos.mjs` calling `unlinkSync`, a new
`cleanup-accounts.mts` running `delete from auth.users`, and a new admin route
exporting a `DELETE` handler. Adding more globs is whack-a-mole, and it gives
false confidence: a green gate that checked the wrong thing.

The obvious fix — fail closed on unknown **paths** — was considered and
rejected. Its false-positive rate is set by repository churn rather than by
risk, so one scaffolding tool, codegen step, or bulk rename produces hundreds
of T0 classifications at once. Operators would meet false positives daily and
true positives never, and the locally rational response is warn-not-deny, then
an allowlist, then a wildcard — an enumeration file with worse provenance than
the one it replaced.

So the classifier fails closed on **capability**: what a change *can do*,
wherever it lives.

| Capability | Floor | Examples |
|---|---|---|
| Destructive SQL or data-client deletion | **T0** | `delete from`, `drop table`, `.delete()`, a `DELETE` route handler |
| Privilege / RLS change | **T0** | `grant`, `revoke`, `create policy` |
| Service-role / account administration | **T0** | `service_role`, `auth.admin` |
| Destructive filesystem operations | **T0** | `unlinkSync`, `rmSync`, `rm -rf` |
| Credential handling | **T0** | `process.env.*SECRET*`, `DATABASE_URL` |
| Network egress | T1 | `fetch(`, `axios` |
| Database access | T1 | `createClient(`, `client.query(` |
| Auth session handling | T1 | `signOut`, `getSession` |

Plus **baked-in path floors** for roles that are high-risk regardless of
content: the tier map and the classifier themselves, `AGENTS.md`/`CLAUDE.md`,
CI workflows and release scripts, dependency manifests and lockfiles,
migrations, edge functions, middleware, and `next.config.*`.

### Two rules that keep it honest

**Novelty is not risk.** A new file at an unlisted path is *not* T0 just for
being new. A new fixture or document has no capability and stays T2 — which is
what stops a codegen storm from paging anyone.

**Prose is not capability.** Markdown and plain text cannot execute, so a
runbook that *quotes* `delete from auth.users` is not treated as able to run
it. This was measured: scanning prose as if it were code put 15 real
documentation files at T0. The deliberate exception is agent policy —
`AGENTS.md` and `CLAUDE.md` at any depth, the other well-known agent
instruction filenames, and everything under `.claude/`, `.cursor/` and
`.windsurf/` — which is floored by ROLE, because instructions an agent follows
genuinely can cause action. See "What this deliberately costs" for why the role
list is a list of files rather than a scan of prose.

**Ambiguity fails closed.** If the classifier cannot establish that a change
lacks a high-risk capability — the file is unreadable, or binary, and is not
demonstrably inert — it returns **T0 with `escalated: true`** rather than
guessing.

### Deleting a file

A deletion is graded on **what was deleted**, recovered from git rather than
from disk. Every revision that still holds the path contributes — `HEAD`, the
merge base, and the base tip — and so does the current file if the path was
re-created. The tier is the highest any of those versions earns.

That plurality is not belt-and-braces; each half closes a reproduced evasion.
Trusting a single revision let a change launder itself in two steps (commit a
harmless rewrite, then delete), and skipping a deleted path that exists again
let a dangerous file be swapped for a benign one inside one change set. Git's
status is provenance and the working tree cannot erase it. A deletion whose
prior content cannot be recovered — including a directory or submodule entry,
which `git show` will happily print as a tree listing — stays unanalyzable and
fails closed at T0.

### What this deliberately costs

Accepted trade-offs, recorded so that the first time one fires it reads as
policy rather than as a bug to be worked around. Each one below was reached by
MEASURING the alternative against this repository, not by preference:

- **Importing a deletion function counts, even without a call.** A module that
  names `rm` or `unlink` in its import list is floored T0 whether or not a call
  is visible, because `files.map(unlink)` and re-exports have no call-shaped
  text. The consequence is that ordinary temp-directory cleanup in a test —
  `mkdtempSync` then `rmSync` — classifies **T0 + escalated**. That is the
  intended reading: the file really can delete a directory tree. Do not add a
  test-file exemption; a carve-out by path is itself a laundering vector, which
  is the reason this design does not classify by path in the first place.
- **The analyzer resolves bindings, not values.** It follows what a module
  specifier was bound to and stops there. Binding resolution is broader than it
  looks and is meant to cover *ordinary code*, not just the tidy form: aliases,
  destructuring, namespaces and defaults, `import`/`require`/`await import`,
  assignment without a declaration keyword (`fsp = require('fs/promises')`), a
  conditional or `try`/`catch` load, a parenthesized `await import`, and the
  parameter of a `.then()` continuation. `const nuke = fsp.rm` is caught because
  the member is *referenced*. A **computed** module specifier
  (`require(mod)`) cannot be resolved by a text scan at all, so it fails closed:
  a dynamic specifier alongside any deletion name is reported as capability.

  A deletion function passed through a parameter or stored in an object is still
  not followed. Chasing those means writing a JavaScript engine inside a
  zero-dependency gate that must run before `npm ci`. The stopping point is
  deliberate; treat the classifier as a floor, and raise the tier yourself when
  you know better.

- **A newly added import of a T0 file escalates the importer.** Capability
  resolution stops at one module's own bindings, so calling a local wrapper —
  `purgeAll()`, a command registry, a barrel re-export — leaves no risky token in
  the file that introduced the call, and wiring an existing destructive primitive
  into a new call path graded T1.

  "Newly imported" is a SET DIFFERENCE between the imports of the previous
  version and the imports of the current one — not a reading of diff lines. The
  first implementation did read diff lines and was wrong in four separate ways
  reviewers demonstrated: an added line whose own text begins with `++` renders
  as `+++…` and was discarded as a file header; re-quoting an existing import
  made the line look added and escalated a file that gained nothing; a partial
  git failure skipped the fail-closed fallback while the warning claimed the
  opposite; and the tier came to depend on the SHAPE of history, so a squash, a
  rebase or a shallow clone changed the verdict for identical content. Comparing
  resolved import sets makes formatting, ordering and history irrelevant.

  Only what the change **added** counts, and that boundary was chosen from a
  measurement rather than taste. Unioning the capabilities of *every* imported
  file promotes 15 files to T0 here, among them
  `src/components/ShareNightButton.tsx`, `src/hooks/useRatings.ts` and
  `src/app/settings/page.tsx` — so restyling a button would summon the
  five-family panel, which acceptance criterion 11 forbids and which is exactly
  the alert fatigue this design exists to avoid. Keying on the added import
  escalates the change that creates the call path and leaves untouched the file
  that has always had it. Side-effect imports (`import './purge'`) count too —
  importing a module purely for what it does at load time is the strongest form
  of wiring there is.

  It runs in **both** input modes, so the gate and a reviewer piping the same
  path in cannot disagree; only `--summary` skips it, because a whole-repository
  distribution is not a gate decision. If a file's previous version cannot be
  read — a brand-new file, a shallow clone, an unresolvable base — every import
  it holds now counts as new, which escalates, and the affected paths are named
  in a warning rather than passed over.

  Two limits, stated rather than implied. The escalation is exactly **one hop**:
  in a chain A → B → C where only C is intrinsically T0, B escalates but A does
  not. And a file whose *existing* import becomes T0 in the same change is not
  itself escalated — though that change set still contains the newly dangerous
  file, so the change as a whole is T0 regardless.
- **A commented-out deletion import counts as capability.** There is no comment
  suppression at all, and that is a deliberate, measured decision rather than an
  oversight.

  Four separate mechanisms were built to stop a commented-out
  `import { rm } from 'node:fs/promises'` from flooring a file at T0 — blank all
  comments, blank only line-leading ones, inspect the match's line prefix, and
  make that prefix analysis fail-closed. Independent reviewers broke every one
  of them the same way: by making the suppressor believe a comment was there
  when it was not, which **skips a real deletion import**. The last version was
  defeated by an ordinary regex literal (`/[//]/`), because `/` is irreducibly
  ambiguous in JavaScript without a real parser — it begins a regex literal, a
  division, and two kinds of comment.

  The asymmetry decides it. The mechanism exists to prevent an over-escalation;
  every version of it instead hid destructive code. So it is gone. Nothing in
  the analyzer removes, rewrites or ignores any part of the text it scans, which
  makes this whole class of failure unreachable rather than fixed-again.

  The measured cost of removing it, across all 3,866 tracked files, is **zero
  files** — the T0 set is byte-identical with and without it. If you are about
  to add suppression back: it needs a tokenizer, not a regex, and a tokenizer
  belongs in the toolchain rather than in a zero-dependency gate that must run
  before `npm ci`.

- **Naming a PowerShell cmdlet over-escalates.** `Get-Command Remove-Item` is
  graded T0. Its exclusion was removed because `& (Get-Command Remove-Item)
  $path` *invokes* the cmdlet and the exclusion suppressed it. Every exclusion
  added to that branch has produced a fail-open; over-escalation is the
  direction this gate is allowed to be wrong in.

- **A file that merely DISPLAYS a destructive command is floored T0.** A React
  component rendering `<code>rm cache.db</code>`, or a string `"Run del /f
  cache.db"`, grades T0 even though neither can execute anything.

  This was fixed once and the fix was reverted, which is worth recording. Round
  10 withheld the shell signatures from JS/TS files that named no
  process-execution API — a file-level check rather than a content one, and it
  looked sound. Three lanes broke it in the next round with one shape:

  ```ts
  import { run } from './runner';
  run('rm -rf /srv/data');        // run() delegates to execSync
  ```

  That names no execution token, so the gate called the file inert and a real
  destructive command graded T1 — a shape that had been **T0 before the gate
  existed**. `execa` and `Bun.spawn` did the same, and each repair is one more
  name on a list the next popular library falls off.

  That was the fifth exclusion in this module whose safety rested on a negative
  check, and the fifth a reviewer broke. The precedent from comment suppression
  applies exactly: an exclusion here is not narrowed, it is removed. The
  over-escalation costs zero files across all 3,866 tracked files, because
  nothing in this repository renders a destructive command as text.

- **Instruction files are policy by ROLE, and the role list is not two names
  long.** `AGENTS.md` and `CLAUDE.md` at any depth are T0, and so are
  `AGENT.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`,
  `.github/copilot-instructions.md`, and everything under `.claude/`, `.cursor/`
  and `.windsurf/`. Most of those paths do not exist here; they are **dormant on
  purpose**, so the instruction file of the next agent tool someone adopts is
  already covered rather than classifying as inert documentation. `tier-validate`
  checks the tier *map* for dead rules, not these baked floors, so a dormant
  floor costs nothing.

  What this still does not catch is a section of an ordinary README addressed to
  coding agents. The obvious remedy — floor any markdown whose prose contains an
  agent-directed imperative — was **measured against this repository's 44 tracked
  markdown files before being rejected**: it floors four genuine documents (a
  blueprint, a continuation note, a night log, a work ledger) that merely
  *describe* agent work. That is the same failure that once put 15 documentation
  files at T0. Put instructions an agent must follow in a file whose role says
  so.

### The tier map can escalate, never de-escalate

`.claude/tier-map.json` still exists and is still useful: it escalates specific
paths and marks inert content. But the result is a **maximum** over the
baseline, the capability floor, the baked-in path floor, and the map. So:

> Deleting a T0 glob from the tier map cannot downgrade a capability-floored
> change, because that floor is computed from the file's content and is never
> read from the map.

`npm run tier-validate` checks the remaining map rules against every tracked
file. A rule matching zero files is almost certainly a typo, and a dead **T0**
rule is the worst case — a protection that is misspelled and silently
inactive.

### Self-protection

The classifier, its library, its adversarial tests, the RED proof, the
changed-paths feeder, and the tier map are all floored at T0. The gate cannot
quietly downgrade its own enforcement, and deleting the adversarial suite is as
visible as deleting the gate itself.

---

## Proving a gate test is real

A test that would also have passed *before* the change proves nothing.

`scripts/__tests__/tier-cases.mjs` holds one adversarial case table. Two
consumers drive it:

- `scripts/__tests__/tier-classify.test.mjs` asserts the current classifier
  gets every case right (**GREEN**), and runs inside `npm test`.
- `scripts/__tests__/red-proof.mjs` runs the **same** table through the
  pre-change classifier and reports which cases it gets wrong (**RED**).

Sharing one table is the point: if the two drifted, "fails before, passes
after" would stop being a claim about the same assertions. The RED proof exits
non-zero if a case marked as new capability already passed against the old
classifier — that is coverage theater, and it is caught mechanically rather
than by good intentions.

At the time of writing, 28 of 40 cases are classified wrong by the pre-change
classifier. Treat that ratio as indicative rather than exact — the suite grows
as reviewers find new evasions, and `npm run tier-redproof` always prints the
current numbers.

The RED proof reads the old classifier from the operator's home directory. On a
machine without the harness installed it exits **3** and says so, rather than
pretending to pass.

---

## CI

`.github/workflows/ci.yml` runs two jobs on every PR and every push to `main`:

- **verify** — first classifies the tier of the change itself
  (`node scripts/tier-classify.mjs --changed --base <ref>`), then runs
  `npm run verify:full`. The classification step is separate because
  `verify:full` validates the tier *map* and sweeps every tracked file; neither
  looks at the diff in front of it, and only `--changed` can see what a change
  ADDED. The base is the target branch on a pull request and the event's
  before-SHA on a push, falling back to `HEAD~1` when that ref is unusable
  (new branch or rewritten history).
- **e2e** — `npm run test:e2e:gate`, with the Playwright report uploaded as an
  artifact

Note the classification step uses `--changed` rather than piping
`changed-paths.mjs` into the classifier. A shell pipeline exits with its *last*
command's status, so the feeder's failure exit was being discarded — a broken
git invocation became "no changed paths" and a reassuring tier. `--changed`
collects in-process and fails on the spot.

Both call the canonical scripts rather than re-spelling `tsc`/`vitest`/`next
build` inline, so changing a script moves the local gate and the CI gate
together.

CI is not executed from a developer machine. Workflow changes are validated by
parsing the YAML; the run itself happens on GitHub.

---

## Database migrations

SQL migrations live in `supabase/migrations/` as numbered `.sql` files, applied
with `npm run db:migrate` (reads `DATABASE_URL` from `.env.local`, applies every
file in lexical order). Migrations must be idempotent — `CREATE ... IF NOT
EXISTS`, `DROP POLICY IF EXISTS` — because there is no `schema_migrations`
ledger yet.

Every file under `supabase/migrations/**` is **T0**. Applying one is
irreversible without a restore, and restore capability is unverified.

---

## Prime Agent

Not installed and not executed in this repository. Any future Prime Agent work
— installation, `/refine`, RLM children, skills, extensions, schedules,
autonomous mode — is **attended-only** and requires an explicit operator
decision. It is recorded here so the omission is understood as deliberate
rather than forgotten.
