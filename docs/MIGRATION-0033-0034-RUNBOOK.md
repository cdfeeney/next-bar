# Attended runbook — apply 0033 then 0034

Written 2026-07-30 for the attended migration window. **This document applies nothing.**
Every command here is for a human operator at a keyboard, watching the output.

Governing gate: the T0 live-revenue gate in `~/.claude/rules/common/development-workflow.md`
(revert point → pre-deploy exercise → post-deploy smoke). `tier-classify.mjs` now
returns **T0** for `supabase/migrations/**`, because `.claude/tier-map.json` was
created and declares this project's T0 surface. (An earlier draft of this line said
the classifier returned T1 for want of a map — true when written, fixed since.)

## What is being applied, and why the order is fixed

| File | Effect | Depends on |
|---|---|---|
| `0033_vibe_profiles.sql` | Creates `public.vibe_profiles` + owner-only RLS + revoke-first grants + LWW trigger | nothing |
| `0034_revoke_first_grants.sql` | Revoke-first grants on `profiles`, `ratings`, `pairwise_comparisons`; extends the `profiles` column grant to `shares_list_publicly` | nothing |
| `0035_share_night_date_bound.sql` | Adds the `current_date ± 2` bound to `share_night` (C4 F1) | nothing |

**`0035` was authored after this runbook's first draft** and joins the same window. The
sequence to rehearse and apply is therefore **`0033` → `0034` → `0035`**, and the staging
rehearsal must cover all three, not just the first two. `0035` is a `create or replace` of one
function with no data effect, so it is the least risky of the three — but it still gets its own
verification step (step 5b) rather than being assumed.

They are independent in content but **must be applied 0033 first**, because that is
lexical order and `scripts/apply-migrations.ts` applies files in lexical order in a
single pass. Verify 0033 before starting 0034; if 0033 fails verification, stop.

## Facts established by reading the runner (not assumed)

- **Each migration file runs inside its own transaction.** `scripts/apply-migrations.ts`
  issues `begin`, the file body, the ledger insert, then `commit`, with `rollback` on
  error. Two consequences that matter here:
  - `0034`'s `revoke all … / grant …` sequence is **atomic**. There is no window in
    which a signed-in user has lost privileges but not yet regained them.
  - A failure can never leave a file recorded as applied when it was not.
- **The runner aborts on drift.** It checksums each file and compares against
  `public.schema_migrations`. A file edited *after* being applied stops the entire run
  with `ABORTED — these migrations were edited after being applied`.
  **This matters here:** `0033_vibe_profiles.sql` was amended in commit `926f498`
  (grants added). That is safe only because 0033 has never been applied. Confirm that
  before doing anything else — step 1.
- Ledger shape: `public.schema_migrations (name text primary key, checksum text not null,
  applied_at timestamptz not null default now())`.

## Step 1 — Record the revert point and confirm the ledger

```bash
git rev-parse HEAD                        # record this; it is the rollback target
git status --short                        # must be clean
```

```sql
-- Expected: the newest name is 0032_*. 0033 and 0034 MUST NOT appear.
select name, applied_at
  from public.schema_migrations
 order by name desc
 limit 5;
```

**Stop if `0033_vibe_profiles.sql` already appears.** It was amended after authoring, so a
prior apply plus the amendment is exactly the drift case, and the runner will refuse.

## Step 2 — Backup / restore point

Take the Supabase backup (or confirm the automated one) and **record its identifier here**
before applying. Do not proceed on the assumption that a backup exists — this is one of the
items the production-readiness mission lists as UNVERIFIED.

## Step 3 — Apply

```bash
npm run db:migrate
```

The runner reads `DATABASE_URL` from `.env.local`, skips already-applied files by checksum,
and applies `0033` then `0034`. Watch for `ok` after each.

## Step 4 — Verify 0033 BEFORE trusting 0034

```sql
-- table + RLS
select relname, relrowsecurity
  from pg_class where oid = 'public.vibe_profiles'::regclass;
-- expect: vibe_profiles | t

-- exactly four owner-scoped policies
select policyname, cmd
  from pg_policies
 where schemaname = 'public' and tablename = 'vibe_profiles'
 order by policyname;
-- expect: 4 rows — SELECT, INSERT, UPDATE, DELETE

-- LWW trigger present
select tgname from pg_trigger
 where tgrelid = 'public.vibe_profiles'::regclass and not tgisinternal;
-- expect: vibe_profiles_lww

-- grants: authenticated only, no anon
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'vibe_profiles'
   and grantee in ('anon','authenticated','PUBLIC')
 order by grantee, privilege_type;
-- expect: authenticated × {SELECT, INSERT, UPDATE, DELETE}. NO anon row.
```

## Step 5 — Verify 0034 (the revoke/grant check)

```sql
-- table-level privileges on the three tables
select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('profiles','ratings','pairwise_comparisons')
   and grantee in ('anon','authenticated','PUBLIC')
 order by table_name, grantee, privilege_type;
```

Expected exactly:

| table | grantee | privileges |
|---|---|---|
| `pairwise_comparisons` | authenticated | DELETE, INSERT, SELECT — and **no UPDATE** |
| `profiles` | authenticated | INSERT, SELECT (UPDATE is column-scoped, see below) |
| `ratings` | authenticated | DELETE, INSERT, SELECT, UPDATE |

**No `anon` or `PUBLIC` row may appear for any of the three.**

```sql
-- the column-scoped UPDATE grant on profiles (C3 F5)
select column_name, privilege_type
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'profiles'
   and grantee = 'authenticated' and privilege_type = 'UPDATE'
 order by column_name;
-- expect exactly: display_name, is_private, shares_list_publicly
-- `handle` MUST NOT appear — 0006 removed it deliberately so handles cannot be
-- PATCHed around claim_handle's rate cap and no-renames rule.
```

## Step 5b — Verify 0035 (`share_night` date bound)

```sql
-- The guard must be present in the installed function body.
select pg_get_functiondef('public.share_night(date, text[], text)'::regprocedure)
       like '%current_date - 2%' as has_lower_bound,
       pg_get_functiondef('public.share_night(date, text[], text)'::regprocedure)
       like '%current_date + 2%' as has_upper_bound;
-- expect: t | t

-- Execute privilege unchanged: authenticated only, never anon.
select grantee, privilege_type
  from information_schema.role_routine_grants
 where routine_schema = 'public' and routine_name = 'share_night'
   and grantee in ('anon','authenticated','PUBLIC');
-- expect: authenticated / EXECUTE only
```

Behavioural check with a synthetic account (staging only): calling `share_night` with a night
more than two days away must raise `night must be within 2 days of today`, and a night within
the window must still return a token.

## Step 5c — Verify the SEAMS between the three migrations

Raised by GLM: each file reviewed alone looks fine; the failure mode lives between them.
All four were checked against the current files and none applies to this set — but run
them anyway after applying, because they are the checks that would have caught it.

```sql
-- 1. SECURITY DEFINER runs as the function OWNER, not the caller. Confirm 0034's
--    revoke did not strip the owner's access to the tables these functions read.
select proname, proowner::regrole
  from pg_proc
 where pronamespace = 'public'::regnamespace and prosecdef
 order by proname;

-- 2. 0034's revoke targets vs 0033's grant targets must not intersect.
--    Verified disjoint at author time: 0033 grants only on vibe_profiles;
--    0034 revokes only on profiles / ratings / pairwise_comparisons.

-- 3. The ledger must record ALL THREE, in order — not merely "it applied".
select name, applied_at from public.schema_migrations
 where name like '003%' order by name;
-- expect 0033, 0034, 0035
```

Also confirmed by reading `scripts/apply-migrations.ts`: on any failure it rolls back,
sets a non-zero exit code and **returns** — it does not continue to later files. So a
failed `0033` stops the window and `0035` never installs. That matters because PL/pgSQL
resolves table references at execution, not at `create or replace` time, so a function
CAN install successfully against objects that do not exist yet.

## Step 6 — Two-browser vibe-profile smoke (authoritative)

This is the gate that actually proves G1 works; the SQL above only proves the schema.

1. Sign in as account A in browser 1. Complete the quiz. Confirm a `vibe_profiles` row exists for A.
2. Sign in as the **same** account A in browser 2 (different browser/profile, not a tab).
   Confirm the profile **hydrates** without retaking the quiz.
3. Sign in as a **different** account B in browser 2. Confirm B **never** sees A's profile.
4. In Settings, use "Clear your saved vibe profile" as A. Confirm the server row is gone
   **and** does not resurrect after a reload (the local clear alone used to be undone by the
   next sign-in hydrate).

## Step 7 — Stop conditions

Stop immediately, and roll back rather than diagnose forward, if:

- the runner prints `ABORTED` (drift) or `FAILED` for either file;
- step 4 or step 5 returns anything other than the expected rows;
- an `anon` grant appears on any of the four tables;
- `handle` appears in the profiles column-privilege list;
- step 6 shows one account seeing another account's profile — this is the failure that
  matters most and it is a privacy incident, not a bug report.

## Step 8 — Rollback and forward-fix

Both migrations are **expand-only** — 0033 adds a new table, 0034 only narrows grants.
Neither drops or rewrites user data, so rollback is low-risk:

```sql
-- 0034 rollback (restores the pre-migration default grants)
grant all on table public.profiles             to anon, authenticated;
grant all on table public.ratings              to anon, authenticated;
grant all on table public.pairwise_comparisons to anon, authenticated;
revoke all on table public.ratings from anon;                        -- restore 0015:96
revoke update on table public.profiles from public, anon, authenticated;
grant update (display_name, is_private) on table public.profiles to authenticated;  -- restore 0006

-- 0033 rollback
drop trigger if exists vibe_profiles_lww on public.vibe_profiles;
drop function if exists public.vibe_profiles_lww_guard();
drop table if exists public.vibe_profiles;   -- destroys stored vibe profiles
```

Then delete the corresponding `public.schema_migrations` rows, or the runner will consider
them applied.

**Prefer forward-fix for 0034.** Rolling it back re-opens the default grants, which is
strictly worse than the state you were trying to reach. If step 5 shows a wrong grant, issue
the corrected `grant`/`revoke` rather than reverting the whole file.

## Compatibility — old client vs new schema

| Direction | Verdict | Why |
|---|---|---|
| Old app (pre-`be45c58`) + migrated schema | **Compatible** | 0033 only ADDS a table an old client never references. 0034 narrows grants to exactly the verbs the shipped client already uses. |
| New app (HEAD) + un-migrated schema | **Compatible** | `deleteServerVibeProfile` and the sync path already forgive a missing table (`42P01` / `PGRST205`); vibe profiles simply stay localStorage-only. |
| New app + migrated schema | Target state | — |

The one privilege 0034 removes that any client could theoretically have used is **UPDATE on
`pairwise_comparisons`**. Verified against `src/lib/pairwise.server.ts`: it uses `select`,
`insert` and `delete` only, and `0002:55` records that comparisons are immutable by design.
Nothing in the shipped client updates that table.

This is a clean expand/contract *expand* step. No destructive cleanup is bundled; if any is
ever wanted (for example dropping the old default grants entirely), it belongs in a later
release once old clients are gone.

---

## Not verified by this document

**The clean-database apply proof is missing, and this run could not produce it.** The goal
spec asks that both migrations be applied to a clean throwaway database and proven
idempotent. That requires a Postgres engine. Verified absent on this machine:

| Probe | Result |
|---|---|
| `docker` | not installed |
| `supabase` CLI | absent |
| `pg_ctl` / `initdb` | absent |
| `@electric-sql/pglite`, `pg-mem` | absent from `node_modules` |
| `pg` | present, but a **client** library — it needs a server |

The only reachable Postgres is production, and connecting to it was forbidden for this run.
So the following remain **outstanding** and must be done in the attended window or after a
local engine is installed:

1. Apply `0000`–`0034` to a clean database and confirm a fresh environment builds from
   committed migrations alone.
2. Apply twice to prove idempotency (expect the checksum ledger to skip the second pass).
3. Note that a clean-database rehearsal also needs the **Supabase-specific** `auth` schema
   stubbed — the migrations reference `auth.users` and `auth.uid()`, which vanilla Postgres
   does not provide. That stub does not exist in this repository yet.

Installing Docker Desktop or the Supabase CLI unblocks all three.
