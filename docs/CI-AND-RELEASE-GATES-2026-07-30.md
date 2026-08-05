# CI, release and recovery gates

Written 2026-07-30 for goal `g-a2941340`. What changed, what deliberately did not, and what
cannot be gated until an environment exists.

## The gap this closed: the T0 gate was inert

`.claude/tier-map.json` did not exist, so `tier-classify.mjs` fell back to the generic
defaults — which ship **no T0 globs at all**. Every path in this repository classified **T1**,
including `supabase/migrations/**` and `src/app/api/account/delete/**`. The T0 gate in
`development-workflow.md` could therefore never fire, no matter what was changed.

The map now declares this project's real T0 surface:

| Glob | Why T0 |
|---|---|
| `supabase/migrations/**` | irreversible against live user data without a restore; a grant change can lock every user out of their own rows |
| `supabase/schema.sql` | same blast radius, fresh-project path |
| `src/app/api/account/delete/**` | destructive and irreversible; the one route holding the service-role key |
| `src/middleware.ts` | runs before every matched handler, so nothing downstream can gate it (C2 F1b) |
| `scripts/apply-migrations.ts` | the runner that applies schema to a live database |
| `scripts/prune-orphan-photos.mjs` | deletes files |

Proven to fire — classifying a migration plus the delete route now returns
`tier: T0, t0FileCount: 2, source: project`.

**Validation caught a real defect on the first run.** `**/__fixtures__/**`, inherited from the
defaults, matched no file in this repository. It was only a T2 rule, but the same class of
typo in a **T0** rule silently leaves a path unprotected — which is exactly why the validator
exits non-zero on a dead rule. Removed; the map now validates clean.

```bash
npm run tier-validate
```

## Added to CI: secret scan

`scripts/secret-scan.mjs` runs first in `.github/workflows/ci.yml`, before typecheck, because
a committed credential should fail a PR before anything spends minutes.

It is deliberately narrow: JWT-shaped tokens, Postgres URLs carrying credentials, Google API
keys, and a service-role/database secret **assigned** under a `NEXT_PUBLIC_` name. A scanner
that cries wolf gets disabled, and a disabled scanner is worse than none.

That tuning was earned, not assumed. The first version matched the bare variable *name* and
produced four false positives — the classification doc and the `envCheck` tests both name
that variable on purpose, because it is the hazard they exist to describe. The pattern now
requires an assignment with a value of 12+ characters, so short placeholders do not trip it.
Verified both ways: **clean over 484 tracked files**, and a planted key is still caught.

It reports **locations only** — never the matching text — so it is safe in a public CI log.

**Scope, stated so "clean" is not over-read:** four narrow patterns over *tracked* files. It does not
scan git history, does not detect novel credential formats, and is not a comprehensive secret audit.
A history-wide scan (gitleaks/trufflehog) is still outstanding and is NOT covered by this gate.

## Deliberately NOT added to CI

| Check | Why not |
|---|---|
| Tier-map validation | `tier-classify.mjs` is a **user-global harness tool**, not in this repository. A CI step calling it would fail on a runner because the file does not exist. Available locally as `npm run tier-validate`; belongs in a pre-commit hook, not GitHub Actions. |
| `npm run check-env` | It reads `process.env`, and a CI runner has none of the app's variables — it would fail on missing Supabase vars and prove nothing. Its home is a deployment environment. |
| Playwright | Needs browser installs, a dev server, and roughly 10x the minutes. The existing comment in `ci.yml` already records this decision; nothing here changes it. |
| Migration rebuild from committed migrations | **Cannot run.** No Postgres engine exists on the dev machine and CI has none provisioned. This is the same blocker that stopped goal 1, and it is the single highest-value gate still missing. |

## Still ungateable until an environment exists

None of these can be automated today, and none may be recorded as passing:

- rebuilding a clean database from committed migrations;
- backup existence, restore rehearsal, recovery point/time objectives;
- staging smoke and rollback rehearsal against a migrated schema;
- expand/contract behaviour proven across a real deploy.

All of them unblock together the moment a staging Supabase project exists — which is why
`ENVIRONMENT-DESIGN-2026-07-30.md` step 1 is the highest-leverage item in the whole program.

## Compatibility rules to keep

- Migrations are **expand-only** unless an attended exception is reviewed. `0033`, `0034` and
  `0035` all satisfy this: one adds a table, one narrows grants, one adds a validation.
- Destructive cleanup ships in a **later** release, once old clients are gone.
- Every schema change states whether old app versions work with the new schema, and whether
  new code works during rollout. `MIGRATION-0033-0034-RUNBOOK.md` does this in both directions.

**These are a compatibility CONVENTION, not a gate.** Nothing in CI enforces expand-only or
diffs a migration for destructive statements — a migration that violates the rule above will
pass every automated check. Treat the rule as a review checklist item until something enforces
it. Labelling it a "gate" would be the same false-confidence problem this document exists to
remove.

## Release and revert

Added 2026-07-31: the review panel found this document's title promised release and recovery
content that its body never delivered. "Revert" appeared zero times.

**Current reality, verified:** `origin` exists
(`github.com/cdfeeney/next-bar`), but the working branch
`feat/overnight-2026-07-30` has **no upstream** — nothing from this program has been pushed.
So there is no deployed artifact to roll back yet, and the revert path below is the one that
applies today.

### Reverting code (available now)

1. `git log --oneline` and pick the last known-good SHA. Every goal commit is tagged with its
   goal id (`[g-xxxxxxxx]`), so the unit of revert is one mission item.
2. `git revert <sha>` — **not** `reset --hard`. Revert is additive and safe on a branch that
   may already have been shared; reset destroys history that another worktree may hold.
3. Re-run the gates: `npm run secret-scan`, `npx tsc --noEmit`, `npx vitest run`.

### Reverting a deploy (NOT yet possible — do not record as passing)

Requires a deployment to exist first. When it does, the revert path is Vercel's
"Promote to Production" on the previous deployment, which is why the **deployment SHA must be
recorded before every deploy** (the T0 gate's revert-point rule). Untested — no deploy has
ever been performed from this program.

### Reverting a migration (the dangerous one)

There is **no** revert path for an applied migration. `git revert` on a migration file removes
it from the repo; it does not undo what it did to the database. The only recovery is a restore
from backup, and **backup/restore capability is UNVERIFIED** (see above). This asymmetry is the
entire reason `supabase/migrations/**` is T0 and attended-only.
