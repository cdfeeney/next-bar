# Production migration & release-readiness addendum — 2026-08-07

**Local, read-only. Nothing was applied, deployed, or contacted.** No Production access, no live
configuration inspected, no SQL executed. The frozen migration worktree was **not** checked out or
modified — every migration below was read with `git show 99ff7b3:<path>`, and
`git -C nb-prod-migrations-0042 status` is empty at HEAD `99ff7b3`.

**This packet is NOT approved. It requires fresh independent review and attended Production identity
verification before any window is opened.**

## 1. The exact intended migration set

Frozen packet: `release/prod-migrations-0033-0036-0042` at **`99ff7b3`**.

| # | File | Lines | Nature |
|---|---|---|---|
| 0033 | `0033_vibe_profiles.sql` | 130 | New table `public.vibe_profiles` + grants |
| 0034 | `0034_revoke_first_grants.sql` | 100 | **Privilege narrowing** on 3 core user tables |
| 0035 | `0035_share_night_date_bound.sql` | 123 | Share-night date bounding |
| 0036 | `0036_protect_schema_migrations.sql` | 46 | RLS + revoke on the migration ledger |
| 0042 | `0042_account_content_state.sql` | 123 | New table `public.account_content_state` |

The packet's full sequence is `0000`–`0036` plus `0042`. **`0037`–`0041` are deliberately absent** —
0042's header states those numbers already belong to census/social work on other branches, that
migration identity must never be reused for different SQL, and that 0042 has no dependency on them
and applies cleanly directly after 0036. **The gap must not be "filled" retroactively.**

## 2. Candidate identity

| Artifact | SHA | Status |
|---|---|---|
| Migration packet | `99ff7b3` | Frozen, verified unmodified |
| Accepted web base | `efca486` | — |
| Auth candidate | `76d610f` | **UN-REVIEWED** — gate goal `g-3fc3789d` still `planned` |
| This addendum's branch | `chore/prime-foundation` (from `origin/main` `6ec5e5d`) | See §12 |

The web candidate that would run against the migrated database is **not yet settled**: the auth
cross-context work at `76d610f` has not passed its independent review, so "the current web
candidate" cannot be named with a reviewed SHA today. That is itself a Production blocker — the
schema and the application must be approved as a pair, not separately.

## 3. Static confirmation: no pending migration deletes, truncates, or drops `auth.users`

Scanned all five files for `drop table`, `drop column`, `drop schema`, `truncate`, `delete from`,
`drop database`, and `alter table … drop`.

**Two matches, both non-executable.** Each is inside a rollback **comment** (`--` prefixed):

- `0033`: `--   drop table if exists public.vibe_profiles;`
- `0042`: `--   drop table if exists public.account_content_state;`

**Every `auth.users` reference is a foreign-key definition, not a deletion:**

- `0033`: `user_id uuid primary key references auth.users(id) on delete cascade`
- `0042`: `user_id uuid not null references auth.users(id) on delete cascade`
- `0034`: a prose comment only.

`on delete cascade` means these tables' rows are removed **when a user is deleted by some other
path** — it does not itself delete any user. `0034`, `0035`, and `0036` contain no destructive
statement at all.

**Conclusion: no migration in this packet deletes, truncates, or drops `auth.users`, and none
removes any existing user row.**

## 4. The limits of that static claim — read this before trusting §3

The §3 finding is a **text scan of five files**. It does **not** establish, and must not be reported
as establishing:

1. **What functions and triggers do.** A `SECURITY DEFINER` function body created by an earlier
   migration, or a trigger these tables fire, can delete rows without the word `delete` appearing in
   these five files. Not audited here.
2. **What the new `on delete cascade` edges do at scale.** They are inert until a user is deleted,
   but they widen the blast radius of any *future* `auth.users` deletion — including the existing
   service-role account-deletion route.
3. **Prior-state dependence.** These files were read at `99ff7b3`. Whether Production's schema
   actually matches the state these migrations expect is **unverified** — the ledger is per-database
   and Production's applied set has not been inspected (§9).
4. **Ordering effects.** 0033–0036 and 0042 were read individually; their combined effect against a
   Production database at an unknown migration point was not simulated.
5. **Nothing was executed.** No dry run, no shadow database, no `EXPLAIN`. This is reading, not
   testing.

A static "no destructive statement" result is **necessary but nowhere near sufficient** for a
Production window.

## 5. Static analysis of every application path affected by 0034's privilege narrowing

0034 applies the house revoke-first pattern to three core user tables. It revokes **all** from
`public`, `anon`, `authenticated`, then re-grants exactly the verbs the RLS policies already allow.
**`service_role` is untouched throughout**, so the account-deletion route and every `SECURITY
DEFINER` function are unaffected by construction.

| Table | Post-0034 grant to `authenticated` | `anon` |
|---|---|---|
| `public.profiles` | `select`, `insert`, `update (display_name, is_private, shares_list_publicly)` | **none** |
| `public.ratings` | `select`, `insert`, `update`, `delete` | **none** |
| `public.pairwise_comparisons` | `select`, `insert`, `delete` — **no `update`** | **none** |

### Enumerated application paths (candidate `99ff7b3`, `src/**`)

`profiles` is touched at **exactly three** sites — all in `src/lib/profile.server.ts`, all
authenticated and own-row:

| Site | Verb | Columns | Covered by 0034? |
|---|---|---|---|
| `profile.server.ts:122` `fetchOwnProfile` | `select` | `handle, display_name, is_private` | ✅ `select` granted |
| `profile.server.ts:151` `setOwnPrivacy` | `update` | `is_private` | ✅ in the column list |
| `profile.server.ts:189` `setOwnDisplayName` | `update` | `display_name` | ✅ in the column list |

`pairwise_comparisons` is touched at four sites in `src/lib/pairwise.server.ts` — `select` (:41),
`insert` (:55, :100), `delete` (:118). **No `update` anywhere**, matching the deliberate omission.

Handle operations (`claim_handle`, `search_handles`) go through **RPCs**, not direct table access, so
they are unaffected by the table grant change.

**No application path is broken by 0034 on the candidate as analysed.**

## 6. Do public profile / shared-list reads require `anon` profile access?

**No.** The public shared-list path calls `get_public_ratings(handle)` via RPC
(`src/lib/publicList.server.ts`), which migration 0015 defines as `SECURITY DEFINER` and which gates
on the owner's `shares_list_publicly` opt-in. Anonymous readers therefore never need a direct grant
on `profiles` or `ratings`, and 0034's revocation of all `anon` privileges on those tables does not
break the public path.

Granting `anon` anything direct on `ratings` would in fact **bypass** that opt-in gate — 0034 is
correct to withhold it.

### ⚠️ Finding: the opt-in that gates this feature has no writer

0034's F5 section extends the column grant to `shares_list_publicly` specifically so an owner can
turn their public list on. **But a repository search of the candidate finds no application code that
ever writes that column** — the only occurrences of `shares_list_publicly` in `src/**` are in
`src/lib/migration0034.test.ts`, which asserts the grant text.

So after this packet applies, the grant layer permits the opt-in, RLS permits it, and **nothing in
the product can set it**. `get_public_ratings` will continue to return empty for every user.

This is **not a migration defect and not a Production blocker** — the packet is strictly better than
today. It is a **feature-completeness gap**: shipping 0034 does not make public shared lists work.
It should not be described to anyone as enabling that feature.

## 7. Does any authenticated path require profile deletion or broader grants?

**No, on both counts.**

- **Deletion:** 0034 grants no `delete` on `profiles`. Account deletion runs **service-role** through
  `src/app/api/account/delete/route.ts` and cascades from `auth.users`; `service_role` is untouched.
  There is also no owner-delete RLS policy on `profiles`, so the grant layer and the policy layer now
  agree. Enumerated `profiles` access (§5) contains no delete.
- **Broader grants:** `handle` is deliberately excluded from the update column list. 0006 removed
  table-level UPDATE precisely so handles could not be PATCHed around `claim_handle`'s rate cap and
  no-renames rule. `id`, `created_at`, `updated_at` (trigger-owned) and the generated
  `handle_normalized` are likewise correctly absent. **Re-adding `handle` to that grant would
  silently undo a deliberate control** — flag any future migration that does so.

## 8. 0042 — additive account-content-state behaviour

**Additive. Confirmed.** 0042 is `create table if not exists public.account_content_state` — a new
table. It alters no existing table, drops nothing, and rewrites no existing row.

Shape: one row per `(user_id, state_key)`, `state_key` constrained to
`lists | night_log | night_archive | shared_nights`; `payload` must be a JSON object containing
`data`; payload capped at **262144 bytes** to refuse an unbounded or hostile browser payload.

**Privacy disclosure carried in the migration's own header, repeated here because it is a
Production-relevant decision, not an implementation detail:** the `shared_nights` domain's payload
stores the account's **bearer share tokens** (nightKey → token) durably server-side, so a reinstalled
device can still manage its links. They are protected by owner-only RLS, revocable via
`unshare_night(p_night)`, and not exposed by any anonymous read path (`get_shared_night` is
token-keyed only). **Durable server-side storage of bearer tokens is a decision the operator should
consciously re-affirm before Production**, not discover afterwards.

## 9. Exact Production unknowns requiring an attended window

Every item here is **unverified** and cannot be resolved locally:

1. **Production's actual applied migration set.** The ledger is per-database. Which of `0000`–`0032`
   are applied in Production is unknown from here. If Production is behind `0032`, this packet does
   not apply cleanly and the gap must be reconciled first.
2. **Ledger drift.** `scripts/apply-migrations.ts` hashes each file and reports edited-after-apply
   drift. Whether any already-applied Production file has drifted is unknown.
3. **Whether Production's schema matches what 0033–0036 expect** (§4.3).
4. **Restore capability is UNVERIFIED.** The project's own tier-map states this explicitly. A
   migration is irreversible without a restore, and no restore has been rehearsed.
5. **Row counts and identity before/after** (§11).
6. **Whether 0036's RLS change affects any Production-only consumer** of `schema_migrations`. The
   migration states repository search found no application path — that search covered the repository,
   not Production tooling, dashboards, or ad-hoc scripts.
7. **The paired web candidate** (§2) is not settled.

## 10. Backup and revert requirements

Before any window:

- **Take a fresh Production backup and verify it restores into a scratch project.** An untested
  backup is not a backup, and the tier-map already records restore capability as unverified. This is
  the single highest-value pre-window action.
- **Record the pre-migration ledger state** (applied versions + checksums) so "what changed" is
  answerable afterwards.
- **Record the deployed web artifact** so application and schema can be rolled back as a pair.

Revert characteristics per migration:

| Migration | Revert |
|---|---|
| 0033 | `drop table` in comments — **destroys any data written to `vibe_profiles` after apply** |
| 0034 | Rollback grants documented in comments; restores 0006/0015 state. Grant-only, no data loss |
| 0035 | Not audited for revert in this addendum |
| 0036 | Header states **no application rollback is expected or useful**; re-opening it restores the finding |
| 0042 | `drop table` in comments — **destroys any account content state written after apply** |

**The two `drop table` rollbacks are data-destroying once users have written through them.** After
the first write, "revert" is no longer free, and the window's real rollback plan is restore-from-
backup, not the commented DDL.

## 11. Account-preservation evidence stronger than an aggregate count

**An aggregate `count(*) from auth.users` matching before and after is insufficient** and must not be
accepted as the preservation gate. It cannot distinguish "no users lost" from "N deleted and N
created", and it says nothing about per-user data.

Required instead:

1. **Identity-level sampling.** Capture a stable sorted set of user `id`s (a hash of the full ordered
   id list, plus a random sample of ~20 concrete ids) before, and re-verify the same hash and the same
   sample ids exist after. A matching hash over identities is strictly stronger than a matching count.
2. **Per-table row provenance for each sampled user** — `ratings`, `pairwise_comparisons`,
   `profiles`, and any shared-night rows: count per user before and after, not just globally.
3. **Column-level spot check** on sampled profiles: `handle`, `display_name`, `is_private` unchanged.
4. **Grant verification after apply:** query `information_schema.role_table_grants` for
   `anon`/`authenticated` on the three tables and assert it matches §5's table exactly. This is the
   direct test that 0034 did what it claims.
5. **Capture all of the above BEFORE the window**, stored outside the database being migrated.

## 12. Functional gates before Production is called good

Each must be exercised against the migrated environment by a real account, not asserted:

- **Existing-user login** — an account created *before* the migration signs in successfully.
- **Saved rankings survive** — a pre-existing user's ratings and pairwise comparisons render
  identically to a pre-window capture.
- **Saved nights survive**, and the account-content-state write-through works on a *new* device.
- **Password reset completes end-to-end**, including the cross-container path.
- **Cross-container authentication** — the TestFlight WKWebView → Safari boundary. **This is the
  path the un-reviewed `76d610f` work addresses and it has never been tested against a deployed
  environment.**
- **Public shared list** — expect it to remain non-functional (§6). Confirm that is understood, not
  discovered.

## 13. What Staging approval does and does not authorize

**Build 6 is internal-only and points at Staging. It must never be represented as externally
releasable.**

| Evidence | Authorizes |
|---|---|
| Local verification (this document) | Nothing beyond "worth reviewing" |
| Staging acceptance | Staging only |
| **Internal** TestFlight approval | Internal testing only |
| Production approval | Production only — and requires its own attended window |
| **External** TestFlight approval | Separate, additional, not implied by any of the above |

These are five distinct gates. Passing one grants nothing about the others. **No Production
migration, Production deployment, or TestFlight modification is authorized by this document.**

## 14. Status of this packet

**NOT APPROVED. Requires, before any Production window:**

1. Fresh independent review of this addendum and the packet — this document was produced by a single
   agent in an unattended run and has had no independent review at the time of writing.
2. **Attended Production identity verification** — a human confirming, in the Production project,
   which migrations are applied and that the target project is the intended one.
3. A verified-restorable backup (§10).
4. Resolution of the paired web candidate (§2).
5. Answers to every unknown in §9.

## 15. Provenance of this analysis

| Check | Result |
|---|---|
| Migration files read | `git show 99ff7b3:supabase/migrations/*.sql` — read-only, no checkout |
| Frozen worktree `nb-prod-migrations-0042` | `git status` **empty**, HEAD `99ff7b3` — unmodified |
| Application analysis | `git grep <pattern> 99ff7b3 -- src` — read-only against the candidate ref |
| Migration SQL modified | **No** |
| Production contacted | **No** |
| SQL executed | **No** |
| Live configuration inspected | **No** |

Analysis was performed on `chore/prime-foundation` (base `origin/main` `6ec5e5d`), which carries
migrations only through `0019` — hence every migration read came from the frozen ref rather than the
working tree. This addendum is committed here rather than on `fix/nighttime-mobile-hardening`
because that branch could not be created: it requires the un-reviewed auth base (§2). The content has
no dependency on that branch.
