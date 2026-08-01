# Attended fresh-staging bootstrap runbook — 2026-07-31

Use this only after the implementation review converges. This is an attended,
staging-only operation. Never run it in an overnight loop.

## Why staging must start over

The current staging database recorded migrations through `0027` while
`public.bars` was empty. Those data migrations may have silently done nothing.
The new bootstrap intentionally refuses that ambiguous state. Do not delete
ledger rows, hand-insert the three missing venues, use `--baseline`, or continue
from `0028`.

## A. Recreate/reset the empty staging project

1. Confirm the Supabase project is named `next-bar-staging` and is not Production.
2. Save no staging user data; it must be synthetic and disposable.
3. Recreate the project, or use Supabase's supported reset path that returns the
   database to a genuinely empty project state. This step is destructive and
   must be performed by the operator in the Supabase dashboard.
4. If recreation changes the project reference, obtain the new project URL,
   publishable/anon key, secret/service-role key, database password, and
   transaction-pooler URI. Store secrets in the password manager, not this file.

## B. Point only the local worktree at staging

1. In `C:\Users\cdfee\projects\nb-overnight\.env.local`, replace the four
   staging values if the project reference changed:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `DATABASE_URL`.
2. Confirm the URL/project reference is staging. Do not print secret values.
3. Confirm the shell is in `C:\Users\cdfee\projects\nb-overnight`.
4. In PowerShell, ensure unattended mode is absent and declare BOTH the target
   environment and the project that must never be bootstrapped:

   ```powershell
   Remove-Item Env:LOOP_UNATTENDED -ErrorAction SilentlyContinue
   $env:NEXT_BAR_DATABASE_ENVIRONMENT = 'staging'
   $env:NEXT_BAR_PRODUCTION_PROJECT_REF = '<production project ref>'
   ```

   `NEXT_BAR_PRODUCTION_PROJECT_REF` is **required** — bootstrap refuses to run
   without it. The environment label alone is an honour system: a stale
   `staging` label in a shell whose `.env.local` still points at Production
   satisfies every other check, because the two URLs agree with each other —
   they just agree on the wrong project. The declared Production reference is
   the one check the label cannot talk its way past. It is a project reference,
   not a secret, but put it in `.env.local` rather than retyping it per shell so
   the protection is not one forgotten `$env:` away from being absent.

5. Ensure no Production database credential exists in this shell or `.env.local`.
   The bootstrap also derives the Supabase project references from
   `NEXT_PUBLIC_SUPABASE_URL` and `DATABASE_URL`, refuses if they differ, and
   refuses if either equals `NEXT_BAR_PRODUCTION_PROJECT_REF`.

## C. Preflight locally

Run:

```powershell
npm run typecheck
npm test
npm run secret-scan
git diff --check
git diff --exit-code -- supabase/migrations
git status --porcelain -- supabase/migrations
```

Expected: typecheck clean; **1653 tests passing across 103 files**; secret scan
clean; no whitespace errors; **no** migration-file diff; and the last command
prints **nothing** — a new file under `supabase/migrations` is as much a
violation of the byte-freeze as an edit to an existing one. Stop if any command
fails or any count is lower than stated.

Run the whole suite rather than the two focused files: the bootstrap's guards
share `src/lib/migrationPlan.ts` with the ordinary `db:migrate` path, so a
regression there can surface anywhere.

**One known flake.** `src/lib/catalog.test.ts > perf budget (B1: full match over
5k bars)` asserts a 50ms wall-clock budget and fails on a loaded machine (seen
once in eight runs at 106ms). It is unrelated to the bootstrap and to
`src/lib/catalog.ts`, which this change does not touch. If it is the **only**
failure, close other work and re-run once. **Any other failing test is a stop** —
do not proceed to the staging build.

## D. Build staging from zero

Run exactly:

```powershell
npm run db:bootstrap
```

Do not use `db:migrate`, `--baseline`, or `--force-baseline` for this fresh build.
Save the complete terminal output. Stop on the first error; do not patch around it.

## E. Prove the ledger and bootstrap postconditions

In the staging Supabase SQL editor, run:

```sql
select count(*) as migration_count,
       min(name) as first_migration,
       max(name) as last_migration
from public.schema_migrations;

select name
from public.schema_migrations
order by name;

select to_regclass('public._next_bar_bootstrap') as bootstrap_marker,
       (select count(*) from public.bars) as bars_after_migrations;

select id, place_id, business_status, lat, lng, address
from public.bars
where id in ('dominies-astoria', 'flemings-pub', 'the-slaughtered-lamb-pub')
order by id;
```

Require all of the following:

- the ordered ledger contains all 36 files and ends at
  `0035_share_night_date_bound.sql`;
- `bootstrap_marker` is `null`;
- `bars_after_migrations` is 410;

> **Known and accepted before you run this:** migrations `0029`–`0032` will
> report success having updated **zero** rows. Their targets are already at the
> OSM coordinates the migrations set, because `src/lib/bars.ts` was corrected in
> the same historical commits. Verified mechanically: 34/34, 258/258, 124/124
> and 2/2 targets are bit-identical to their migration's own values, so each
> guarded `UPDATE ... WHERE abs(diff) > 1e-6` is a no-op and each migration's
> own "0 remaining" assertion passes trivially. The resulting catalog is
> correct; what this rehearsal does **not** prove is that those four migrations'
> UPDATE logic works. `0026`, `0027` and `0028` **are** genuinely exercised.
> Treat 0029–0032 as unrehearsed until someone decides whether to offset the
> fixture coordinates (see the open item in the review packet).
- `dominies-astoria` owns `ChIJUzyXVUdfwokRYzS5v4AZpYw`;
- `flemings-pub` has `CLOSED_PERMANENTLY` and a null `place_id`;
- `the-slaughtered-lamb-pub` is at approximately
  `40.7323542, -74.0018245` with the West 4th Street address.

If any assertion fails, preserve evidence and stop. Recreate staging before the
next attempt; do not edit migration history or the ledger.

## F. RLS and grants proof

Run the repository's focused RLS/security tests documented for migrations
`0033`–`0035`. In the SQL editor, also inspect enabled RLS and grants rather than
assuming migration success equals policy success:

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;
```

Compare the result to the checked-in migration expectations. Unexpected access
is a release blocker.

## G. Two-browser profile proof

1. Start the application locally against staging.
2. In Browser A, create a synthetic account and complete/save a vibe profile.
3. In Browser B (a separate browser profile/private context), sign into the same
   synthetic account.
4. Confirm the same profile and version appear without copying local storage.
5. Change the profile in Browser B; refresh Browser A and confirm the documented
   synchronization behavior.
6. Sign out, clear browser storage, sign back in, and confirm the server copy returns.
7. Delete the synthetic account after the test and confirm its intended cleanup path.

Record browser versions, project reference (never keys), commit SHA, screenshots,
and pass/fail evidence. Only then may the fresh-database goal be marked complete.
