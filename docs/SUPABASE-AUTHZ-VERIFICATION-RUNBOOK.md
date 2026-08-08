# Supabase authorization verification runbook

> **RUNNING THIS REQUIRES SEPARATE ATTENDED AUTHORIZATION.**
> Every command below is **read-only**, but read-only against a production
> database is still a production database operation. Do not run any of it as
> part of an unattended loop, a CI job, or an agent session.
> **Staging first, Production second, never in parallel.**

## Why this exists

The 2026-08-07 security audit closed every gap it could reach in the
repository — 26 focused test files, 415 tests passing, no production
raw-HTML/eval sinks — and left exactly one it could not reach:

> **Deployed RLS parity is unverified.** Nobody has evidence that Staging and
> Production actually enforce the policies, grants and `SECURITY DEFINER`
> protections the migrations describe.

Migrations describe *intent*. A deployed database holds *state*. They diverge
when a migration is applied by hand, applied partially, rolled back in the
dashboard, or edited after being applied. This runbook is how you find out —
it does not, by itself, prove anything.

**What this document is not:** it is not evidence. Until an operator executes
it against Staging and then Production and records the results, deployed RLS
parity remains **UNVERIFIED**.

## The expected surface (generated, not hand-written)

Regenerate before every run, so this document cannot drift from the schema:

```bash
npx tsx scripts/lib/authzSurface.report.mts
```

As of migration `0043`, that reports:

| Property | Expected |
| --- | --- |
| Migrations | 39 files, `0000`..`0043` |
| Tables created | 21 |
| Tables with RLS enabled | 21 of 21 — **no exceptions** |
| Functions parsed | 41 |
| `SECURITY DEFINER` functions | 29 |
| Definer functions missing a pinned `search_path` | **0** |
| Grant roles used | `anon`, `authenticated`, `service_role` |
| Service-role-only tables | `analytics_events`, `rate_limits` |

The same numbers are asserted by `scripts/lib/authzSurface.test.ts`, which
runs in the ordinary test suite. If that suite is green, the *expectations*
below are current; only the *deployed* side is unknown.

**Known numbering gap, decided not to be an error:** prefixes `0037`–`0041`
are absent on this base. Related migrations live on the release branches
(`nb-prod-migrations-0042`, `nb-release-migrations`). The static test asserts
there are no **duplicate** prefixes — the genuinely dangerous case — and
deliberately does not assert the absence of gaps. **Open question for the
operator:** confirm whether 0037–0041 were applied to Staging/Production from
a release branch, because if they were, this base's ledger comparison will
show them as unknown-to-the-repo rather than as drift.

---

## Before you start

1. Have the Supabase dashboard open for the **Staging** project only.
2. Use the SQL editor, or `psql` with a **read-only** role if one exists.
3. Never paste a connection string, project ref, service-role key, or JWT into
   this file, a commit, a ticket, or an agent session. Refer to secrets by
   environment-variable name only (`DATABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_KEY_SALT`).
4. Record results in a scratch file, not in this document.

---

## Check 1 — RLS is enabled on every table

**Query**

```sql
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
```

**Expected:** every row `rls_enabled = true`. 21 rows on this base.

**On mismatch:** a table with `rls_enabled = false` is **stop-and-escalate**.
Any role holding a grant on it can read or write every row regardless of
policy. Do not "fix in place" on Production — record the table, check whether
Staging shows the same, and treat it as an incident.

---

## Check 2 — Policies exist where they are relied upon

**Query**

```sql
select schemaname, tablename, policyname, permissive, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

**Expected:** every table EXCEPT the two service-role-only counters
(`analytics_events`, `rate_limits`) has at least one policy.

**Those two must have ZERO policies.** That is deliberate, not an oversight:
RLS is enabled and no policy exists, so the default deny applies to every
client role and only the service role (which bypasses RLS) can write. A policy
appearing on either is **stop-and-escalate** — it would open a client-side
path to a counter that is supposed to have none.

**On mismatch elsewhere:** a table with RLS on and no policy is *closed*, so
it fails safe, but it means a feature is silently broken. Record it; it is a
bug, not a breach.

---

## Check 3 — Grants match the design

**Query**

```sql
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
group by table_name, grantee
order by table_name, grantee;
```

**Expected:** no row where `table_name` is `analytics_events` or
`rate_limits` and `grantee` is `anon` or `authenticated`.

**On mismatch:** any grant to `anon` on those two tables is
**stop-and-escalate** — an anonymous caller could read or forge counters,
including the rate-limit counters that bound account deletion.

---

## Check 4 — `SECURITY DEFINER` functions pin `search_path`

**Query**

```sql
select p.proname, p.prosecdef as is_security_definer, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by p.proname;
```

**Expected:** 29 rows, and **every** row's `proconfig` contains a
`search_path=` entry.

**Why this one matters most.** A `SECURITY DEFINER` function runs with the
*owner's* privileges. Without a pinned `search_path`, a caller can put a
schema they control ahead of `public` and make the function resolve to their
table, view, or operator instead of yours — privilege escalation using your
own function as the vehicle. This is the single highest-value check here.

**On mismatch:** a definer function with a null or `search_path`-less
`proconfig` is **stop-and-escalate**.

---

## Check 5 — Definer functions still check the caller

Grep the local source for the authorization check each definer function is
supposed to perform, then confirm the deployed body matches:

```sql
select prosrc from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = '<function name>';
```

**Expected:** the deployed body is identical to the definition in
`supabase/migrations/`. Functions acting on behalf of a user must derive that
user from `auth.uid()` — never from a parameter.

**On mismatch:** a deployed body that differs from the migration means someone
edited it in the dashboard. **Stop-and-escalate** and capture the deployed
body before anyone changes it.

---

## Check 6 — Migration ledger parity

`scripts/apply-migrations.ts` hashes each file and records it in
`public.schema_migrations`, so an already-applied migration is skipped by
checksum and an edited-after-apply file is reported as drift.

**Query**

```sql
select name, applied_at, checksum
from public.schema_migrations
order by name;
```

**Compare against** the 39 local files. Three outcomes:

| Outcome | Meaning | Action |
| --- | --- | --- |
| Local file, no ledger row | Never applied to this environment | Expected for `0043` right now — it is deliberately unapplied. Otherwise, plan an attended apply. |
| Ledger row, no local file | Applied from another branch (likely `0037`–`0041`) | Record which branch; not drift by itself. |
| Both present, checksums differ | **File was edited after being applied** | **Stop-and-escalate.** The database and the repository disagree about what ran. |

Do not "fix" a checksum mismatch by re-applying or by editing the file to
match. Capture both versions first.

---

## After the run

Record, per environment: the date, who ran it, each check's outcome, and every
mismatch verbatim. Then update the audit's open item — deployed RLS parity is
verified **only** for the environment you actually ran against, on the date you
ran it.

**Do not** mark Production verified because Staging passed. They are different
databases and the whole point of this document is that intent and state
diverge independently.

## Scope boundary

This runbook covers what is on **this base** (through `0043`). Migrations
living only on release branches are out of scope and are the open question
recorded above.
