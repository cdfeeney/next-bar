# Supabase authorization verification runbook

> **RUNNING THIS REQUIRES SEPARATE ATTENDED AUTHORIZATION.**
> Every command below is **read-only**, but read-only against a production
> database is still a production database operation. Do not run any of it as
> part of an unattended loop, a CI job, or an agent session.
> **Staging first, Production second, never in parallel.**

## Why this exists

The 2026-08-07 security audit closed every gap it could reach in the
repository and left exactly one it could not:

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

## The expected surface is GENERATED, not hand-written

Regenerate before every run:

```bash
npx tsx scripts/lib/authzSurface.report.mts
```

Everything in the tables below comes from that command, which parses
`supabase/migrations/*.sql`. `scripts/lib/authzSurface.test.ts` asserts the
same derivations in the ordinary test suite, and — this is the part that keeps
the document honest — it asserts that the derived sets **equal** the reviewed
allowlists in `scripts/lib/authzSurface.ts`. A new policy-less table, a new
`grant ... to anon`, or a new anonymous RPC therefore fails the test suite
rather than silently making this document wrong.

That guard exists because the hand-written version of this document was wrong
in exactly that way. Its Check 2 claimed every table but two had a policy;
eight more do not. The cause is worth stating, because it will bite the next
person verifying by hand: **every `create policy` in this repository puts its
`on public.<table>` clause on the following line, and the policy names are
quoted and contain colons** (`"profiles: owner can read own"`). A line-oriented
grep finds *zero* policies and reports every table as policy-less.

| Property | Expected |
| --- | --- |
| Migrations | 39 files, `0000`..`0043` |
| Tables created by migrations | 21 |
| Tables created by the migration runner | 1 (`schema_migrations`) |
| **Tables in a healthy `public` schema** | **22** |
| Tables with RLS enabled | 22 of 22 — **no exceptions** |
| Policies | 29, across 13 tables |
| Tables with RLS and zero policies (default-deny, deliberate) | 9 |
| Functions parsed | 41 |
| `SECURITY DEFINER` functions | 29 |
| Definer functions missing a pinned `search_path` | **0** |
| Tables granting anything to `anon` | 2 (`bars`, `bar_photos` — `select` only) |
| Functions executable by `anon` | 2 (`get_public_ratings`, `get_shared_night`) |
| Tables relying on Supabase default grants | **0** — all 21 are revoke-first |

**`schema_migrations` is the table people miss.** It is created by
`MIGRATION_LEDGER_DDL` in `scripts/lib/migrationLedger.ts`, not by any numbered
migration, so a parser reading only `supabase/migrations/` cannot see it —
while migration `0036` *does* enable RLS on it. It is a real table in a healthy
`public` schema. Expect 22, not 21.

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

**Expected:** **22 rows**, every one with `rls_enabled = true`:

```
account_content_state  analytics_events       bar_change_queue  bar_photos
bar_rsvps              bar_suggestions        bars              follow_attempts
follow_requests        follows                handle_claim_attempts
handle_search_attempts pairwise_comparisons   photo_permissions profiles
push_subscriptions     rate_limits            ratings           schema_migrations
shared_nights          vibe_profiles          vibe_votes
```

**On mismatch:**

- `rls_enabled = false` on any table is **stop-and-escalate**. Any role holding
  a grant on it can read or write every row regardless of policy. Do not "fix
  in place" on Production — record the table, check whether Staging shows the
  same, and treat it as an incident.
- A table present here but **absent from the list above** was created outside
  the migrations. Record it and find out what created it before doing anything
  else; an unmanaged table is unmanaged in both directions.
- A table in the list above but **absent from the database** means migrations
  were not fully applied. Compare against Check 6 before concluding anything.

---

## Check 2 — Policies exist where they are relied upon

**Query**

```sql
select tablename, count(*) as policy_count, string_agg(policyname, ' | ' order by policyname) as policies
from pg_policies
where schemaname = 'public'
group by tablename
order by tablename;
```

**Expected:** exactly these counts — **29 policies across 13 tables**:

| Table | Policies |
| --- | --- |
| `account_content_state` | 4 |
| `bar_change_queue` | 2 |
| `bar_photos` | 1 |
| `bar_suggestions` | 1 |
| `bars` | 1 |
| `follow_requests` | 1 |
| `follows` | 3 |
| `pairwise_comparisons` | 3 |
| `profiles` | 3 |
| `push_subscriptions` | 1 |
| `ratings` | 4 |
| `vibe_profiles` | 4 |
| `vibe_votes` | 1 |

**These 9 tables must have ZERO policies.** RLS is enabled and no policy
exists, so default-deny applies to every client role and only the service role
(which has `BYPASSRLS`) can reach the rows. Each is deliberate:

| Table | Why it has no policy |
| --- | --- |
| `analytics_events` | service-role-only counter (0018) |
| `rate_limits` | service-role-only counter (0043) |
| `follow_attempts` | rate-limit counter, written by definer RPCs (0007) |
| `handle_claim_attempts` | rate-limit counter, written by definer RPCs (0006) |
| `handle_search_attempts` | rate-limit counter, written by definer RPCs (0006) |
| `shared_nights` | written only through definer RPCs (0016) |
| `photo_permissions` | written only by the service role (0020) |
| `bar_rsvps` | 0012 created `bar_rsvps_delete_own`; **0014 dropped it on purpose** |
| `schema_migrations` | runner-internal ledger, no browser path (0036) |

**On mismatch:**

- A policy appearing on **any of those nine** is **stop-and-escalate** — it
  opens a client-side path to a table designed to have none.
- A **missing** policy on one of the 13, or a lower count than listed, means a
  feature is silently broken. The table still fails *safe* (RLS with no policy
  denies), so it is a bug, not a breach. Record it.
- A **higher** count than listed means a policy was added outside the
  migrations. Capture its definition (`pg_policies.qual`, `.with_check`) before
  anyone changes it, then treat it as stop-and-escalate: an unreviewed policy
  is an unreviewed grant of access.

`bar_rsvps` is the trap. It is the one table whose policy was created and then
deliberately removed, so "it had a policy once" is true and irrelevant.

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

**Expected — this is the complete set the migrations produce.** Every one of
the 21 migration-created tables is *revoke-first* (`revoke all ... from public,
anon, authenticated` before any grant), so Supabase's default
`grant all on all tables in schema public to anon, authenticated` has been
taken away everywhere. That means this table is an exact expectation, not a
lower bound:

| Table | `anon` | `authenticated` | `service_role` |
| --- | --- | --- | --- |
| `account_content_state` | — | select, insert, update, delete | — |
| `analytics_events` | — | — | select, insert, update |
| `bar_change_queue` | — | select, insert | — |
| `bar_photos` | **select** | select | — |
| `bar_rsvps` | — | delete | — |
| `bar_suggestions` | — | delete | — |
| `bars` | **select** | select | select, insert, update, delete |
| `follow_requests` | — | select | — |
| `follows` | — | select | — |
| `pairwise_comparisons` | — | select, insert, delete | — |
| `profiles` | — | select, insert, update *(update is column-scoped: `display_name`, `is_private`, `shares_list_publicly`)* | — |
| `push_subscriptions` | — | select | — |
| `rate_limits` | — | — | select, insert, update, delete |
| `ratings` | — | select, insert, update, delete | — |
| `vibe_profiles` | — | select, insert, update, delete | — |
| `vibe_votes` | — | delete | — |

Tables not listed (`follow_attempts`, `handle_claim_attempts`,
`handle_search_attempts`, `photo_permissions`, `shared_nights`,
`schema_migrations`) grant **nothing** to any of the three roles. They are
reached only by the table owner or by `service_role`, which bypasses both
layers.

**`anon` appears exactly 2 times in that table, `select` only — on `bars` and
`bar_photos`.** That is the product working signed-out: the bar catalog and its
approved photos are public data (0019, 0020).

**On mismatch:**

- **Any** `anon` row other than `select` on `bars` or `bar_photos` is
  **stop-and-escalate**. On `analytics_events` or `rate_limits` specifically,
  it would let an anonymous caller read or forge the counters that bound
  account deletion.
- An `anon` or `authenticated` row on a table listed as granting nothing is
  **stop-and-escalate** — most likely the revoke never ran, leaving Supabase's
  default `grant all` in place.
- A **missing** grant that the table above lists breaks a feature and fails
  safe. Record it as a bug.
- `service_role` holding more than listed is expected and not drift:
  `service_role` bypasses RLS by design and Supabase manages its defaults.

**Do not compare privileges to the policies and expect them to match.** They
are two independent layers and the migrations deliberately keep the grant
narrower in places — `pairwise_comparisons` has no `update` grant *and* no
`update` policy because comparisons are immutable (0002, 0034).

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

**Expected:** 29 distinct definer function names, and **every** row's
`proconfig` contains a `search_path=` entry:

```
accept_follow_request   cancel_follow_request   cast_vibe_vote
claim_handle            decline_follow_request  delete_push_subscription
follow_user             get_circle_rsvps        get_circle_suggestions
get_circle_vibe_votes   get_follow_requests     get_follower_count
get_followers           get_following           get_friend_ratings
get_outgoing_requests   get_profile_by_handle   get_public_ratings
get_shared_night        handle_new_user         pending_change_count
rsvp_bar                save_push_subscription  search_handles
share_night             suggest_bar             unfollow_user
unrsvp_bar              unshare_night
```

A definer function deployed but **absent from this list** was created outside
the migrations — capture its body and `proconfig` and treat it as
stop-and-escalate, since a definer function is by definition a privileged one.

**Why this one matters most.** A `SECURITY DEFINER` function runs with the
*owner's* privileges. Without a pinned `search_path`, a caller can put a
schema they control ahead of `public` and make the function resolve to their
table, view, or operator instead of yours — privilege escalation using your
own function as the vehicle. This is the single highest-value check here.

**On mismatch:** a definer function with a null or `search_path`-less
`proconfig` is **stop-and-escalate**.

> The static parser behind this number reads each function's attributes
> **bounded at its own statement terminator**. An earlier version read to the
> start of the next function, so an unrelated
> `alter function other(...) set search_path = public;` sitting between two
> definitions could mark the preceding *unpinned* function as pinned. No such
> statement exists in the corpus today, but the parser no longer depends on
> that remaining true.

---

## Check 5 — Anonymous entry points are only the two intended ones

**Query**

```sql
select p.proname, r.rolname as grantee
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
join pg_roles r on r.oid = a.grantee
where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and r.rolname = 'anon'
order by p.proname;
```

**Expected:** exactly 2 functions — `get_public_ratings` and
`get_shared_night`. Both are `SECURITY DEFINER` read paths that gate
internally: `get_public_ratings` returns rows only where the owner set
`shares_list_publicly` (0015), and `get_shared_night` is keyed by an opaque
share id (0016).

**On mismatch:** a third name is a new anonymous entry point into the database
and is **stop-and-escalate** — a definer function granted to `anon` reaches
past RLS by design, so its internal gate is the only thing standing between an
anonymous caller and the data.

---

## Check 6 — Definer function bodies still check the caller

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

## Check 7 — Migration ledger parity

`scripts/apply-migrations.ts` hashes each file and records it in
`public.schema_migrations`, so an already-applied migration is skipped by
checksum and an edited-after-apply file is reported as drift.

**Query**

```sql
select name, applied_at, checksum
from public.schema_migrations
order by name;
```

Run it as the **table owner or `service_role`** — 0036 revoked all access from
`anon` and `authenticated`, so a browser-role session sees nothing here, and an
empty result read as "no migrations applied" would be a serious misreading.

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
