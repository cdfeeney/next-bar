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

> **Re-verified 2026-08-08 against the web candidate.** All five packet files are byte-identical
> between the frozen ref and the candidate branch — `git rev-parse <ref>:supabase/migrations/<f>.sql`
> returns the same blob for each. But the candidate carries a **39th** migration the packet does not:
> `0043_rate_limits.sql`. `git ls-tree -r --name-only 99ff7b3 -- supabase/migrations` yields 38 files,
> the same command at `689e564` yields 39. **This packet is therefore no longer the candidate's full
> migration set**, and the difference is not inert — see §8b.

## 2. Candidate identity

> **§2 was rewritten on 2026-08-08.** Every SHA and status below changed after the original draft.
> The superseded text is quoted at the end of this section so the change is auditable.

| Artifact | SHA | Status (verified 2026-08-08) |
|---|---|---|
| Migration packet | `99ff7b3` | Frozen; `git -C nb-prod-migrations-0042 status --short` empty at that HEAD |
| Accepted web base | `efca486` | — |
| Auth branch `fix/auth-cross-context-email` | **`b6a7957`** | Gate goal `g-3fc3789d` is **`complete`**; `76d610f` is an ancestor of `b6a7957` |
| Web candidate `fix/nighttime-mobile-hardening` | **`689e564`** | **Exists.** Descends from both `efca486` and `b6a7957` |
| This addendum's branch | `harness/nb-20260808-expanded/release-addendum`, forked at `689e564` | See §15 |

Commands: `git rev-parse fix/auth-cross-context-email` → `b6a7957`;
`git merge-base --is-ancestor 76d610f b6a7957` → 0; `git rev-parse fix/nighttime-mobile-hardening`
→ `689e564`; `git merge-base --is-ancestor efca486 fix/nighttime-mobile-hardening` → 0;
`git merge-base --is-ancestor fix/auth-cross-context-email fix/nighttime-mobile-hardening` → 0.

**What this resolves, and what it does not.** The original blocker — "no reviewed SHA can be named
for the paired web candidate" — is **discharged for the auth slice**: that gate completed and its
result is in the candidate's ancestry. The pairing requirement itself is **not** discharged. `689e564`
is the tip of an unattended overnight branch carrying later hardening work that this document has not
reviewed, and §8b shows the pair is currently **mismatched**: the candidate needs a migration the
packet does not contain. So the schema and the application must still be approved together, and
`689e564` must not be read as "the approved web candidate" — only as the SHA this re-verification
was run against.

> *Superseded text (original draft): "Auth candidate `76d610f` — **UN-REVIEWED** — gate goal
> `g-3fc3789d` still `planned`. … The web candidate that would run against the migrated database is
> **not yet settled** … That is itself a Production blocker." The branch row also cross-referenced
> §12, which discusses functional gates and never the branch choice; the correct target is §15.*

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

> ⚠️ **Do not quote the sentence above on its own.** It is the single most quotable line in this
> document and the one most likely to be forwarded upward as "the review confirms `auth.users` is
> untouched." Stripped of context it loses all four of its qualifiers: it is **static-only** (§4), it
> covers the **packet's five files, not the candidate's migration set** (see the scope note below),
> it says nothing about the **grants** question that is 0034's actual risk (§5), and it comes from a
> document whose own ledger marks its safety argument unverifiable by the means used (§14b). Quote
> the ledger row, not the sentence.

### Scope of this scan — corrected 2026-08-08

The scan above covered **the five packet files only**. Once §1 and §8b established that the web
candidate's migration set is 39 files rather than the packet's 38, "no *pending* migration deletes
`auth.users`" became ambiguous about which set it means, and the 39th file had never been scanned.
It has now been:

`0043_rate_limits.sql` — **no `auth.users` reference at all** (`grep -n "auth.users"` → no match).
It has one **executable** `delete from` at `:110` and a commented one at `:107`, both targeting
`public.rate_limits`, the new table 0043 itself creates; the delete is the function's own purge of
expired counter rows. The commented rollback `drop table if exists public.rate_limits` sits at `:135`.

So the conclusion survives the widened scope — but note the earlier phrasing "**Two matches, both
non-executable**" is true of the five packet files and **false of the candidate's 39**, where there
is a third match and it *is* executable. It is harmless (a new table purging its own rows), and that
is exactly why the scope had to be stated rather than left to be discovered.
*(Scope gap raised by the GLM lane; it was introduced by this pass's own §8b, which widened the
document's frame of reference without re-running §3.)*

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
6. **Write paths to `profiles` other than the application were not traced** — triggers (a
   `handle_new_user`-style row initialiser), seed scripts, backfill migrations, and any
   `SECURITY DEFINER` function that *writes* rather than reads. §5 enumerates read paths and direct
   application access; it does not claim to enumerate every writer.

### Considered and rejected: the revoke-then-re-grant "privilege gap"

A reviewer raised that `revoke all` (0034:42) precedes the re-grants (0034:44, :64), so a failure
between them could strand `authenticated` with **zero** privileges on `profiles` — a user-facing
outage. **Rejected on evidence.** PostgreSQL has fully transactional DDL, and this repo's runner
wraps each migration file's body in an explicit transaction together with its ledger row:
`scripts/apply-migrations.ts:487` `begin` → `:494` the migration SQL → `:495-498` the
`schema_migrations` insert → `:499` `commit`, with `:503` `rollback` on error. No other session can
observe an intermediate state; a mid-migration failure rolls back to the pre-0034 grants in full.
The concern would be valid on MySQL, where DDL causes an implicit commit. It does not apply here.
Recorded so it is not re-raised at the window.

> **Citation corrected 2026-08-08 — the conclusion held, the evidence pointer did not.** This
> paragraph previously cited `:281` `begin` → `:320` `commit` → `:322` `rollback`, plus `:44` and
> `:352`. Those lines are a **different transaction**: `:281`–`:322` are inside
> `installBootstrapFixture()`, `:44` describes the baseline pass, and `:352` concerns the initial
> ledger DDL. None of them wraps a migration file. An operator following this document's own
> "check the citation" discipline would have landed in unrelated code and found the claim
> unsupported. The per-file transaction really does exist, at the lines now cited, so claim 10 in
> §14b remains sound — but it was sound by luck, not by the evidence given.
> *(Found independently by the Claude and Codex lanes; Codex supplied the corrected line numbers.)*

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

### Enumerated application paths — `src/**`

> **Which ref this enumeration ran against, corrected 2026-08-08.** The original draft headed this
> section "candidate `99ff7b3`". That was a **category error**: `99ff7b3` is the *migration packet*
> ref, not the web candidate, and §2 is explicit that schema and application are separate artifacts.
> The two are materially different trees — `git diff --stat 99ff7b3 689e564 -- src` reports **57 files
> changed, 7,014 insertions**, 354 `src` files versus 391. So the original enumeration was run against
> a tree the deployed application would not be built from, and its exhaustiveness claim did not
> actually cover the candidate.
>
> **The enumeration has been re-run at the real web candidate `689e564` and the result is identical**
> for all three tables 0034 narrows — same files, same line numbers, no additional call sites. The
> findings below therefore hold for the candidate as well as the packet ref; only the warrant needed
> repairing, not the conclusion. Both refs are reported below so the claim is checkable.
>
> **Do not generalise that reassurance past this section.** "Identical at both refs" is true of the
> three tables 0034 narrows; it is *not* true of the candidate's schema dependencies at large. The
> same wrong-ref choice hid an entire new module — `src/lib/rateLimiter.durable.ts`, which does not
> exist at `99ff7b3` — and with it the §8b defect. §5 was lucky; §8b is what the luck was hiding.

**Two distinct access classes. Only one of them is governed by the grants 0034 changes.**

| Class | Governed by table grants? | Affected by 0034? |
|---|---|---|
| **Direct PostgREST table access** (`.from('profiles')` etc.) | **Yes** — the caller's own `anon`/`authenticated` grant applies | **Yes** — enumerated below |
| **`SECURITY DEFINER` RPC** (`.rpc(...)`) | **No** — the function executes as its owner, so the caller's table grant is irrelevant; only `EXECUTE` on the function matters, which 0034 never touches | **No** |

`profiles` is reached through **both**. The direct-access sites are the ones 0034 can break, and there
are **exactly three**, all in `src/lib/profile.server.ts`, all authenticated and own-row:

| Site | Verb | Columns | Covered by 0034? |
|---|---|---|---|
| `profile.server.ts:122` `fetchOwnProfile` | `select` | `handle, display_name, is_private` | ✅ `select` granted |
| `profile.server.ts:151` `setOwnPrivacy` | `update` | `is_private` | ✅ in the column list |
| `profile.server.ts:189` `setOwnDisplayName` | `update` | `display_name` | ✅ in the column list |

`pairwise_comparisons` is touched at four sites in `src/lib/pairwise.server.ts` — `select` (:41),
`insert` (:55, :100), `delete` (:118). **No `update` anywhere**, matching the deliberate omission.

**`ratings` — enumerated 2026-08-08. The original draft never enumerated it at all**, despite it
being one of the three tables 0034 narrows and despite criterion 5 requiring every affected path to
be enumerated rather than sampled. Six direct sites, all in `src/lib/ratings.server.ts`:

| Site | Verb(s) | Covered by 0034? |
|---|---|---|
| `:46` `fetchServerRatings` | `select` | ✅ |
| `:71` `upsertServerRating` | `upsert` → **`insert` + `update`** | ✅ both granted |
| `:103` batch score write | `update` | ✅ |
| `:120` `deleteServerRating` | `delete` | ✅ |
| `:142` `deleteAllServerRatings` | `delete` | ✅ |
| `:182` local→server merge | `insert` | ✅ |

0034 grants `authenticated` `select, insert, update, delete` on `ratings` — all four verbs are used
and all four are granted, so no `ratings` path breaks. Note the `upsert` at `:71` needs **both**
`insert` and `update`; a future migration narrowing either one alone would break it silently.

Enumeration command (run at both refs, identical output):
`git grep -n "from(['\"]<table>['\"])" <ref> -- src` for `<ref>` ∈ {`99ff7b3`, `689e564`} and
`<table>` ∈ {`profiles`, `ratings`, `pairwise_comparisons`}.

**The RPC surface is substantially larger than those three sites.** Beyond `claim_handle` and
`search_handles`, the candidate reaches profile data through `get_profile_by_handle`, `get_following`,
`follow_user`, the follow-request/follower RPCs, `get_circle_suggestions`, `get_circle_rsvps`,
`get_shared_night` and `get_circle_vibe_votes` — called from `follows.server.ts`,
`suggestions.server.ts`, `rsvps.server.ts`, `nights.server.ts` and `vibeVotes.server.ts`. Several of
those function bodies read `from public.profiles p` directly (verified in the `supabase/migrations`
sources at `99ff7b3`).

They survive 0034 **because they are `SECURITY DEFINER`, not because they avoid `profiles`.** The
function executes with its owner's privileges, so the caller's table grant is never consulted; the
caller needs only `EXECUTE`, which 0034 does not touch.

**Corollary — the controlling layer depends on the caller's role. Do not state it as one rule.**

A `SECURITY DEFINER` → `SECURITY INVOKER` change on any of these functions **would** break them, but
*what* breaks differs:

| Caller context | Post-0034 `profiles` grant | What blocks an INVOKER-mode read |
|---|---|---|
| direct `authenticated` | `select, insert` **re-granted** (0034:44) | **RLS** — `"profiles: owner can read own"`, `using (auth.uid() = id)` (`0001_v0.5.0_auth_and_ratings.sql:84-86`), **untouched by this packet**. These RPCs read *other users'* rows, which only a definer-owner RLS bypass permits. |
| direct `anon` | **nothing** — `revoke all … from public, anon, authenticated` (0034:42) with no anon re-grant | **0034's revocation itself.** The table privilege is gone, so the read fails before RLS is reached. |
| **called from inside another `SECURITY DEFINER` function** | n/a — grants resolve against the *outer* function's owner | **Nothing.** The inner function inherits the outer definer's effective user, which bypasses RLS. The flip is a **silent no-op**: it does not break, and it does not restrict either. |
| `service_role` | untouched by 0034 | **Nothing** — `BYPASSRLS` in Supabase. Unaffected in either mode. |

The anon row is not hypothetical: **`get_shared_night` is granted `execute` to `anon`**
(`0016_shared_nights.sql:200`). So for at least one function in the list above, 0034 *is* the
operative control.

Practical advice, unchanged: treat a definer→invoker change on any profile-reading function as
breaking. But **reverting 0034 would restore only the `anon` path** — an `authenticated`-path break
is RLS and would survive the revert. And note the third row's trap: a flip that *appears* safe
because nothing broke may simply be running inside a definer context and enforcing nothing at all.

> *Corrected three times on 2026-08-07, each by a different reviewer. The original said "0034's
> revocation" (wrong for `authenticated` — 0034 re-grants that SELECT). The Claude/Sonnet lane's
> correction said RLS (wrong for `anon` — 0034 grants anon nothing back). The Codex lane split it by
> role. The GLM lane then supplied the two non-obvious contexts: nested definer calls and
> `service_role`. That three reviewers each found a different hole in the same four-line claim is
> itself the argument for not trusting a single-lane read of a Production gate document.*

**No application path is broken by 0034 on the candidate as analysed** — the three direct-access
sites are all within the new grant, and the RPC surface is grant-independent.

> **Correction (independent review, 2026-08-07).** An earlier draft said `profiles` is "touched at
> exactly three sites". That was true only of *direct table access* and overstated exhaustiveness in a
> document gating a Production migration. Raised by the Codex lane; the Claude lane read the same
> claim as scoped to direct access and passed it. Repository evidence settled it in Codex's favour,
> so the claim is now split by access class above.

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

*Re-verified 2026-08-08 at the true web candidate:* `git grep -n "shares_list_publicly" 689e564 -- src`
returns the same three lines, all inside `migration0034.test.ts`. The "no writer in the product"
observation therefore holds for the candidate, not only for the packet ref — but it is unchanged in
force, and the two reasons below still prevent it from licensing "the feature is off."

So after this packet applies, the grant layer permits the opt-in, RLS permits it, and **no UI or
server route in the candidate sets it.**

**What that does and does not license as a conclusion.** It is a statement about the candidate's
code, nothing more. It specifically does **not** establish that `get_public_ratings` returns empty
for every user, because:

- the flag may **already be `true`** for some Production rows, set previously through service-role
  access, a manual dashboard edit, or an earlier build; Production state is unverified (§9), and
- after 0034 an authenticated owner **can** set it directly through PostgREST — that is exactly what
  the new column grant permits. "No writer in the product" is not "cannot be written."

So the honest statement is: **shipping 0034 does not, by itself, make public shared lists usable
through the product, and it should not be described to anyone as enabling that feature.** Whether
any Production user's list actually becomes publicly readable is an **open question for the attended
window** (added to §9), not something this analysis can settle.

This is **not a migration defect.** Whether it is a release blocker is **not this document's call** —
it depends on whether public shared lists are in the release criteria, and §13/§14 are explicit that
this document carries no approval authority. An earlier draft asserted "not a Production blocker";
that disposition is withdrawn as outside its remit. *(Both corrections raised by the Codex lane,
2026-08-07.)*

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

## 8b. ⛔ Finding (new, 2026-08-08): the packet and the candidate are **mismatched**, and the mismatch fails closed on account deletion in three of the four configurations

This is the one finding in this document that is not a caveat about method. It is a concrete defect
in the *pairing* of artifacts, and it was invisible to the original analysis precisely because that
analysis read `src` at the migration ref (§5).

**The chain, each link verified by command:**

1. The candidate carries `supabase/migrations/0043_rate_limits.sql`; the frozen packet does not (§1).
2. 0043 creates `public.rate_limits` and the function `public.consume_rate_limit(text, text, bigint,
   integer)`, granting `execute` on it to `service_role` only.
3. The candidate calls that function: `src/lib/rateLimiter.durable.ts:32`
   `client.rpc('consume_rate_limit', …)`. This file **does not exist at `99ff7b3`**
   (`git ls-tree 99ff7b3 -- src/lib/rateLimiter.durable.ts` → empty), which is why §5's original
   ref choice concealed it.
4. If the call errors, `rateLimiter.durable.ts:53` throws.
5. The tier layer catches it and returns `{ allowed: onDegraded === 'fail-open', degraded: true }`
   (`src/lib/rateLimiter.ts:422`). **For a `fail-closed` consumer this evaluates to
   `allowed: false`.**
6. Exactly one consumer is `fail-closed`: `src/app/api/account/delete/route.ts:79`. Every other
   consumer (`api/event`, `api/waitlist`, `mediaMetric.server.ts`) is `fail-open`.

**Consequence.** Deploy candidate `689e564` against a database migrated with only this packet and
`consume_rate_limit` does not exist. Every call to it errors, so **account deletion is denied for
every user, continuously**, while every other rate-limited route merely loses its shared tier and
falls back to per-instance limiting. *(Read "continuously" against row 3 of the table below, which is
the one configuration that does not reach the call at all — corrected 2026-08-08.)*

**The failure does not depend on the shared tier being armed — corrected 2026-08-08.** An earlier
version of this section made "with the shared tier armed" a precondition. Checking the other branches
shows that precondition is too narrow: **on production defaults the deletion path denies whether or
not the tier is armed, and exactly one configuration — row 3, the explicit escape hatch — allows it.
Three of the four rows below are unshippable states.**

| # | Production configuration | Path taken | Account deletion |
|---|---|---|---|
| 1 | Tier armed (URL + service key + salt present), 0043 **unapplied** | RPC errors → throw → `rateLimiter.ts:420` `catch` → `:422` `allowed: onDegraded === 'fail-open'` | **denied** |
| 2 | Tier **not** armed (any of the three env vars missing), `REQUIRE_DURABLE_RATE_LIMIT` unset | `rateLimiter.ts:375` `if (!durable \|\| !salt)` → `:388` `if (requireDurable) return { allowed: false, degraded: true }` | **denied** |
| 3 | Tier **not** armed **and** `REQUIRE_DURABLE_RATE_LIMIT=0` (or `false`) | `:375` → `:388` skipped → `:391` `return { allowed: true, degraded: false }` | allowed — **no *shared* quota; per-instance limiting remains** |
| 4 | Tier armed **and** 0043 applied | normal | allowed, limited to 5/user/hour |

`requireDurable` defaults **on** in production (`account/delete/route.ts:94-105`
`requireDurableRateLimit()`; `:95-97` parse an explicit `REQUIRE_DURABLE_RATE_LIMIT` override, and
the production *default* is `:103-105`, `VERCEL_ENV`/`NODE_ENV` — **citation corrected 2026-08-08**,
the earlier `:95-97` pointed at the override branch, not the default it was cited for), and its whole
purpose is to refuse loudly rather than silently fall
back to per-instance limiting on the one irreversible action. So, **on production defaults, account
deletion works only if 0043 is applied** — rows 1 and 2 both deny, and only row 4 is the healthy
state.

> ⚠️ **Row 3 is the trap, and it is the reason "just don't arm the tier" is not a workaround.**
> `REQUIRE_DURABLE_RATE_LIMIT=0` is described in 0043's own header (`:163`) as "the escape hatch".
> It does make deletions succeed with 0043 unapplied — by **dropping back to per-instance limiting
> on the one irreversible action**, which is precisely the weakness 0043 exists to remove. Row 3
> also returns `degraded: false`, so it does **not report itself as degraded**: the shared tier is
> skipped rather than failed. Anyone proposing this as a way to ship without 0043 is proposing to
> disable a protection, not to avoid the problem, and it should be an explicit recorded decision
> rather than an env-var default.
>
> **Do not overstate row 3 either — corrected 2026-08-08.** An earlier version of this note said the
> escape hatch leaves the action "completely unlimited" and "removes the quota entirely". **That is
> false.** `rateLimiter.ts:371` consults the in-memory limiter — created with the *same* limit and
> window (`:365`) — and returns `{ allowed: false, degraded: false }` **before** any of the branches
> in this table are reached. So row 3 still enforces 5 deletions per user per hour *per process*.
> What is lost is **cross-instance coordination**: N warm instances mean the ceiling scales with N
> instead of being global, and a restarted instance starts from an empty counter. That is a real
> weakening and a real reason not to ship row 3 — but it is not the absence of a limit, and a gate
> document must not overstate risk any more than it understates it.
>
> *(Row 3 was missing from the first version of this table. Found independently by the Claude, Codex
> and DeepSeek lanes; Codex located `route.ts:95-97` and `rateLimiter.ts:391`. The "completely
> unlimited" overstatement was then caught independently by the Codex and DeepSeek lanes in the
> following round.)*

*(The broadening above came out of testing a DeepSeek claim that an unset salt would let deletions
succeed. On production defaults the repository shows the opposite — `:388` refuses — so the claim as
stated is **rejected on evidence**; but it was directionally right, because the escape hatch in row 3
does exactly what it described. A second DeepSeek concern — that the account-delete key might hit the
unattributed short-circuit at `:407` — is also **rejected on evidence**: `:369` runs the key through
`aggregateIp`, whose first line is `if (!ip.includes(':')) return ip`, so a UUID user id is returned
unchanged and can never equal the `'unknown'` sentinel.)*

The account-delete bucket keys on the verified user id, so it never takes the unattributed
short-circuit at `rateLimiter.ts:407` that would otherwise allow the request.

**Warrant and falsifier — stated in §14b's terms, and split, because the two halves are not equally
supported.**

- **The tier-layer half is already `verified-by-test`.** `src/lib/rateLimiter.test.ts:251-258`
  ("FAILS CLOSED when the store is unreachable and the action is irreversible") constructs a
  fail-closed limiter over an unavailable counter and asserts exactly
  `{ allowed: false, degraded: true }`. The step this section leans on hardest is therefore not a
  reading at all — it is a green test in the ordinary suite.
- **The database half remains `derived-from-code`.** That an *unapplied 0043* is what makes the RPC
  error is still only read, never executed. That is the single unverified link.

**The cheapest sufficient falsifier is therefore NOT a scratch database.** An earlier version of this
section named one. A unit test with a client stub whose `rpc` returns a
`{ error: { code: 'PGRST202' } }` (undefined-function) response, driven through `durableCounterFromEnv`
and the account-delete consumer, settles the whole chain with no Postgres, no migration and no
deploy — and `rateLimiter.test.ts:402` already asserts the `consume_rate_limit failed` throw, so the
harness exists. The scratch-database run is still worth doing for the §9 unknowns, but it should not
be the gate on *this* finding. *(Cheaper-falsifier point raised by the DeepSeek lane and confirmed
against the existing test file.)*
`rateLimiter.durable.ts:48-50` anticipates an unapplied migration in prose ("An error here is
UNAVAILABLE, never 'denied'. Returning `{ allowed: false }` would silently convert an unapplied
migration or a transport blip into a hard block") — under §14b's first forbidden evidence class that comment is cited here as the
author's *intent* only, and carries no weight as evidence of runtime state. *(Citation corrected
2026-08-08: `:19-22` is the wall-clock-timeout comment and says nothing about migration state.)*

**Disposition.** The genuine options are: ship 0043 inside this window; ship it separately *before*
the candidate; or pin the deployment to an application ref that predates the dependency. Which of
those to take is **an operator decision, not this document's call** (§13, §14).

> **"Deploy without the durable tier armed" was listed here as a fourth option and has been
> withdrawn.** Per row 2 of the table above it does not work — it denies deletion by a different
> line — and the only way to make it work is row 3, `REQUIRE_DURABLE_RATE_LIMIT=0`, which ships the
> irreversible action with no shared quota at all. That is a decision to remove a protection, so it
> does not belong in a list of ways to avoid the problem. *(Withdrawn after four independent lanes
> flagged that this sentence still encoded the narrower precondition this section had just
> abandoned — the same failure-to-propagate pattern recorded in §14b.)* What this document does assert is that **the packet and `689e564` must not be
shipped as a pair as they stand**, and that "the migration set is 0033–0036 + 0042" is no longer a
complete description of what the candidate needs.

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
8. **How many Production rows already have `shares_list_publicly = true`** (§6, §12), and **what the
   three affected tables currently grant**. Two distinct unknowns:
   - *The flag count.* The anon read path via `get_public_ratings` (0015, applied) is already live,
     so a `true` row is exposed today. Expect zero — the write path was closed before 0034 — but a
     `service_role`, dashboard, or direct-SQL edit could have set one. Cheap to check; check it.
   - *The actual current grants.* **The whole analysis assumes Production's starting grant state
     matches what the migration sources imply, and never verifies it.** Query
     `information_schema.role_table_grants` for `anon`/`authenticated`/`public` on `profiles`,
     `ratings` and `pairwise_comparisons` **before** the window. If the live baseline differs from
     the assumed one, conclusions in §5, §6 and §7 change — 0034 could be *widening* rather than
     narrowing. This is an unstated assumption rather than a flagged gap, which makes it more
     dangerous than the limitations listed in §4. *(Raised by the GLM lane, 2026-08-07.)*
9. **Which migration set the deployed web artifact actually requires** (§8b). The packet is no longer
   a complete answer: the candidate needs `0043_rate_limits.sql` as well, and the shortfall fails
   closed on account deletion in all but one configuration (see §8b's table). Before the window,
   decide and record (a) whether 0043 ships inside it,
   (b) which web artifact SHA is being paired with the resulting schema, and (c) whether the shared
   rate-limit tier will be armed in that deployment, **including the value of
   `REQUIRE_DURABLE_RATE_LIMIT`**. These three answers are **not independent**, and the dependency is
   not the one an earlier draft stated. *(Corrected 2026-08-08.)* Of the four configurations in
   §8b's table, **three deny or degrade and only one is fully healthy**: 0043 applied *and* the tier
   armed. It is not the case that "arming the tier without 0043" is *the* failing combination —
   leaving the tier unarmed fails too, and the one setting that makes deletion succeed without 0043
   does so by **removing the shared quota; per-instance limiting remains** (§8b row 3, and read that
   row's correction before quoting this line). Record all three answers together, or the combination
   that actually ships will not be the one anyone approved.

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
| **0043** | **Added to this table 2026-08-08.** Commented `drop table if exists public.rate_limits` at `:135`. Destroys only in-flight rate-limit counters, which are ephemeral by design — so this is the one revert here with **no durable data loss**. But see the asymmetry below. |

**The two `drop table` rollbacks are data-destroying once users have written through them.** After
the first write, "revert" is no longer free, and the window's real rollback plan is restore-from-
backup, not the commented DDL.

> **0043's revert is the dangerous one despite losing no data — added 2026-08-08.** Every other row
> in this table trades off *data*. 0043 trades off *availability*: reverting it drops
> `consume_rate_limit`, and by §8b that immediately denies account deletion **for every user of a
> deployment whose durable tier is armed** — not for every user in production, because §8b row 3, the
> explicit escape hatch, never reaches the RPC and still allows deletion after the revert. Where the
> tier *is* armed the denial is total, because the candidate calls that function and the only
> fail-closed consumer refuses when it is missing. *(Precise scope, corrected 2026-08-08 — a round-10 edit got this wrong and is
> retracted here. **Rows 1 and 4 reach the RPC** — the tier is armed in both, so
> `durableCounterFromEnv` returns a counter, `rateLimiter.ts:375` is false, and `:412` awaits
> `durable.increment`, which is where the RPC is *delegated*; the call itself is issued one file over,
> at `rateLimiter.durable.ts:32` (`client.rpc('consume_rate_limit', …)`). Row 1 is precisely the case
> where that call *errors* because 0043 is unapplied. **Row 4 is nevertheless the only configuration whose *outcome* the revert changes**:
> reverting there transitions the deployment into row 1 and denies every deletion. Row 1 is already
> the post-revert state, so nothing changes for it. Rows 2 and 3 short-circuit at
> `rateLimiter.ts:375` before any RPC call and are unaffected by the revert. **"Reaches the RPC" and
> "the revert changes this outcome" are different predicates, and conflating them is what went wrong
> twice here.** The round-10 edit called rows 1, 2 and 4 "the
> shippable configurations", which was wrong twice over — §8b says three of the four rows are
> unshippable, and rows 1 and 2 are not the rows the revert acts on.)* **So 0043 must not be reverted
> while a candidate that calls it is deployed** —
> the rollback order is application first, then migration. Reverting in the other order converts a
> rollback into an outage of the account-deletion path.
>
> **The forward direction carries no such constraint.** Applying 0043 before deploying the candidate
> is safe: the currently-deployed application never calls `consume_rate_limit`, so the new table
> simply sits empty until a candidate that uses it arrives. Only the reverse order is dangerous, and
> only on the way back out.
>
> **One transient effect to expect, not to chase.** Reverting 0043 drops the counter rows with the
> table, so a re-apply starts every bucket at zero: a user who had consumed their 5 deletions in the
> current hour gets a fresh quota. That is a temporary quota reset, not a correctness failure, and
> it is the intended consequence of counters being ephemeral — but it should not surprise anyone
> watching the numbers during a rollback. *(Both points raised by the DeepSeek lane.)*
>
> This row was missing entirely until the GLM lane pointed out that §8b widened the migration set
> without propagating the change into the revert and preservation sections. **§11's
> account-preservation evidence is unaffected**: 0043 creates one new table, references no
> pre-existing table and no `auth.users` (§3 scope note), so no preservation assertion changes.

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
- **Cross-container authentication** — the TestFlight WKWebView → Safari boundary. This is the path
  the auth cross-context work addresses. That work is **now reviewed** — its gate goal completed and
  `76d610f` is an ancestor of the current auth tip `b6a7957`, which is in the candidate's ancestry
  (§2) — but **it has still never been exercised against a deployed environment**, which is why it
  remains a gate here. *(Corrected 2026-08-08: this bullet still described `76d610f` as
  "un-reviewed" after §2 had retracted exactly that characterisation. Review is not the same gate as
  deployment; only the review half changed.)*
- **Account deletion, exercised under the configuration that will actually ship** — *added
  2026-08-08.* Delete a disposable pre-existing account and confirm it succeeds, **with the deployed
  values of `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_KEY_SALT` and `REQUIRE_DURABLE_RATE_LIMIT` in
  place, and 0043 in whatever state the window leaves it.** §8b's table has four rows and three of
  them deny or degrade this path; a gate run against row 4 while production ships row 1, 2 or 3
  proves nothing about the deployment. Record which row was exercised. This is the only gate here
  whose failure mode is *silent until a user tries to delete their account*, and it is the reason
  §9 item 9 asks for all three configuration answers together rather than separately.
  *(Gap raised by the GLM lane: §12's gate list predated the escape hatch entering this document's
  risk model, so nothing in it exercised the deletion path at all.)*
- **Public shared list** — **the READ path is pre-existing; the WRITE path is what this packet
  opens.** Separate the two or the risk is misread in either direction:
  - *Read (already live).* `get_public_ratings` is `SECURITY DEFINER` with
    `grant execute … to anon` from migration **0015** (`0015_public_shared_list.sql:63,67,88`),
    already applied. Any row holding `shares_list_publicly = true` is publicly readable **today**.
  - *Write (closed only on the UPDATE path — **not** closed overall).* 0006's column-scoped grant
    excluded the flag, so `update profiles set shares_list_publicly = true` returned a
    **column-permission error**, and 0034's F5 comment concludes `get_public_ratings` "could only
    ever be empty". **That conclusion is not airtight, and this document previously repeated it
    uncritically.** 0034's own F3 comment records that before this migration `profiles` "revoked only
    UPDATE (0006:82) — everything else leaned on Supabase's default
    `grant all on all tables in schema public to anon, authenticated`." A PostgreSQL column
    restriction on **UPDATE does not constrain INSERT**, and `authenticated` held INSERT through that
    default grant. So an owner could plausibly have set the flag on their **own** row via an
    insert/upsert path (PostgREST `Prefer: resolution=merge-duplicates`), never touching the
    restricted UPDATE. Other unaudited write paths exist too: a `handle_new_user`-style trigger, a
    seed script, a backfill migration, or any `SECURITY DEFINER` function that writes `profiles` —
    none of which is UI, and none of which this analysis traced.
    **Treat "expect zero" as an assumption to test, not a finding.** *(Raised by the DeepSeek lane.)*
  - *What 0034 actually changes.* It adds `shares_list_publicly` to the update column grant, so
    afterwards **any authenticated owner can self-expose their entire ratings list with a single
    PATCH** — no confirmation step, and no product UI to set, review, or revoke it. That is a real
    new capability, not merely a grant-layer formality.

  Run the §9.8 count anyway (cheap, and it settles the read question), but the decision this bullet
  gates is whether shipping a one-PATCH self-exposure with no revoke UI is acceptable for Beta.

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

1. Fresh independent review of this addendum and the packet, covering **whatever §14b's Current
   review state block names as the most recent unreviewed delta**. *(This bullet deliberately states
   **no round number, no lane list and no review status** — §14b's Current review state block is the
   single mutable record of all three. Two earlier versions carried those facts inline and both went
   stale before anyone read them: the original said "has had no independent review at the time of
   writing", and its successor said "what remains un-reviewed is the round-7 repair" while two
   further rounds had already run. Round 11 found that *refreshing* the duplicate only resets the
   timer, so 2026-08-08 removes it instead.)*
2. **Attended Production identity verification** — a human confirming, in the Production project,
   which migrations are applied and that the target project is the intended one.
3. A verified-restorable backup (§10).
4. **Resolution of the packet/candidate pairing (§2, §8b).** *(Updated 2026-08-08.)* The auth half of
   the original blocker is discharged — gate goal `g-3fc3789d` is `complete` and `b6a7957` is in the
   candidate's ancestry. It is replaced by a sharper one: the candidate requires a migration this
   packet does not carry, and the shortfall is not benign.
5. Answers to every unknown in §9.
6. **Empirical checks, in this order of cost.** *(Revised 2026-08-08 after round 7.)*
   - **First, the unit test** — a client stub returning an undefined-function error through the
     account-delete consumer settles §8b's one unverified link with no database at all (§8b). Do
     this before the window; it is minutes of work and it is the only gate on the finding that
     predicts a user-visible failure.
   - **Then, read-only Production queries** for the four assumptions in §14b claims 5–8 (applied
     migration set, current grants, public-flag row count, restore capability). No amount of further
     reading settles these; they are the reason a window needs a human.
   - **Then the scratch-database run** for the §9 unknowns that survive both.
   Every review round so far has found a real defect, including the last (count in §14b's Current
   review state block) — so the ordering above, **not another reading pass**, is the remaining path
   to trustworthy. **That instruction terminates *analytical* review as a path to correctness; it
   does not terminate *document* review, which closes under §14b's stopping rule. The two run in
   parallel and neither substitutes for the other.** *(Disambiguation added 2026-08-08 after a
   reviewer read the two rules as contradicting each other; the round count was moved out of this
   bullet in the same pass, having read "six" through rounds 8, 9 and 10.)*
7. **The frozen-history completeness check.** *(Added 2026-08-10.)* A **document** check, deliberately
   **not** part of requirement 6: it needs no database, no Production access and no window, so it is
   runnable today and it is not governed by requirement 6's ordering by cost. For every claim a later
   round has disproved, confirm that §14b's dated-corrections list **enumerates every occurrence by
   location**, that each enumerated frozen occurrence carries its adjacent editorial marker, and that
   each live occurrence has actually been corrected. Grep is a secondary net only — it misses
   Markdown emphasis inside a phrase and any paraphrase — so the enumeration, not the search, is the
   artifact being checked. **Record the result** (the occurrence list, and the outcome per
   occurrence) in the round's findings record, so the next round verifies coverage mechanically
   rather than taking a declaration on trust. *(Requirement 7 exists because the Kimi and GLM lanes
   independently observed that the corrections mechanism had no completeness invariant, and because
   the first version of the sweep — a plain grep, filed under requirement 6 — both missed a real
   occurrence and sat behind three checks that cannot run before a window.)*

**Which of these gates document review.** Requirement 7 does; requirements 2, 3, 5 and 6 do not.
Requirement 6's experiments cannot run before an attended Production window, so making document
review wait on them would make it unterminatable — the same liveness failure the withdrawn zero-edit
rule had. §14b's stopping rule is therefore conditioned on **requirement 7 only**. Requirement 6
remains mandatory before *approval*; it is simply not a precondition for closing *review*.

## 14b. Claim ledger — read this instead of trusting the prose

**Reading path, and an honest note on this section's size — added 2026-08-10.** An operator
preparing a window needs four things, in this order: the **gating verdict** (§14, NOT APPROVED), the
**claim ledger** (below), the **Current review state** block, and the **dated corrections**. Those
are the operational surface and they are bounded. Everything after them — the round-by-round
narration and its findings tables — is **audit trail**, written for whoever asks *how* this document
reached its conclusions, and it is not required reading before a window.

That trail grows monotonically and nothing in it may be deleted, so it will keep outgrowing the part
an operator must read. Two lanes have now flagged that as the mechanism's real long-run cost. The
answer is deliberately **not** to prune it. Instead, a falsifiable trigger: **when the audit trail
exceeds roughly two-thirds of this file, it moves wholesale into a companion document** —
`PROD-MIGRATION-ADDENDUM-2026-08-07-review-history.md` — leaving §14, §14b's ledger, this block and
the dated corrections here, with a pointer. Moving text unchanged into a companion file preserves the
append-only guarantee exactly; it is a relocation, not an edit. The trigger is stated so a later
round can check it mechanically rather than arguing about when the document got too long.

### Current review state — the single mutable record

**Scope of this block, narrowed 2026-08-08.** It is the single mutable record of exactly three
things: the **round count**, the **identity of the latest panel**, and **which delta is currently
unreviewed**. Nothing else in this document may state those three facts as a live claim.

Three things are deliberately **outside** that scope, because an earlier version of this sentence
claimed them and was over-broad:

- **The gating verdict.** "NOT APPROVED" is fixed document scaffolding and appears at the head of the
  document and at §14. It is not round-tracking prose, it has never changed in any round, and it is
  not maintained here.
- **Qualitative generalisations** such as "every review round has found a real defect". These carry
  no number and cannot go stale against a count.
- **Frozen historical narration.** Every round paragraph below records what one round found *and
  believed at the time*. Those are **append-only and must never be edited to match this block** —
  including when a later round proves them wrong. A superseding fact belongs here, dated, not in the
  history.

Three separate propagation defects (rounds 9, 10 and 11) came from a *live* fact being asserted in
more than one place, so there is now exactly one live place for each of the three.

| | | |
|---|---|---|
| Rounds completed | **15** | |
| Rounds that found a real defect | **15 — every one, including the last** | |
| Latest panel | Round 15, over candidate `51da763` | Full five-family — Claude `claude-sonnet-5`, Codex `gpt-5.6-sol`, GLM-5.2, DeepSeek V4 Pro, Kimi K3 deep. **Quorum met**, no lane missing, every lane's run bound to that candidate. One DeepSeek High was **refuted on repository evidence** and is recorded as such below. |
| **Most recent unreviewed delta** | **the round-16 repair** — the §10 RPC call-site citation; the corrections list moving from grep to enumeration-by-location, gaining the round-11 occurrence of round 9's descriptor and an entry for round 13; adjacent editorial markers at each enumerated frozen occurrence; §14 requirement 7 and the stopping rule's decoupling from requirement 6; and §14b's reading path and companion-file trigger | |
| Gating status | **NOT APPROVED** (§14). Unchanged by every round to date. | |

### Dated corrections superseding frozen history — 2026-08-08

Facts that later rounds proved wrong live here. The round paragraphs below are **not** edited to
match them.

**Completeness is a requirement of this list, not a courtesy.** A round that disproves a claim
appearing in frozen narration must append an entry here that **enumerates every occurrence by
location**, not only the one it happened to be reading. An entry that corrects one site and silently
leaves a second is the same propagation defect this mechanism exists to end, relocated from the
history into the corrections. The check that enforces this is **§14 requirement 7**. Entries state
*what* is false and *where* it appears; they carry no round count, because the count is live and
lives only in the table above.

**Enumerate by location, and do not trust a grep — added 2026-08-10.** An earlier version of this
rule said to grep the file for the disproved claim's text. That is necessary and **not sufficient**,
and the gap is not theoretical: the round-11 findings table writes round 9's descriptor as `third and
**final** full panel`, with Markdown emphasis inside the phrase, so a search for the plain string
misses it — which is exactly how the first version of this list shipped one occurrence short. A grep
also cannot match a paraphrase. So each entry below **lists its occurrences explicitly**, and the
list of occurrences — not the search that found them — is what a later round verifies.

**A frozen occurrence carries an adjacent marker.** Naming occurrences only in this list still leaves
a reader who arrives directly at a frozen paragraph with no local signal. Each occurrence enumerated
below therefore also carries a bracketed editorial line **immediately after the paragraph it
concerns**. That line is *not part of the record*: the narration's own words are never altered, which
is the whole of the append-only guarantee. It is a signpost added by a later round, and it says so.

- **Round 9's heading calls itself "third and final full panel". It was not final** — later rounds
  followed. Occurrences: the round-9 heading itself, and the round-11 findings table row that quotes
  the descriptor as `third and **final** full panel` while recording that it carried a stale round
  count. Both are frozen and neither is edited. The heading is preserved verbatim because it records
  what round 9 contemporaneously believed, and that mistaken belief is exactly what the audit trail
  exists to show. *(Round 12 edited that heading to "third full panel"; the edit has been reverted.
  The Codex lane held it violated the append-only rule for frozen narration; the GLM lane held
  "final" was a live descriptor and correctly editable. **Operator decision 2026-08-08: preserve
  frozen historical narration and carry the correction here instead.** The dispute is resolved, not
  merely recorded.)*
- **That decision supersedes the round-11 live-versus-frozen test for headings — added 2026-08-10.**
  Round 11 adopted a GLM test classifying any "latest/final" descriptor as a *live* claim and
  therefore correctable in place; that test is recorded in round 11's frozen paragraph below and
  still reads as governing there. For a string that is simultaneously historical narration and a
  navigational label, the operator decision above now governs and the test does not: the label is
  preserved and the correction is carried here. The cost is accepted and stated plainly — a reader
  who navigates by that heading alone is misled until they reach this list, which is the price of an
  audit trail that cannot be rewritten.
- **"Only §8b row 4 reaches the RPC at all" is false, wherever it appears** — rows 1 and 4 both reach
  it, and row 1 is precisely the configuration where the call errors. Occurrences: **round 12's §10
  edit** (live text, corrected in §10 by round 14) and, in the form "Only **row 4** reaches it",
  **round 11's findings table** below (frozen, not edited). The claim both were reaching for — that
  row 4 is the only configuration whose *outcome* the revert changes — is true and survives.
- **Round 10's narration calls its input "the final candidate". It was not** — later candidates
  followed, including the one this block's table names as the current unreviewed delta. Occurrence:
  the round-10 paragraph below, frozen and not edited.
- **Round 8's stopping rule and round 10's zero-edit replacement are both withdrawn.** The rule now
  in force is stated below under the stopping-rule heading, as amended 2026-08-10 to depend on §14
  requirement 7 rather than requirement 6.
- **A round-15 DeepSeek High was refuted on repository evidence — recorded 2026-08-10.** The lane
  held that the unattributed-key early return at `rateLimiter.ts:407` lets an armed-tier deployment
  still allow deletion after reverting 0043, falsifying §10's scoped claim. It does not. That branch
  fires only when the aggregated key equals `UNATTRIBUTED_KEY`, the literal string `unknown`
  (`rateLimiter.ts:100`); `aggregateIp` returns a non-IPv6 argument unchanged (`:115-116`); and the
  account-delete consumer passes the authenticated Supabase user id (`account/delete/route.ts:210`,
  which is reached only after `:196-206` returns `unauthorized()` on a falsy id). The bucket is
  therefore unreachable on that path. An earlier round rejected the same claim on the same evidence;
  it is recorded here so a third round does not have to re-derive it.
- **Round 13 has no narrative record below, and that is a gap this list closes, not a miscount —
  added 2026-08-10.** Rounds 12, 13 and 14 were not given narrative paragraphs; the practice of
  writing one per round stopped after round 11, deliberately, because the meta-commentary had become
  the document's dominant defect surface. Round 13 ran a full five-family panel over candidate
  `4f4850f` and **did not reach quorum** — GLM, DeepSeek and Kimi all failed on routed-provider
  authentication (403 / exit 4 / exit 5) — while the Claude and Codex lanes that did report found the
  defects the round-14 repair then fixed. It is counted in the round total above on that basis. The
  table above names only the *latest* panel, so recording round 13 anywhere else would put a second
  live claim about panel identity outside the single mutable record; this entry is historical, dated,
  and states no current fact.

---

Every review round has found a real defect in this document, and **rounds 2–5 each found a defect
introduced or missed by the previous round's fix.** One four-line claim about `SECURITY DEFINER`
semantics produced four mutually incompatible causal models from four expert reviewers. That is not a
document converging on truth; it is subject matter that resists reliable modelling by inspection.

So do not judge this document by whether the latest round found nothing. Judge it by the table below.
**Trustworthiness is a property of these warrant types, not of the prose.**

| # | Claim | Warrant type | Falsifier |
|---|---|---|---|
| 1 | No migration deletes/truncates/drops `auth.users` | `derived-from-explicit-DDL` — text scan of the 5 packet files, **plus 0043 scanned separately** (claim 15) | A function/trigger body that deletes; not audited (§4.1) |
| 2 | 0034 breaks no application path | `derived-from-explicit-DDL` + repo enumeration | An untraced writer or a definer→invoker flip (§5) |
| 3 | Public-list **read** path is pre-existing | `derived-from-explicit-DDL` (0015 anon EXECUTE) | — solid |
| 4 | `shares_list_publicly` had no reachable writer before 0034 | ~~`author-asserted`~~ **FALSIFIED** | Column grants restrict UPDATE, not INSERT; default `grant all` supplied INSERT |
| 5 | Expect zero currently-`true` rows | **`assumed`** | `select count(*) from profiles where shares_list_publicly` — **run it** |
| 6 | Production's current grants match the assumed baseline | **`assumed`, never stated until now** | `information_schema.role_table_grants` — **run it** |
| 7 | Production's applied migration set is 0000–0032 | **`assumed`** | Query the ledger table |
| 8 | Restore capability exists | **`assumed`, explicitly UNVERIFIED** | Restore a backup into a scratch project |
| 9 | 0042 is additive | `derived-from-explicit-DDL` | — solid |
| 10 | Revoke/re-grant is atomic | `verified-in-repo` — **corrected citation** `apply-migrations.ts:487` `begin` → `:494` SQL → `:499` `commit` → `:503` `rollback` (see claim 14) | — solid at the corrected lines |
| 11 | This packet is the candidate's complete migration set | ~~`assumed`, never stated~~ **FALSIFIED 2026-08-08** | The candidate carries `0043_rate_limits.sql`; 38 files vs 39 (§1) |
| 12 | **On production defaults**, unapplied 0043 ⇒ account deletion denied for every user, whether or not the tier is armed. **Defeasible by `REQUIRE_DURABLE_RATE_LIMIT=0`**, which allows it by removing the **shared** quota while per-instance limiting remains (§8b row 3) | **split** — tier-layer half `verified-by-test` (`rateLimiter.test.ts:251-258`); "unapplied 0043 makes the RPC error" still `derived-from-code` | A client stub returning `PGRST202` through the account-delete consumer — cheaper than a scratch DB, and the harness already exists |
| 13 | §5's enumeration covers the **web candidate**, not just the packet ref | `verified-in-repo` — re-run at `689e564`, output identical | A `src` path reaching these tables other than `.from('<table>')` (dynamic name, raw SQL, a new RPC in INVOKER mode) |
| 14 | §4's atomicity **citation** (distinct from claim 10's conclusion) | ~~`verified-in-repo`~~ **CITATION FALSIFIED 2026-08-08, conclusion intact** | `:281/:320/:322` are `installBootstrapFixture`; the per-file transaction is `:487`–`:503` |
| 15 | §3's destructive-statement scan covers the **candidate's** migration set | ~~implied~~ **corrected 2026-08-08** — the scan covered the 5 packet files; 0043 has since been scanned separately (§3 scope note) | A 40th migration appearing on the candidate without §3 being re-run |

**Claims 5–8 are assumptions; 11 and 14 are falsified; 15 was a silent scope error.** Of the fifteen
load-bearing claims, **four (5–8) cannot be settled by any amount of further reading** and require a
Production query. Claim 12 — the only one predicting a concrete user-visible failure — was *partly*
recovered from that category by the independent review below: its tier-layer half turned out to be
covered by an existing green test, leaving one unverified link instead of six.

**What round 6 (2026-08-08) changed about the diagnosis.** Rounds 1–5 were reviewers disagreeing
about *semantics* — what `SECURITY DEFINER` does, what a column grant restricts. Round 6 found
something different and, for a release gate, worse: three claims that were **true when written and
silently went stale**, plus one enumeration run against **the wrong ref**. No amount of adversarial
reasoning over the prose would have caught either class, because the prose was internally consistent
throughout. Both were caught by re-running the original commands and comparing. That is the actual
argument for the §14b structural fix below: a document whose facts decay needs its claims *recomputed*
on a schedule, not re-argued.

**Round 7 (2026-08-08, independent panel: Claude, Codex, GLM, DeepSeek, Kimi K3).** Reviewing round
6's own material. Every lane found something no other lane found, which is the first round where
that is true:

| Lane | Unique finding |
|---|---|
| Claude | §12 still called `76d610f` "un-reviewed" after §2 had retracted exactly that phrase — round 6 committing the very error it had just diagnosed |
| Codex | The corrected line numbers for §4's atomicity citation (`:487`–`:503`), which Claude flagged as wrong but could not locate |
| GLM | §8b widened the migration set without propagating it into §3's scan scope or §10's revert table — a *consequence* omission rather than a contradiction |
| DeepSeek | The scratch-database falsifier was not the cheapest one; an existing unit test already covers the tier-layer half |
| Kimi K3 | The quotability hazard now guarded at the head of §3, and the scope-dissolution argument recorded below |

One DeepSeek claim was **rejected on repository evidence** (that an unset salt would let deletions
succeed — `rateLimiter.ts:388` refuses instead), but testing it corrected §8b's precondition. Note
what the split implies: the two lanes with repository access found *citation and contradiction*
defects, and the three text-only lanes found *scope, cost and framing* defects. Neither group could
have found the other's.

**Scope dissolution — the finding with the longest reach, from the Kimi lane.** This document was
commissioned to gate *one frozen packet*. §8b establishes that the application candidate depends on
a migration outside that packet. So "review this frozen packet" is no longer a coherent unit of
work: gating the packet alone would approve a schema that breaks account deletion when paired with
the real candidate. **The unit of review must be re-frozen as a bundle** — migration set + pinned
application SHA + the disposition of 0043 — and the window planned as: verify empirically → re-freeze
the bundle → review the delta → schedule. Any plan that gates the old packet alone is planning a
deployment that cannot happen. This supersedes nothing in §1–§13; it reframes what they are a review
*of*, and it is the reason §14 requirement 4 is a blocker rather than a note.

**Round 8 (2026-08-08, second full panel — the review of round 7's repair).** One defect, and
**four lanes converged on the same one** rather than each finding a different one: §8b's Disposition
and §9's item 9(c) still encoded the narrower precondition that §8b had just abandoned in the
paragraph above them. Codex and DeepSeek additionally supplied the missing table row — the
`REQUIRE_DURABLE_RATE_LIMIT=0` escape hatch — which turns "both configurations deny" into "both deny
*on production defaults*". DeepSeek added the forward-ordering and counter-reset notes in §10. Two
DeepSeek claims were **rejected on repository evidence** (the unset-salt claim, and the `:407`
unattributed short-circuit — `aggregateIp` returns any colon-free key unchanged, so a UUID never
becomes the `'unknown'` sentinel). One GLM prediction was wrong on the facts: it expected §13 to be a
rollback runbook carrying the ordering constraint, but §13 is the Staging-authorisation section and
carries no procedure.

### Why the review stopped at round 8, and how to falsify that

*(Historical: this records the decision taken at round 8. Rounds 9 and 10 ran anyway, and round 10
replaced the rule below with a mechanical one — see "The stopping rule is amended". Kept unedited so
the superseded reasoning stays auditable.)*

Eight rounds, every one of which found something real. The stopping decision is **not** "we ran out
of patience", and it should not be read as "the document is now correct". It is a rule, recorded so a
future reader can re-run it:

> **Review terminated after round 8 under a fixed stopping rule: the final round found only
> propagation defects confined to the prior round's edit neighbourhood, introduced no new defect
> class, and produced no finding that changes a gating conclusion; all residual correctness is
> delegated to the empirical checks in §14 requirement 6, which must pass before any action is
> taken.** *(Rule articulated by the Kimi K3 lane.)*

The evidence for it is the **change in defect class**, not the lane agreement — agreement measures
how detectable a defect is, not whether the remaining ones are gone. Rounds 1–5 found contradictions
*generated by* reviewer reasoning; round 6 found document-versus-reality drift; rounds 7 and 8 found
only the previous edit's own incompleteness, at shrinking radius. That is residue, not generation.

**Falsify the rule this way:** if a ninth round finds a defect that is *not* adjacent to round 8's
edits, or that belongs to a class not seen since round 6, or that changes any gating conclusion, the
rule did not hold and the review was stopped early. Note also the one condition the rule nearly
failed: round 8's finding *did* touch a gate-bypassing option (`REQUIRE_DURABLE_RATE_LIMIT=0`). It is
resolved not by hiding the option but by naming it as a removal of protection (§8b row 3), which is
what keeps the gating conclusion intact.

**What the rule does not license.** Termination here means the *document* is as good as reading can
make it. It says nothing about the packet. §14 still applies in full: this is not approved, and the
four assumptions in claims 5–8 remain unsettled by any amount of review.

**Round 9 (2026-08-08, third and final full panel) — the rule fired, and was contested.** Findings:
(a) the sentence *introducing* §8b's four-row table still said "both configurations deny", written
for the two-outcome model it replaced — found independently by the Claude and GLM lanes; (b) row 3's
"completely unlimited" and "removes the quota entirely" overstated the risk, because
`rateLimiter.ts:371` consults an in-memory limiter with the same limit before any branch in the table
— found independently by the Codex and DeepSeek lanes; (c) a catch-block citation off by one line
(Codex); (d) §12's gate list never exercised account deletion at all, let alone under the shipping
configuration (GLM).

*[Editorial marker added 2026-08-10, not part of the round-9 record: this paragraph's heading calls
round 9 the "third and final full panel". It was not final. See "Dated corrections superseding frozen
history" in §14b. The heading is left exactly as round 9 wrote it.]*

**The GLM lane argued the stopping rule was falsified** — that a contradiction *inside* the table
round 8 added is a primary content defect, not a propagation defect, and that it changes a gating
conclusion because an operator cannot read shippability off a self-contradicting table. **The Kimi
lane adjudicated against that, and the adjudication is adopted**, on the ground that the *table* is
correct — row 3 does say "allowed" — so (a) is stale prose adjacent to a correct edit, which is the
definition of a propagation defect rather than a new class. The gating conclusion (not approved;
correctness delegated to §14 requirement 6) was untouched by every finding, and (d) *tightens* the
gate rather than loosening it.

Note what (a) and (b) are together, because it is the most useful thing round 9 produced: the same
passage **overstated** safety in one direction (claiming deletion is always denied when one
configuration allows it) and **overstated** risk in the other (claiming no limit where a per-instance
limit remains). A gate document is wrong in both directions for the same reason — prose drifting from
the mechanism it describes — and neither error is more forgivable than the other.

> **Disclosure, recorded deliberately — SUPERSEDED by round 10, and quoted because being wrong is
> the point.** Round 9 closed with: *"Round 9's four fixes are the last edits to this document and
> they did not themselves receive an independent pass… Anyone resuming should verify that four-item
> diff only… and should not re-review the document from scratch. All four are safety-monotone."*
> An independent coordination audit reopened the item on exactly that admission, and round 10
> reviewed the round-9 state. **The scoping instruction was unsafe and is withdrawn** — see round 10.

**Round 10 (2026-08-08, fourth full panel — the review round 9 declared it had no budget for).**
Commissioned by an independent coordination audit, not by this document. Full five-family panel over
the final candidate: Claude/Sonnet, Codex (`gpt-5.6-sol`), GLM, DeepSeek, Kimi K3 deep. Quorum met;
no lane missing. Findings, with the lanes that found each **independently**:

*[Editorial marker added 2026-08-10, not part of the round-10 record: "the final candidate" above was
not final — later candidates followed. See "Dated corrections superseding frozen history" in §14b.
The sentence is left exactly as round 10 wrote it.]*

| Severity | Finding | Lanes |
|---|---|---|
| HIGH | §9 item 9 and §14b claim 12 still said the escape hatch works by "removing the quota entirely" — **the exact phrase round 9's own §8b correction declares "That is false"** | Claude, Codex, GLM |
| HIGH | §10's revert note asserted the same unconditionally ("immediately denies … for every user"), true only of the shippable rows | Codex, GLM |
| HIGH | §14 requirements 1 and 6 were **two rounds stale** — the operator-facing status section still said "what remains un-reviewed is the round-7 repair" and "six review rounds", while §14b narrated 8 and 9 | Kimi |
| MEDIUM | §8b's "denied … continuously" and §10's rollback rule read as unconditional | Codex, GLM |
| MEDIUM | Two citation defects: `rateLimiter.durable.ts:19-22` (wall-clock timeout, not migration state; correct pointer `:47-50`) and `route.ts:95-97` (override branch, not the production default at `:103-105`) | Claude, Codex |

**Rejected on repository evidence.** DeepSeek argued (i) row 1's throw escapes the `try` and is never
caught — false, `durable.increment` is awaited *inside* the `try` at `rateLimiter.ts:412`, so `:420`
catches it; and (ii) `REQUIRE_DURABLE_RATE_LIMIT` is not wired to `requireDurable`, so row 3 cannot
exist — false, `account/delete/route.ts:97` returns `false` for `'0'`/`'false'`. Row 3 stands.
Separately, Claude and Codex both reported §1's "Lines" column as wrong (they counted physical
lines). **Also rejected:** 130/100/123/46/123 are exactly the **non-blank** line counts at `99ff7b3`,
reproducible by command. The numbers are right; the *convention* is undisclosed, which is the same
LOW first raised in round 1 and still not worth a table column.

> **Why this round matters more than its findings.** Round 9 told the next reviewer to check a
> four-item diff and not to re-review the document. **Round 10's highest-severity finding lived
> outside that diff** — round 9 corrected a claim in §8b and left the same claim standing in §9, §10
> and §14b. A reviewer who obeyed the instruction would have found nothing and signed off. That is
> the concrete demonstration, not the theory, that **a document may record the scope its last review
> had; it may not bind the scope of its next one.** *(Argued by the Kimi lane and confirmed by what
> the panel actually found.)*

**The stopping rule is amended, not re-fired.** The Kimi lane argued the round-8 rule was
question-begging: "propagation defect" is retroactively elastic, so any late finding can be narrated
as residue and the falsifiers can always be talked away — and, on the rule's own third falsifier,
round 9 *added a §12 gate*, which is a gating conclusion. Round 10 adopts a stricter, mechanical
replacement:

> **A round that makes edits is definitionally non-terminal.** Review may terminate only at a round
> that produces **zero edits**.

**That rule lasted one round. Round 11 refuted it and it is withdrawn.** The Kimi lane's argument:
round 8's rule was unfalsifiable toward *stopping*, and the zero-edit rule is the same error
mirrored — unfalsifiable toward *continuation*. Editing is the only way to reach a zero-edit round
and editing is what prevents one, so the termination condition is unreachable by construction. That
is a liveness failure dressed as rigor, and it is worse than what it replaced. Adopted replacement:

> **Review terminates at the first round whose findings are all non-gating, provided §14
> requirement 7's frozen-history completeness check has since been run and recorded. A gating finding
> reopens review.** Falsifiable in both directions: a gating finding stops the stop, and a clean
> non-gating round plus a recorded requirement-7 result stops the loop. A zero-edit round is
> *sufficient* for closure, never *necessary*.
>
> *(Amended 2026-08-10. As adopted in round 11 this rule required "the empirical sequence in §14
> requirement 6", which cannot run before an attended Production window — so review could never
> terminate beforehand however clean a round was, reproducing the unterminatable-by-construction
> failure of the zero-edit rule this one replaced. The precondition is now requirement 7, a document
> check runnable today. Requirement 6 is unchanged and still mandatory before **approval**; it was
> never the right gate on closing **review**. The two rules were always parallel — §14 requirement 6
> says so in its own closing sentence — and this amendment makes the stopping rule agree.)*

**And a round may no longer certify its own edits.** Round 10 wrote its fixes, its stopping rule and
its self-assessment in one commit, and could not see the factual error it had just introduced; round
9 did the same and could not see the three sites it had left stale. Two observations of the same
failure is enough. From here: **a round that edits records *what* it changed and *why*, and is
prohibited from recording *that the change is correct*. Correctness verdicts may only be issued by a
later round that edited nothing it is judging.** *(Both amendments argued by the Kimi lane in round
11; the diagnosis is confirmed by rounds 9, 10 and 11 in sequence.)*

> **"Edited nothing it is judging" is the whole of the restriction — clarified 2026-08-10.** A
> reviewing round necessarily appends its own findings record and, when it corrects a superseded
> claim, an entry in the dated-corrections list. Those appends are **not** edits to the material
> under judgement, so they never disqualify the round from certifying that material. Read otherwise —
> as "a round that writes anything may not certify" — the rule would be the withdrawn zero-edit rule
> in another costume: no round could ever both review and conclude, and termination would again be
> unreachable by construction. A terminal round is therefore reachable: it judges the previous
> round's delta, mutates none of it, and closes review under the stopping rule above once §14
> requirement 6 has been run and recorded.

This is also why §14 requirement 6's empirical checks, not another reading pass, remain the path
forward: every round has found a real defect, and **every round since round 7 has found one created
or left behind by the previous round's fix** (stated without a round number so it cannot go stale —
the count lives only in the Current review state block). The later rounds increasingly found them in
this review record rather
than in §1–§13 — the meta-commentary is now a defect surface in its own right, which is what the
Current review state block above exists to shrink.

**Round 11 (2026-08-08, fifth full panel — the review of round 10's repair).** Full five-family
panel, quorum met, no lane missing. **Round 10's own repair introduced a factual error and left four
stale assertions**, which is recorded here rather than smoothed over:

| Severity | Finding | Lanes |
|---|---|---|
| HIGH | **Round 10 broke §10.** Its new parenthetical called rows 1, 2 and 4 "the shippable configurations" — wrong twice: §8b says three of the four rows are unshippable, and the revert acts only on the rows that reach the RPC. Only **row 4** reaches it; reverting there transitions to row 1, and rows 2 and 3 short-circuit at `rateLimiter.ts:375` before any call. The **unqualified** rule round 10 tried to improve was already correct | Codex, DeepSeek |
| MEDIUM | Round 10's `rateLimiter.durable.ts:47-50` citation was still off — `:47` is blank and the quoted text spans `:48-50` | Codex, Claude |
| MEDIUM | §14b's opening summary, its closing argument, and round 9's "third and **final** full panel" descriptor all still carried the old round count | Codex, GLM |
| MEDIUM | §14 requirement 1 **refreshed** the duplicated review state instead of removing it, guaranteeing the same staleness at the next round | Claude, GLM |
| MEDIUM | §8b's heading and §9 item 9's opening clause still said "fails closed on account deletion" unconditionally while the table shows one configuration allows it | Codex, GLM |
| — | The zero-edit stopping rule is a liveness bug; verdicts must lag edits by one round; the meta-commentary has become the dominant defect surface | Kimi K3 |

*[Editorial marker added 2026-08-10, not part of the round-11 record: two rows of the table above
contain claims later rounds disproved — "Only **row 4** reaches it" (rows 1 and 4 both reach the RPC)
and the quoted descriptor "third and **final** full panel" (round 9 was not final). Both are listed
in "Dated corrections superseding frozen history" in §14b. The table is left exactly as round 11
wrote it.]*

**Nothing was rejected in round 11** — unusually, every lane's findings survived verification against
the repository. GLM additionally supplied the live-versus-frozen test now governing which round
paragraphs may be edited: a claim is **live** when it is a present-tense summary, closing argument,
or "latest/final" descriptor, and **frozen** when it is past-tense narration of what one round found.
Only live claims were corrected; the round-6 diagnosis and the round-8 "eight rounds" line were left
untouched under that test.

**What round 11 demonstrates about round 9's instruction.** Round 9 told a resumer to check a
four-item diff and not re-review the document. Round 10 obeyed a wider brief and found the residue
outside that diff; round 11 then found round 10's own residue. **The correct inference is not that
the reviews are failing — every one has found something real — but that editing this document has a
measurable defect-injection rate, and that no reading round should be trusted to certify itself.**

### Three classes of in-repo assertion this analysis should never have cited as evidence

Claim 4 failed because a **migration comment written by the migration's own author** was promoted
from *intent* ("the author believed X") to *state* ("X is true"). Forbidden as evidence going forward:

1. **Assertions by the artifact under review about its own effects** — migration comments, commit
   messages, PR text. Quote them for intent; never for state.
2. **Universal negatives** — "could only ever be empty" is a claim over all possible write paths and
   all history. No comment can carry that. It needs an enumeration or a query.
3. **Claims resting on external platform defaults** — "Supabase's default `grant all`" was the
   actually-load-bearing fact here, and it lives outside the DDL anyone reviewed. Pin the version, or
   make the default explicit in-repo so it is diffable.

### The structural fix this exercise points at

The safety argument rests on three mechanisms (table grants, column grants, RLS) × four roles
(`anon`, `authenticated`, `service_role`, function owner) × two security contexts (definer/invoker,
including nested), accumulated over ~40 migration files, where the authoritative statement of current
state is "whatever the DDL produced". No one computes that reliably — four experts and one line is
the proof.

**Highest-leverage change: make effective privileges a computed, versioned artifact.** A CI step that
applies all migrations to a scratch Postgres and commits the *derived* state — `role_table_grants`,
`column_privileges`, effective RLS policies, each function's security context — or better, a
policy-as-code suite asserting things like "`anon` cannot read column X by any path". Future
migrations are then reviewed as a **diff of effective state**, not as prose reasoning over
accumulated DDL. That converts claims 5–8 from assumptions into CI output, and makes all three
forbidden evidence classes checkable by construction.

**The cheapest oracle available today was never used:** apply this packet to a throwaway database and
observe. Every review round in the table above happened instead of one experiment, and the later ones
increasingly found defects in the review record rather than in the analysis. For this packet, the
honest posture
is that the safety argument is **unverifiable by the means used**, and the irreversible step should
wait for the empirical check rather than another round of reading.

*(§14b synthesised from the Kimi K3 lane, 2026-08-07.)*

## 15. Provenance of this analysis

| Check | Result |
|---|---|
| Migration files read | `git show 99ff7b3:supabase/migrations/*.sql` — read-only, no checkout |
| Frozen worktree `nb-prod-migrations-0042` | `git -C … status --short` **empty**, HEAD `99ff7b3` — unmodified; **re-verified 2026-08-08** |
| Application analysis (original) | `git grep <pattern> 99ff7b3 -- src` — the **packet** ref |
| Application analysis (2026-08-08) | `git grep <pattern> 689e564 -- src` — the **web candidate**; §5 re-run, identical result |
| Migration SQL modified | **No** |
| Production contacted | **No** |
| SQL executed | **No** |
| Live configuration inspected | **No** |
| Anything executed at all | **No** — this remains reading, not testing (§4.5, §8b) |

**Branch history of this document — corrected 2026-08-08.** The original analysis was performed and
committed on `chore/prime-foundation` (base `origin/main` `6ec5e5d`), which carries migrations only
through `0019`; that is why every migration read came from the frozen ref rather than a working tree,
and it remains the reason the method is `git show`-based throughout.

That draft stated it was committed there "because `fix/nighttime-mobile-hardening` could not be
created: it requires the un-reviewed auth base." **That is no longer true.** The auth gate completed,
`fix/nighttime-mobile-hardening` exists at `689e564`, and this revision is committed on
`harness/nb-20260808-expanded/release-addendum`, forked from that tip — the lineage the mission
required. The content is unchanged in its dependencies: it still reads the packet from the frozen
ref and now additionally re-verifies against the candidate.

The 2026-08-07 lineage is preserved and not rewritten: the original chain
`3484d58 → 262bb8f → 379ddc4 → b232a14 → 325ac7f → ff75ce5 → 299473e` remains on
`chore/prime-foundation`. This file was reproduced from `299473e` byte-for-byte and then amended, so
the two branches hold the same document at different revisions rather than two independent drafts.
