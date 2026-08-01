# Migration 0036 — ledger hardening review packet

## Decision requested

Approve or reject an additive T0 security fix for `public.schema_migrations`.
Review the code locally; do not apply it during review.

## Confirmed finding

Supabase Security Advisor reported RLS disabled on the migration ledger. A
read-only staging probe confirmed the impact:

| Check | Before 0036 |
|---|---|
| RLS enabled | false |
| anon SELECT | true |
| authenticated SELECT | true |
| anon INSERT/UPDATE/DELETE | true |
| authenticated INSERT/UPDATE/DELETE | true |

The table contains no user secrets, but its integrity is security-sensitive:
the runner trusts it to skip already-applied migrations and detect checksum
drift. A browser role must not be able to add, alter, or delete those records.

## Design

Two controls close different windows:

1. `0036_protect_schema_migrations.sql` repairs existing databases by enabling
   RLS and revoking all table privileges from `PUBLIC`, `anon`, and
   `authenticated`. It creates no policies, so browser roles have no path.
2. `MIGRATION_LEDGER_DDL` performs CREATE, ENABLE RLS, and REVOKE in one SQL
   batch. A fresh database is therefore protected before its first ledger row
   becomes visible, and an existing runner invocation repairs the ledger before
   trusting its contents.

The migration owner retains access. `service_role` is not named by the revoke.
No application code reads `schema_migrations`, so old and new app clients are
compatible.

## Alternatives rejected

- **Dashboard/SQL hotfix only:** not version-controlled and the next fresh
  database repeats the defect.
- **RLS only:** closes current row access but leaves dangerous direct grants
  waiting for a future RLS mistake.
- **REVOKE only:** fails the Supabase RLS control and a future grant can reopen
  the table.
- **Move the ledger to a private schema now:** cleaner eventually, but changes
  runner identity and historical operational assumptions for no immediate gain.
- **FORCE RLS:** unnecessary and risks preventing the table owner from recording
  the migration that enables the control.

## Blast-radius report

1. **Blast radius:** one internal table and the migration runner's ledger setup.
2. **Detection:** structural tests, full suite, staging privilege probes, and the
   Supabase Security Advisor.
3. **Recovery:** privileged migration ownership remains available. Emergency
   rollback is documented but intentionally restores the insecure state.
4. **Data:** no user, catalog, review, rating, photo, or authentication data is
   read or changed.
5. **Access:** browser roles lose access; privileged migration ownership remains.
6. **Cost:** no external API calls and no meaningful runtime cost.
7. **Compatibility:** web/mobile clients never consume this table.
8. **Ownership:** operator applies staging first and verifies before Production.
9. **Business value:** prevents falsifying the database deployment ledger.

## Acceptance requirements

- migrations `0000–0035` remain byte-for-byte unchanged;
- 0036 enables RLS and revokes `PUBLIC`, `anon`, and `authenticated`;
- no policy or browser grant is introduced;
- the fresh-ledger batch applies the same controls immediately;
- ledger hardening occurs before the runner reads ledger rows;
- the migration can still insert its own ledger entry as the owner;
- tests, typecheck, secret scan, whitespace checks, and historical diff pass;
- no database, push, deployment, merge, baseline, or Production action occurs
  during review.

## Stated limits of the local evidence

Named here so the gaps are stated rather than implied by a green suite.

1. **Text tests prove SQL strings, never privilege state.** Every assertion in
   `src/lib/migration0036.test.ts` is a regex or an ordering check over source
   text. None of them proves that `anon` actually lacks `SELECT` after the
   statements run. Behavioral privilege proof is deferred, by constraint, to
   §4 of `MIGRATION-0036-STAGING-RUNBOOK-2026-08-01.md`, which probes
   `has_table_privilege` on a real database. Do not read a green suite as
   proof that RLS is enforced.
2. **The revoke names three roles, and only those three.** `public`, `anon`, and
   `authenticated` are the roles Supabase's default grant targets, and no other
   role exists in this project. A privilege granted to some future custom role
   would survive this migration untouched — the sweep test in
   `src/lib/migration0036.test.ts` is what catches that, not the migration.
3. **Default privileges are the residual re-arm path, and are accepted.** No
   migration in `0000`–`0036` executes `alter default privileges`; `0019:79`
   mentions it only to record that the house pattern is per-object
   revoke-first instead. What remains outside the repository is Supabase's own
   platform-level default — described at `0034:13` as
   `grant all on all tables in schema public to anon, authenticated`. So if
   `public.schema_migrations` is ever dropped and recreated **outside** the
   runner (a dashboard action, a reset script, a future migration), the
   browser-role grants return and 0036 will not re-run to remove them. The
   runner's `MIGRATION_LEDGER_DDL` re-applies both controls on its next
   invocation, which bounds the exposure to the window before the next
   migration run. Accepted as residual rather than fixed: closing it properly
   means moving the ledger to a private schema, which changes runner identity
   and is out of scope here.
4. **The runner must connect as the table owner (or another BYPASSRLS role).**
   After this migration the ledger has RLS enabled and *no* policies, so access
   is by ownership, not by grant. If `DATABASE_URL` is ever repointed at a
   lower-privilege role, the hardening statements and the runner's own ledger
   INSERT will both fail. Both are **fail-closed** — neither can silently record
   a migration that did not run — but they abort with *different* diagnostics,
   which matters when debugging a real `permission denied for table
   schema_migrations`:
   - the **hardening** call (`scripts/apply-migrations.ts:355`) runs before any
     file is in scope and is not wrapped in a local `try`. It propagates to the
     top-level `main().catch`, which prints the raw driver error with **no**
     filename;
   - the **ledger INSERT** inside the per-file loop is wrapped, so it rolls the
     transaction back and prints `Error applying <file>`.
   A permission error with no filename therefore points at the connection
   string, not at any particular migration.
5. **Ledger integrity holds against unprivileged callers only.** This change
   removes the *browser-role* path. It does not, and cannot, protect the ledger
   from anyone already holding a privileged connection string: checksums are
   plain SHA values that any owner-level caller can recompute and rewrite. The
   boundary is therefore *caller privilege* **and** the absence of
   privilege-escalation paths — an unaudited `SECURITY DEFINER` function in
   `public` that touches this table would also defeat it, since a definer
   function runs with its owner's rights and is unaffected by these revokes.
   Signing ledger rows would address the first; the standing RLS/definer
   inventory covers the second. Both are deliberately out of scope here.
   The assertions in `src/lib/migration0036.test.ts` are also **textual
   heuristics, not structural proofs** — they read source text rather than an
   AST, and are strong enough to catch the regressions demonstrated in review
   (an appended `grant`, a commented-out hardening call, a diverged copy)
   without being a substitute for the staging privilege probe.
6. **Atomicity rests on a documented PostgreSQL property, asserted only
   indirectly.** A multi-statement parameterless query is executed as one
   implicit transaction, so CREATE + ENABLE RLS + REVOKE commit together. Two
   tests pin the preconditions — the DDL carries no explicit transaction
   control, and the runner passes no parameters — but the property itself is
   PostgreSQL's, not something this suite can demonstrate without a database.

## Deferred follow-ups (raised in review, deliberately not done here)

Each is a real improvement rejected for *this* change because it adds unreviewed
runtime or structural risk to a T0 path after the final review round.

1. **Share one SQL fragment between the two controls** (build-time extraction or
   a fragment file imported by both), which would delete the anti-drift test
   rather than rely on it. Right structural answer; restructures a T0 runner
   path. Do it as the first commit of a fresh reviewed round.
2. **Security-definer accessor functions** (`migration_state()` /
   `record_migration()`), so the runner need not hold an owner-level connection
   at all. Materially better for shared CI or multi-operator settings; a larger
   design change than this fix.
3. **Startup assertion that RLS is still enabled** — cheap catalog read that
   would abort the runner if a platform restore silently re-armed the default
   grants. Needs a database round-trip, so it cannot be verified in this
   session; add it with the staging evidence.
4. **Post-restore / post-branch privilege probe.** The runner self-heals on its
   next invocation, but a restored or branched database is exposed until then.
   Add the runbook's `has_table_privilege` probe to the restore checklist.

## Multi-model review lanes

Treat this as T0 and require all five families:

1. **Claude:** trace fresh and existing database execution order.
2. **Codex:** audit PostgreSQL privilege/RLS semantics and transaction visibility.
3. **DeepSeek:** attack bypasses through inherited grants, ownership, interrupted
   runs, drift, and partial ledgers.
4. **GLM:** verify Supabase/PostgREST role behavior and Advisor closure.
5. **Kimi:** challenge compatibility, recovery, and whether dual controls drift.

No majority override: any evidence-backed dissent must be resolved and rerun.

## Local implementation evidence

Recorded before any database contact or migration application:

- focused migration and runner tests: 100/100 passed across 2 files;
- full unit suite: 1674/1674 passed across 104 files;
- every guard in this suite was proven RED before green, each mutation reverted:
  dropping `authenticated` from the runner DDL's revoke failed the drift and
  ordering assertions; appending `grant select ... to anon` to the runner DDL
  passed all 11 then-existing tests and failed only the new allow-list and
  negative assertions; commenting out the hardening call failed both ordering
  assertions; and injecting a `grant` into a migration file failed the
  directory-wide re-arm sweep;
- TypeScript typecheck: clean;
- tracked-file secret scan: clean across 505 files;
- manual assignment-pattern scan of every new untracked file: clean;
- whitespace check: clean apart from pre-existing CRLF conversion warnings in
  operator-owned documentation files;
- migrations `0000` through `0035`: byte-for-byte unchanged from `f11d94b`;
- no database, push, deploy, merge, reset, or baseline action occurred.

This evidence approves the implementation for independent T0 review. It does
not approve applying `0036` to staging or Production.
