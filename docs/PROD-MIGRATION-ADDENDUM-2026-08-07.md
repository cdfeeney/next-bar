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

## 8b. ⛔ Finding (new, 2026-08-08): the packet and the candidate are **mismatched**, and the mismatch fails closed on account deletion

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
falls back to per-instance limiting.

**The failure does not depend on the shared tier being armed — corrected 2026-08-08.** An earlier
version of this section made "with the shared tier armed" a precondition. Checking the other branch
shows the precondition is unnecessary, because **in production both configurations deny**:

| Production configuration | Path taken | Account deletion |
|---|---|---|
| Tier armed (URL + service key + salt present), 0043 **unapplied** | RPC errors → throw → `rateLimiter.ts:422` catch → `allowed: onDegraded === 'fail-open'` | **denied** |
| Tier **not** armed (any of the three env vars missing) | `rateLimiter.ts:375` `if (!durable \|\| !salt)` → `:388` `if (requireDurable) return { allowed: false, degraded: true }` | **denied** |
| Tier armed **and** 0043 applied | normal | allowed, limited to 5/user/hour |

`requireDurable` defaults **on** in production (`account/delete/route.ts`, `requireDurableRateLimit()`),
and its whole purpose is to refuse loudly rather than silently fall back to per-instance limiting on
the one irreversible action. So the honest statement is stronger than the original: **in production,
account deletion works only if 0043 is applied.** Misconfiguring the tier does not rescue it; it just
changes which line denies.

*(This correction came out of testing a DeepSeek claim that an unset salt would let deletions
succeed. The repository shows the opposite — `:388` refuses — so that claim is **rejected on
evidence**; but checking it exposed that this section's precondition was too narrow.)*

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
`rateLimiter.durable.ts:19-22` anticipates an unapplied migration in prose — under §14b's first
forbidden evidence class that comment is cited here as the author's *intent* only, and carries no
weight as evidence of runtime state.

**Disposition.** Whether to ship 0043 inside this window, ship it separately before the candidate,
or deploy a candidate without the durable tier armed is **an operator decision, not this document's
call** (§13, §14). What this document does assert is that **the packet and `689e564` must not be
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
   closed on account deletion. Before the window, decide and record (a) whether 0043 ships inside it,
   (b) which web artifact SHA is being paired with the resulting schema, and (c) whether the shared
   rate-limit tier will be armed in that deployment. These three answers are **not independent** —
   arming the tier without 0043 is the failing combination.

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
> `consume_rate_limit`, and by §8b that immediately denies account deletion for every user in
> production, because the candidate calls that function and the only fail-closed consumer refuses
> when it is missing. **So 0043 must not be reverted while a candidate that calls it is deployed** —
> the rollback order is application first, then migration. Reverting in the other order converts a
> rollback into an outage of the account-deletion path.
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

1. Fresh independent review of this addendum and the packet. *(Updated 2026-08-08: the original
   wording — "has had no independent review at the time of writing" — is superseded. The document has
   since been through five review rounds across the Claude, Codex, GLM, DeepSeek and Kimi lanes, and
   the 2026-08-08 revision adds §8b and rewrites §1, §2, §5, §9 and §15. That revision has **since
   been reviewed** by a five-family panel (round 7, §14b), whose findings are folded in above. What
   remains un-reviewed is the round-7 repair itself. The requirement therefore still stands, but it
   is now narrow: review the round-7 delta, not the document from scratch.)*
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
   Six review rounds preceded these, and rounds 6 and 7 each still found real defects — so the
   ordering above, not another reading pass, is the remaining path to trustworthy.

## 14b. Claim ledger — read this instead of trusting the prose

Five review rounds each found a real defect in this document, and **rounds 2–5 each found a defect
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
| 12 | In production, unapplied 0043 ⇒ account deletion denied for every user, **in both tier configurations** | **split** — tier-layer half `verified-by-test` (`rateLimiter.test.ts:251-258`); "unapplied 0043 makes the RPC error" still `derived-from-code` | A client stub returning `PGRST202` through the account-delete consumer — cheaper than a scratch DB, and the harness already exists |
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
observe. Five review rounds happened instead of one experiment. For this packet, the honest posture
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
