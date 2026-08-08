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
| `npm run verify:full` | check-env → typecheck → unit tests → production build → tier validation | Before handing work off for review. |
| `npm run test:e2e:gate` | Playwright against iPhone 13 + Pixel 7 | Before shipping anything interactive. |
| `npm run tier-changed` | Classifies what you changed | To find out how much process a change needs. |
| `npm run tier-validate` | Checks every tier-map rule against every tracked file | After editing `.claude/tier-map.json`. |
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
runs last inside `verify:full`.

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
`AGENTS.md`, `CLAUDE.md`, `.claude/**` — which is floored by path, because
instructions an agent follows genuinely can cause action.

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

Two accepted trade-offs, recorded so that the first time one fires it reads as
policy rather than as a bug to be worked around:

- **Importing a deletion function counts, even without a call.** A module that
  names `rm` or `unlink` in its import list is floored T0 whether or not a call
  is visible, because `files.map(unlink)` and re-exports have no call-shaped
  text. The consequence is that ordinary temp-directory cleanup in a test —
  `mkdtempSync` then `rmSync` — classifies **T0 + escalated**. That is the
  intended reading: the file really can delete a directory tree. Do not add a
  test-file exemption; a carve-out by path is itself a laundering vector, which
  is the reason this design does not classify by path in the first place.
- **The analyzer resolves bindings, not values.** It follows what a module
  specifier was bound to — aliases, destructuring, namespaces, defaults — and
  stops there. `const nuke = fsp.rm` is caught because the member is
  *referenced*; a deletion function passed through a parameter, stored in an
  object, or reached via a computed specifier is not. Chasing those means
  writing a JavaScript engine inside a zero-dependency gate that must run before
  `npm ci`. The stopping point is deliberate; treat the classifier as a floor,
  and raise the tier yourself when you know better.

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
  `verify:full` validates the tier *map*; it never looks at the diff in front
  of it. The base is the target branch on a pull request and the event's
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
