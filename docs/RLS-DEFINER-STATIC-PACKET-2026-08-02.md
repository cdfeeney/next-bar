# RLS + SECURITY DEFINER static reconciliation packet

**Static analysis only. This document's authoring made no database or network
contact — no `psql`, no Supabase client, no migration tooling was run.** Every
claim below is derived from reading `supabase/migrations/0000_*.sql` through
`0036_*.sql` (37 files, all read in full) at repo HEAD on branch
`feat/overnight-2026-07-30`, with ONE clearly-marked imported evidence item:
§3.1's reconciliation quotes the SEPARATE read-only staging ledger check
performed for the 0036 acceptance (goal g-44d15c24, same day) — that check was
not run by or for this packet. Generated 2026-08-02 for goal **g-b4529acc**.

This packet reconciles those 37 files into a **final-posture inventory**: for
each object, the result of replaying every `CREATE`, `DROP`, `REVOKE`, `GRANT`
statement across all 37 files **in file order**, last-writer-wins. It also
cross-references `docs/C3-RLS-AUDIT-2026-07-30.md` (scope: 0000–0033) and
`docs/C4-DEFINER-FUNCTION-AUDIT-2026-07-30.md` (scope: 0000–0032/0033) and
flags every place this reconciliation agrees or disagrees with them.

> **The single most important caveat, stated up front:** three of the 37
> files self-report as unapplied. `0035_share_night_date_bound.sql` says
> outright: *"NOT APPLIED. The live ledger ends at 0032; 0033, 0034 and now
> 0035 are authored and reviewed only."* `0033_vibe_profiles.sql` and
> `0034_revoke_first_grants.sql` carry the same status. `0036`'s own apply
> state is not self-declared in its text. **This document describes the
> posture the *migration source* declares if applied in order — not
> necessarily what the live database currently enforces.** See §6.

---

## 1. Per-table net posture (last-writer-wins across 0000–0036)

19 tables are created by these migrations (matching C3 §1's count exactly —
0034–0036 create no new tables). RLS is enabled in the **same file** that
creates every one of them; no file anywhere disables RLS on any table. A 20th
object, `public.schema_migrations`, is not created by any of these files (it
is created by `scripts/apply-migrations.ts`) but is hardened by `0036` and is
listed separately at the end of this section.

### 1a. Owner-scoped tables (RLS on, policy gated on `auth.uid()`)

| Table | RLS enabled | Surviving policies | Net grants: anon | Net grants: authenticated | Net grants: service_role |
|---|---|---|---|---|---|
| `profiles` | `0001:75` | select `0001:84-86`; update `0001:88-91`; insert `0001:93-95` (none dropped later) | none (`0034:42` revokes all, nothing re-grants anon) | select, insert (`0034:44`); update(display_name, is_private, shares_list_publicly) (`0034:64-65`, supersedes `0006:83`'s narrower 2-column list) | not explicitly touched (default Supabase full access stands; `0034` revokes only public/anon/authenticated) |
| `ratings` | `0001:76` (note: two spaces before `enable`, syntactically valid — the exact whitespace C3 §1 item 1 flagged as a false-negative risk for naive greps) | select/insert/update/delete, all `auth.uid()=user_id`, `0001:104-119` | none (`0015:96` then superseded by the wider `0034:77`) | select, insert, update, delete (`0034:82`) | untouched |
| `pairwise_comparisons` | `0002:37` | select/insert/delete, `0002:43-53` (deliberately **no** update policy, `0002:55` comment) | none (`0034:91`) | select, insert, delete — **no update** (`0034:99`, matches the missing policy) | untouched |
| `follows` | `0007:52` | select (both parties) `0007:54-57`; insert (follower) `0007:59-62`; delete (follower) `0007:64-67` — all three **retained**, none dropped | none (`0007:72`) | select only (`0007:73`) — insert/delete policies exist but are **grant-unreachable**; writes go only through definer RPCs (`follow_user`/`unfollow_user`, `0007`; `accept_follow_request`, `0008:152,200`) | untouched |
| `follow_requests` | `0008:55` | select (both parties) `0008:60-62` | none (`0008:69`) | select only (`0008:70`); all writes RPC-only | untouched |
| `push_subscriptions` | `0009:46` | select (owner) `0009:50-52` | none (`0009:54`) | select only (`0009:55`); writes via `save_/delete_push_subscription` RPCs | untouched |
| `vibe_profiles` (0033, self-declared **unapplied**) | `0033:49` | select/insert/update/delete, all owner-scoped, `0033:56-82` | none (`0033:102`) | select, insert, update, delete (`0033:107-108`) | untouched |
| `bar_suggestions` | `0011:46` | delete (own row) `bar_suggestions_delete_own`, `0011:52-54` | none (`0011:47`) | delete only (`0011:50`); insert via `suggest_bar`, read via `get_circle_suggestions` | untouched |
| `bar_rsvps` | `0012:50` | **none** — its only policy (`bar_rsvps_delete_own`) was dropped by `0014:19` | none (`0012:51`, never widened) | **none** — the `0012:53` delete grant was revoked by `0014:18` | untouched |
| `vibe_votes` | `0017:41` | delete (own row) `vibe_votes_delete_own`, `0017:46-49` | none (`0017:42`) | delete only (`0017:45`); insert via `cast_vibe_vote`, read via `get_circle_vibe_votes` | untouched |
| `bar_change_queue` | `0020:195` | select (own) `bar_change_queue_read_own` `0020:208-211` (unchanged); insert (own, `pending_change_count() < 20`) `bar_change_queue_insert_own` — **v2** `0021:44-54`, replacing the v1 policy dropped at `0021:25` | none (`0020:196`) | select, insert (`0020:197`) | untouched |

### 1b. Deliberately public (non-`auth.uid()` predicate)

| Table | Policy | Predicate | Net grants |
|---|---|---|---|
| `bars` | `bars_select_all`, `0019:92-94` | `to anon, authenticated using (true)` | anon+authenticated: select only (`0019:90`); service_role: select/insert/update/delete (`0019:96`) |
| `bar_photos` | `bar_photos_read_approved`, `0020:139-142` | `using (moderation_status = 'approved')` | anon+authenticated: select only (`0020:137`), gated by the policy to approved rows; no client write grant anywhere (uploads are service-role-only per `0020` comment) |

### 1c. RLS enabled, zero policies — deny-all by design, reachable only via SECURITY DEFINER RPC

| Table | RLS | Grants | Reached via |
|---|---|---|---|
| `analytics_events` | `0018:32` | none to public/anon/authenticated (`0018:33`); service_role gets insert/update/select (`0018:56`) | `bump_analytics_event` — **not** a definer function (see §2); works because EXECUTE is granted to `service_role` only |
| `shared_nights` | `0016:66` | none (`0016:67`) | `share_night` / `unshare_night` / `get_shared_night` |
| `follow_attempts` | `0007:89` | none (`0007:90`) | internal counter, written only inside `follow_user` |
| `handle_claim_attempts` | `0006:58` | none (`0006:59`) | internal counter, written only inside `claim_handle` |
| `handle_search_attempts` | `0006:69` | none (`0006:70`, re-revoked defense-in-depth at `0007:303`) | internal counter, written by `search_handles`/`get_profile_by_handle`/`get_follower_count` |
| `photo_permissions` | `0020:95` | none (`0020:96`) | **no RPC anywhere in these 37 files** — service-role/table-owner only |
| `bar_rsvps` | `0012:50` | none (final state, §1a) | `rsvp_bar` / `unrsvp_bar` / `get_circle_rsvps` |

### 1d. `public.schema_migrations` — not created by these migrations, hardened by `0036`

Not one of the 19 counted above (it is created by `scripts/apply-migrations.ts`,
outside migration-file DDL). `0036` retrofits it:
- `alter table public.schema_migrations enable row level security;` — `0036:38`
- `revoke all on table public.schema_migrations from public, anon, authenticated;` — `0036:40-41`
- No policies created. `service_role` is untouched (has `BYPASSRLS` per `0036`'s comment). Deny-all to every browser-reachable role.

### 1e. Surviving browser-role (anon/authenticated) **write** paths at the table level (not RPC-mediated)

Per item 3 of the task, enumerated explicitly rather than left implicit:

- `profiles` — authenticated **insert** (RLS: `auth.uid()=id`) and **update** of exactly `display_name, is_private, shares_list_publicly` (`0034:44,64-65`). Direct table write, not RPC-mediated; policy-gated to the caller's own row.
- `ratings` — authenticated **insert/update/delete** (`0034:82`), RLS owner-scoped. Core app write path (`src/lib/ratings.server.ts` per `0034`'s own comment).
- `pairwise_comparisons` — authenticated **insert/delete**, no update (`0034:99`), RLS owner-scoped, immutable-by-design.
- `bar_change_queue` — authenticated **insert** (`0020:197`), RLS-gated to `submitted_by = auth.uid()` and a definer-enforced pending-count cap (`0020:199-206`, replaced `0021:44-54`). This is the one exception to the "RPC-mediated" house style, and the migration says so explicitly (`0020:152-155`: "low blast radius... acceptable here — unlike photos and claims").
- `vibe_profiles` — authenticated **insert/update/delete** (and select) granted directly (`0033:107-108`; insert/update back the profile sync, delete backs Settings' "Clear your saved vibe profile"), RLS owner-scoped (`0033:56-82`). **[Correction at review — Codex: this row was omitted from the original write-path list even though §1a carried the grants.]**
- `follows` — **read-only at the table level**: `0007:72-73` revokes all and re-grants **select only** to authenticated; the insert/delete POLICIES survive but are grant-unreachable (defense-in-depth per `0007`'s own comment). Every write goes through SECURITY DEFINER RPCs — `follow_user`/`unfollow_user` (`0007`) **and** `accept_follow_request` (`0008:152,200` inserts into `public.follows`; authenticated EXECUTE at `0008:214-215`). **[Corrections at review — Codex, twice: first for the false "delete-only" grouping, then for this list omitting the 0008 write path.]**
- `bar_suggestions`, `bar_rsvps`, `vibe_votes` — authenticated has **delete-only** direct grants (or none, for `bar_rsvps` after `0014`); inserts/updates go exclusively through SECURITY DEFINER RPCs.
- `bars`, `bar_photos` — **read-only** for anon/authenticated; no direct write grant exists anywhere in the 37 files.
- `shared_nights`, `analytics_events`, and the six deny-all tables in §1c — **zero** direct grants of any verb to anon/authenticated.

No table grants `INSERT`, `UPDATE`, or `DELETE` to `anon` anywhere in the 37 files. The only role ever granted a write verb to `anon` is nothing — `anon` never receives more than `SELECT` (on `bars`, `bar_photos`) or `EXECUTE` on two functions (§2).

---

## 2. SECURITY DEFINER function inventory (final surviving definitions)

**29 SECURITY DEFINER functions survive** the full 0000–0036 replay — the
identical count C3/C4 derived from 0000–0033, because none of `0034`, `0035`,
`0036` add a new definer function; `0035` only replaces the body of an
existing one (`share_night`), and `0034`/`0036` contain no `CREATE FUNCTION`
at all. **28 are callable via PostgREST**; `handle_new_user` is trigger-only.
**29/29 pin `search_path` — all to `public`**, none to the stricter `''`
(confirming C3 F1's finding still holds unchanged through `0036`).

Two prior versions are correctly excluded as superseded, replaying the
`DROP`/`CREATE OR REPLACE` history in file order: `follow_user(uuid) returns
boolean` (`0007:102`) was dropped and replaced by `follow_user(uuid) returns
text` (`0008:81`); `pending_change_count(p_user uuid)` (`0020:179`) was
dropped and replaced by the zero-arg `pending_change_count()` (`0021:28`).
`share_night` was **not** dropped — `0035:61` uses `create or replace`
(legal because the signature and return type are unchanged), so it is one
function with two authored bodies; only the `0035` body is live in source.

| Function | Introduced | One-line purpose | Explicit `search_path`? | EXECUTE granted to | Cite (grant) |
|---|---|---|---|---|---|
| `handle_new_user()` | 0001 | Auto-creates a `profiles` row on new `auth.users` insert (trigger) | yes, `public` (`0001:55`) | trigger-only; **PUBLIC execute never revoked** (see C4 F3, §4) | n/a — no revoke statement exists for it anywhere |
| `claim_handle(text)` | 0006 | Atomic, rate-capped (10/day) username claim, no renames | yes, `public` (`0006:93`) | authenticated | revoke `0006:150`; grant `0006:151` |
| `search_handles(text)` | 0006 | Prefix search over public handles, rate-capped 500/day | yes, `public` (`0006:168`) | authenticated | revoke `0006:201`; grant `0006:202` |
| `unfollow_user(uuid)` | 0007 | Deletes caller's own follow edge | yes, `public` (`0007:161`) | authenticated | revoke `0007:180`; grant `0007:181` |
| `get_profile_by_handle(text)` | 0007 | Exact-handle profile resolution (incl. private), shares search cap | yes, `public` (`0007:198`) | authenticated | revoke `0007:228`; grant `0007:229` |
| `get_following()` | 0007 | Caller's own follow list, handle-resolved | yes, `public` (`0007:250`) | authenticated | revoke `0007:259`; grant `0007:260` |
| `get_friend_ratings()` | 0007 | Tier-only (never score) ratings of followed users, materialized fence | yes, `public` (`0007:282`) | authenticated | revoke `0007:297`; grant `0007:298` |
| `follow_user(uuid) → text` | 0008 (replaces 0007 bool version) | Follow-or-request state machine, rate-capped 100/day | yes, `public` (`0008:85`) | authenticated | revoke `0008:164`; grant `0008:165` |
| `accept_follow_request(uuid)` | 0008 | Target consents; atomic delete-request + insert-edge | yes, `public` (`0008:175`) | authenticated | revoke `0008:214`; grant `0008:215` |
| `decline_follow_request(uuid)` | 0008 | Target refuses; deletes the request | yes, `public` (`0008:225`) | authenticated | revoke `0008:242`; grant `0008:243` |
| `cancel_follow_request(uuid)` | 0008 | Requester withdraws their own request | yes, `public` (`0008:253`) | authenticated | revoke `0008:270`; grant `0008:271` |
| `get_follow_requests()` | 0008 | Caller's inbox of pending requests | yes, `public` (`0008:286`) | authenticated | revoke `0008:295`; grant `0008:296` |
| `get_outgoing_requests()` | 0008 | Caller's own outgoing pending requests | yes, `public` (`0008:308`) | authenticated | revoke `0008:317`; grant `0008:318` |
| `save_push_subscription(text,text,text)` | 0009 | Upsert own push subscription, device-capped, cross-account ownership transfer | yes, `public` (`0009:69`) | authenticated | revoke `0009:118`; grant `0009:119` |
| `delete_push_subscription(text)` | 0009 | Delete caller's own subscription | yes, `public` (`0009:129`) | authenticated | revoke `0009:146`; grant `0009:147` |
| `get_followers()` | 0010 | Caller's own followers, handle-resolved | yes, `public` (`0010:44`) | authenticated | revoke `0010:53`; grant `0010:54` |
| `get_follower_count(uuid)` | 0010 | Follower count; null-indistinguishable for unknown/hidden-private | yes, `public` (`0010:65`) | authenticated | revoke `0010:116`; grant `0010:117` |
| `suggest_bar(text,date)` | 0011 | Night-scoped bar suggestion, capped 3/night, ±2-day bound | yes, `public` (`0011:64`) | authenticated | revoke `0011:119`; grant `0011:120` |
| `get_circle_suggestions(date)` | 0011 | Own + followed users' suggestions for a night | yes, `public` (`0011:131`) | authenticated | revoke `0011:147`; grant `0011:148` |
| `rsvp_bar(text,date)` | 0012 | Single-RSVP-per-night move, advisory-lock serialized | yes, `public` (`0012:67`) | authenticated | revoke `0012:102`; grant `0012:103` |
| `get_circle_rsvps(date)` | 0012 | Own + followed users' RSVPs for a night | yes, `public` (`0012:114`) | authenticated | revoke `0012:130`; grant `0012:131` |
| `unrsvp_bar(text,date)` | 0013 | Serialized "I'm out", same lock key as `rsvp_bar` | yes, `public` (`0013:33`) | authenticated | revoke `0013:63`; grant `0013:64` |
| `get_public_ratings(text)` | 0015 | Anon-readable tier list for opted-in, non-private profiles; `limit 50` | yes, `public` (`0015:68`) | **anon + authenticated** | revoke `0015:87`; grant `0015:88` |
| `unshare_night(date)` | 0016 | Owner deletes their shared-night row (revokes the link) | yes, `public` (`0016:137`) | authenticated | revoke `0016:194`; grant `0016:195` |
| `get_shared_night(uuid)` | 0016 | Anon read of a shared night, keyed on bearer token alone | yes, `public` (`0016:170`) | **anon + authenticated** | revoke `0016:199`; grant `0016:200` |
| `cast_vibe_vote(date,text)` | 0017 | Upsert-move one vibe vote per night, ASCII-only tag validation | yes, `public` (`0017:59`) | authenticated | revoke `0017:93`; grant `0017:94` |
| `get_circle_vibe_votes(date)` | 0017 | Own + followed users' vibe votes for a night | yes, `public` (`0017:105`) | authenticated | revoke `0017:134`; grant `0017:135` |
| `pending_change_count()` | 0021 (replaces 0020's `(uuid)` version) | Caller's own pending-correction count, identity from `auth.uid()` only | yes, `public` (`0021:33`) | authenticated | revoke `0021:41`; grant `0021:42` |
| `share_night(date,text[],text)` | 0035 body (replaces 0016 body) | Owner upsert of a shared-night route, **now ±2-day bounded** (C4 F1 fix) | yes, `public` (`0035:69`) | authenticated | revoke `0035:120`; grant `0035:121` |

**Not SECURITY DEFINER — noted because they run against user-writable tables and are easy to mistake for definer functions:**
- `touch_updated_at()` (0001:125), `ratings_lww_guard()` (0005:26) — plain invoker triggers, no `search_path` pin.
- `bars_touch_updated_at()` (0019:62), `photo_permissions_immutable()` (0020:79) — invoker triggers, no `search_path` pin.
- `bump_analytics_event(text,date)` (0018:39) — **invoker**, not definer; safe only because EXECUTE is granted exclusively to `service_role` (0018:54-55), which bypasses RLS independent of the function's security mode. Matches C3 §3's explicit correction of an earlier draft.
- `vibe_profiles_lww_guard()` (0033:114-121) — **invoker**, not definer, but *does* pin `set search_path = ''` (0033:120) — the strict form C3 F1 recommends. This is the one function in the whole set that uses the stricter empty-string pin, and it is not even a definer function, so it does not change the "29/29 pin `public`, 0 pin `''`" count for the definer inventory. Inconsistent with `ratings_lww_guard` (its direct structural sibling, 0005), which pins nothing at all — low severity since neither is definer, but worth noting as the kind of drift that compounds.

**Owner assumptions — cannot be determined statically.** SECURITY DEFINER
functions run with the privileges of the function's **owner** (whoever's role
executed the `CREATE [OR REPLACE] FUNCTION`), not the caller. No file
contains an `ALTER FUNCTION ... OWNER TO` statement, so ownership is
whatever the migration-runner's connection role was at apply time —
typically the Supabase migration/service role. This is a **live-only** fact;
see §6.

---

## 3. Drift risks

1. **Three security-relevant migrations are authored fixes that self-report as unapplied.**
   - `0034_revoke_first_grants.sql` closes C3 F3 (revoke-first hardening on
     `profiles`/`ratings`/`pairwise_comparisons`) and C3 F5 (the
     `shares_list_publicly` column-grant gap that made the public-share
     opt-in unreachable by its own owner). `0035_share_night_date_bound.sql`
     closes C4 F1 (`share_night`'s missing ±2-day bound). Both are complete,
     reviewed, idempotent SQL — but `0035:1-4` states plainly: *"NOT
     APPLIED. The live ledger ends at 0032."* If that is still true at repo
     HEAD, **the C3 F3/F5 and C4 F1 gaps these files fix may still be live
     in production**, even though the source tree looks fixed. This is the
     highest-value item to verify live (§6).
   - `0033_vibe_profiles.sql` carries the same self-declared unapplied
     status (confirmed independently by C3 §1's own note, and by `0033`'s
     own comment at lines 99-101 explaining why its grant fix was folded
     into the same unapplied file rather than issued as a separate `0034`).

   > **RECONCILED against live staging, 2026-08-02 (added at review):** those
   > in-file comments are STALE for `next-bar-staging`. A read-only ledger
   > check this session (documented in the 0036 acceptance evidence, goal
   > g-44d15c24) returned `migration_count = 37`, `last_migration =
   > 0036_protect_schema_migrations.sql` with RLS enabled and all four
   > browser privileges false on `schema_migrations` — so 0033–0036 ARE
   > applied on staging, and the operator recorded attended acceptance of
   > 0036 at `0f71333`. What remains genuinely unknown statically is
   > **production**: its ledger has not been read (different project ref;
   > the production service-role key is recorded invalid in MASTER-TODO B1),
   > so "these fixes may not be live IN PRODUCTION" stands, while the
   > stronger "the live ledger ends at 0032" in `0035:1-4` is a stale
   > comment that should be corrected whenever that file is next legally
   > editable (it is byte-frozen for this mission).

2. **`bar_rsvps` — a deliberate three-file narrowing, not accidental drift.**
   `0012` opens a direct owner-scoped `DELETE` grant + policy for "I'm out"
   (`0012:53-57`). `0013` adds the advisory-lock-serialized `unrsvp_bar` RPC
   but *keeps* the `0012` grant open for the deploy window (`0013:16-21`
   states this explicitly, citing a real cross-tab race PR #14 review
   found). `0014` then revokes the grant and drops the policy
   (`0014:18-19`), closing the window. Read `0012` alone and you would
   conclude the table has a client delete path; the true final state (zero
   grants, zero policies) only emerges after replaying all three files in
   order — exactly the trap a file-by-file (rather than schema-final) audit
   falls into, which is the same trap C3 §1's counting-rule correction
   describes.

3. **`pending_change_count` — a fixed authorization bug, closed in the very next file.**
   `0020`'s version took an arbitrary `p_user uuid` parameter while running
   as SECURITY DEFINER and granted to any `authenticated` caller — any
   signed-in user could query any *other* user's pending-correction count
   (`0021:5-11` names this as the defect). `0021` drops and replaces it with
   a zero-arg version that derives the caller from `auth.uid()` internally.
   Low severity as C4 rates it, but structurally it is exactly the
   "definer function trusts a caller-supplied identity parameter" pattern
   C4's headline says never happens elsewhere (C4 lines 36-41). **What a
   static replay can honestly say (corrected at review — Codex):** any
   database whose ledger sat between `0020` and `0021` DID expose the
   uuid-parameter version with authenticated EXECUTE (`0020:179-193`) until
   `0021:25-42` dropped and replaced it — "the fix landed before any live
   risk" cannot be established from source alone; only per-environment
   apply timestamps could show whether that window was ever live.

4. **`follow_user` return-type change, handled correctly.** `0007` creates
   `follow_user(uuid) returns boolean`; `0008` needs a `text` return
   (`'followed'|'requested'|'rejected'`) and Postgres refuses a return-type
   change via `CREATE OR REPLACE`, so `0008:79` explicitly `drop function`s
   first. `0007:101` itself contains a forward-looking `drop function if
   exists public.follow_user(uuid);` guard for exactly this reason, with a
   comment explaining why the drop is safe within a single full replay. Not
   a security regression — noted because a reader who stops at `0007`
   would misdescribe the function's final signature and grants.

5. **No table created without RLS survives to `0036`.** Every one of the 19
   `CREATE TABLE` statements is followed, in the *same file*, by `alter
   table ... enable row level security`. No file anywhere issues `disable
   row level security`. This reconciliation independently reproduces C3's
   "no table with RLS disabled" finding across three additional files C3
   never saw (`0034`-`0036`), and it still holds.

6. **Commented-out rollback blocks — checked, not just assumed safe.** Every
   one of the 37 files ends with a `-- Rollback (in comments, per
   convention): ...` block. All are consistently prefixed with `--` on
   every line in every file read for this packet (including the
   longer/more SQL-like blocks in `0027`, `0028`, `0034`) — none is
   live, executable SQL, and none was found formatted in a way that could
   be mistaken for an uncommented statement (e.g. no block comment
   `/* ... */` left unclosed, no rollback line missing its leading `--`).

7. **Two openly-documented anon-readable surfaces, both opt-in-gated —
   correctly narrow, but worth naming as the widest exposure in the
   schema.** `get_public_ratings` (0015) and `get_shared_night` (0016) are
   the only two definer functions granted to `anon`. Both are deliberate,
   both are materialized-fenced against the LEAKPROOF-`=` timing side
   channel the migrations themselves call out (`0007:266-271`,
   `0015:47-52`, `0016:154-157`), and neither was touched by any later
   file. No drift here — flagged because "anon-reachable" is the
   highest-leverage thing to re-check first if a future migration ever
   touches either function.

---

## 4. Cross-reference: `docs/C3-RLS-AUDIT-2026-07-30.md` and `docs/C4-DEFINER-FUNCTION-AUDIT-2026-07-30.md`

### Agreements (independently reproduced by this reconciliation)

- Table count: **19** created, all RLS-enabled. (C3 §1; this packet §1)
- Definer function count: **29 surviving, 28 callable, 1 trigger-only,
  29/29 `search_path`-pinned to `public`.** (C3 §1, C4 "Headline"; this
  packet §2) — unchanged even after including three more files (`0034`-`0036`)
  than either audit covered, because none of them add or remove a definer
  function.
- Policy count: **25 surviving** `create policy` statements across 12
  tables. (C3 §1) — this packet independently confirms no policy was added
  or dropped by `0034`, `0035`, or `0036` (0034 is grants-only with zero
  `policy` keyword occurrences; 0035 replaces a function body only; 0036
  creates no policy).
- The 7 RLS-on/zero-policy deny-all tables (C3 §3) are unchanged through `0036`.
- C4 F3 (`handle_new_user` never revokes `PUBLIC` execute, safe only because
  its `returns trigger` type makes it uncallable via PostgREST) — this
  packet independently confirms no later file (`0034`-`0036`) issues a
  revoke for it. Still open, still INFO-severity, still true.
- No definer function anywhere derives identity from a caller-supplied
  parameter, with `pending_change_count(uuid)` (0020) as the sole
  near-miss — and that near-miss was fixed one file later, in `0021`, which
  both audits' "what I did not find" sections implicitly rely on since
  their scope already assumed the `0021` fix.

### Status updates on named findings (not disagreements — later files acting on the audits)

- **C3 F3** (revoke-first skipped on `profiles`/`ratings`/`pairwise_comparisons`/`vibe_profiles`) —
  **closed in migration source** by `0034` (three tables) and `0033`
  itself (`vibe_profiles`, per its own in-file note at `0033:99-101`
  explaining the fix was folded into the unapplied `0033` rather than a
  separate file). **Not necessarily closed live** — see §3 item 1 and §6.
- **C3 F5** (`shares_list_publicly` column grant missing, so the public-share
  opt-in was unreachable by its owner) — **closed in migration source** by
  `0034:64-65`'s extended column grant. Same live-verification caveat.
- **C4 F1** (`share_night` has no date bound, unlike its three siblings) —
  **closed in migration source** by `0035`, which adds the identical
  `current_date - 2 .. current_date + 2` guard the three siblings already
  had (`0035:84-86`). Same live-verification caveat.
- **C4 F2** (private-vs-share-link semantics: `get_shared_night` does not
  check `is_private`, unlike `get_public_ratings`) — **not touched by any
  of `0034`-`0036`.** Still open, and C4 itself recommends an operator/UI
  decision rather than a schema fix, so "unresolved" is expected, not a gap
  in these three files.

### No true discrepancies found

This reconciliation did not find a case where a migration file's actual SQL
contradicts what C3 or C4 claims about the 0000–0032/0033 state they
audited. Every check performed above (counts, per-table grants, the
`handle_new_user` PUBLIC-execute gap, the materialized-fence rationale, the
`pending_change_count` fix timeline) reproduces their numbers exactly. The
only thing this packet adds is scope (three more files) and the finding in
§3 item 1: **the fixes those three files encode may not be live**, which is
a fact about deployment state, not a factual error in either audit.

---

## 5. Completeness table — all 37 files read in full

| File | Disposition |
|---|---|
| `0000_reconcile_v01_schema.sql` | schema — renames legacy v0.1 tables out of the way; no RLS/grant content |
| `0001_v0.5.0_auth_and_ratings.sql` | schema+policy — creates `profiles`/`ratings`, RLS+owner policies, `handle_new_user` definer trigger |
| `0002_v0.5.1_pairwise.sql` | schema+policy — creates `pairwise_comparisons`, RLS+owner policies (no update policy) |
| `0003_demo_cleanup.sql` | data-fix — deletes seeded demo `ratings` rows; no security-object change |
| `0004_backfill_profiles.sql` | data-fix — backfills `profiles` rows for pre-existing `auth.users`; no security-object change |
| `0005_sync_hardening.sql` | schema — `ratings.updated_at` + LWW trigger (invoker, unpinned search_path), `pairwise_comparisons.session_id` column |
| `0006_usernames.sql` | schema+policy — handle uniqueness, attempt-counter tables, revoke-first `profiles.update`, `claim_handle`/`search_handles` definer RPCs |
| `0007_follows.sql` | schema+policy — `follows`+`follow_attempts` tables, revoke-first grants, `follow_user`/`unfollow_user`/`get_profile_by_handle`/`get_following`/`get_friend_ratings` definer RPCs |
| `0008_follow_requests.sql` | schema+policy — `follow_requests` table, `follow_user` replaced (bool→text), `accept/decline/cancel_follow_request`, `get_follow_requests`/`get_outgoing_requests` definer RPCs |
| `0009_push_subscriptions.sql` | schema+policy — `push_subscriptions` table, `save_/delete_push_subscription` definer RPCs |
| `0010_followers.sql` | policy — adds `get_followers`/`get_follower_count` definer RPCs (no new table) |
| `0011_bar_suggestions.sql` | schema+policy — `bar_suggestions` table, `suggest_bar`/`get_circle_suggestions` definer RPCs |
| `0012_bar_rsvps.sql` | schema+policy — `bar_rsvps` table + unique index, `rsvp_bar`/`get_circle_rsvps` definer RPCs, temporary owner-delete grant |
| `0013_unrsvp_rpc.sql` | policy — adds `unrsvp_bar` definer RPC; explicitly retains the 0012 grant for a deploy window |
| `0014_revoke_bar_rsvps_delete.sql` | policy — revokes the `bar_rsvps` delete grant and drops its policy, closing the 0012/0013 window |
| `0015_public_shared_list.sql` | schema+policy — `profiles.shares_list_publicly` column, `get_public_ratings` anon-readable definer RPC, explicit `ratings` anon revoke |
| `0016_shared_nights.sql` | schema+policy — `shared_nights` table, `share_night`/`unshare_night`/`get_shared_night` definer RPCs (bearer-token design) |
| `0017_vibe_votes.sql` | schema+policy — `vibe_votes` table, `cast_vibe_vote`/`get_circle_vibe_votes` definer RPCs |
| `0018_analytics_events.sql` | schema+policy — `analytics_events` table (RLS, zero client grants), `bump_analytics_event` invoker function granted to `service_role` only |
| `0019_bars_catalog.sql` | schema+policy — `bars` table, public read policy, full service_role grant |
| `0020_provenance_and_media.sql` | schema+policy — `photo_permissions`/`bar_photos`/`bar_change_queue` tables+RLS+policies, `pending_change_count(uuid)` definer RPC (later superseded) |
| `0021_provenance_hardening.sql` | policy — hardens `pending_change_count` to zero-arg (fixes an any-user-can-query-any-user bug), adds `bars_google_hours_never_trusted` CHECK |
| `0022_hours_trust_constraint_fix.sql` | schema — closes a NULL-value hole in the 0021 CHECK constraint; no RLS/grant change |
| `0023_purge_google_reviews.sql` | data-fix — nulls `bars.reviews`; no security-object change |
| `0024_hours_source_osm.sql` | schema — widens `bars_hours_source_check` CHECK to allow `'osm'`; no RLS/grant change |
| `0025_hours_sweep_support.sql` | schema — adds an index; no security content |
| `0026_clear_misresolved_place_ids.sql` | data-fix — clears mis-resolved `place_id`/hours data on 2 rows; no security-object change |
| `0027_merge_duplicate_venues.sql` | data-fix+schema — deletes 9 duplicate `bars` rows, adds a unique index on `place_id`; no RLS/grant change |
| `0028_resolve_flemings_and_slaughtered_lamb.sql` | data-fix — resolves a shared `place_id`, corrects coordinates, recreates the unique index without its carve-out; no RLS/grant change |
| `0029_correct_coordinates_from_osm.sql` | data-fix — corrects 34 venue coordinates/addresses from OSM; no security-object change |
| `0030_resource_coordinates_from_osm.sql` | data-fix — re-sources 258 venue coordinates from OSM for provenance; no security-object change |
| `0031_diamond_dogs_rocka_rolla_osm.sql` | data-fix — adopts OSM coordinates for 2 held-back venues; no security-object change |
| `0032_geocode_remaining_from_osm.sql` | data-fix — re-sources 124 venue coordinates from OSM address geocodes; no security-object change |
| `0033_vibe_profiles.sql` | schema+policy — `vibe_profiles` table+RLS+owner policies+revoke-first grants, LWW trigger (invoker, pins `search_path=''`) — **self-declared unapplied** |
| `0034_revoke_first_grants.sql` | policy — revoke-first hardening on `profiles`/`ratings`/`pairwise_comparisons`, reopens `shares_list_publicly` column grant (C3 F3/F5 fix) — **self-declared unapplied** (per 0035's header) |
| `0035_share_night_date_bound.sql` | policy — replaces `share_night` body to add the ±2-day date bound (C4 F1 fix) — **explicitly self-declared unapplied** |
| `0036_protect_schema_migrations.sql` | policy — enables RLS + revokes all client access on `public.schema_migrations`; apply state not self-declared in file text |

**37 of 37 files read in full, in numeric order.** No file was skipped, truncated, or read only in part.

---

## 6. Could not be determined statically — requires live verification

1. **Whether `0033`, `0034`, `0035`, and `0036` are actually applied to the
   live database.** `0035`'s own header states the ledger ended at `0032` as
   of its authoring. **Narrowed at review (Codex): this item is now
   PRODUCTION-ONLY.** Staging is settled — the g-44d15c24 read-only check
   (2026-08-02) showed the staging ledger at 37 ending in `0036`, with the
   browser privileges revoked, and the operator recorded attended
   acceptance. Production's ledger has NOT been read (different project
   ref; its service-role key is recorded invalid in MASTER-TODO B1): if
   production is unapplied past `0032`, it still carries the C3 F3/F5 and
   C4 F1 gaps, and its `public.schema_migrations` may still be readable/
   writable to browser roles per `0036`'s stated motivation.
2. **Ownership of every SECURITY DEFINER function**, which determines whose
   privileges each one actually runs with. No file contains an `ALTER
   FUNCTION ... OWNER TO`; ownership is whatever role executed the
   `CREATE FUNCTION`, and that is not recorded in source.
3. **Whether any policy, grant, or RLS flag was changed by hand outside
   these migrations** (e.g. via the Supabase dashboard) — invisible to a
   file-based audit by construction. C3 §6 raises the identical caveat for
   its own narrower scope; it applies unchanged here.
4. **Postgres major version** — decides whether the `public`-schema
   `CREATE`-by-`PUBLIC` default (relevant to C3 F1's `search_path=public`
   vs `''` distinction) is actually in force on the target instance.
5. **Whether the `service_role` grants implied by omission (e.g.
   `photo_permissions`, and `profiles` after `0034`) match what Supabase's
   actual default privileges currently grant that role** — this packet
   only replays explicit `REVOKE`/`GRANT` statements found in the 37 files;
   it cannot see Supabase's platform-level defaults for `service_role`.
6. **Live `pg_policies` / `information_schema.role_table_grants` contents**,
   the only source of truth for what is actually enforced right now, as
   opposed to what 37 files of committed intent describe.

No guess is offered in place of any of the six items above.
