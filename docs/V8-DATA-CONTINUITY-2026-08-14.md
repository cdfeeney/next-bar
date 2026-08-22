# V8 data continuity contract

Status: implementation contract for `release/v8`. This document inventories
the V7 browser stores and fixes the server owner and conflict rule for every
account object named by the V8 PRD. It does not authorize a migration or claim
that the planned V8 tables have been applied.

## Non-negotiable upgrade rules

- Keep every V7 key and payload meaning below until a tested forward migration
  ships. Never clear all origin storage during an upgrade.
- Supabase Auth owns its generated `sb-<project-ref>-auth-token` storage. App
  code must not rename, enumerate, copy, or delete it except through Supabase
  sign-out.
- Catalog/content promotion is separate from private account data. No catalog
  operation may reseed, truncate, or replace an account-owned table.
- A failed server read or write never means “empty.” Keep the last validated
  local value and retry; do not latch a merge as complete after failure.
- Before any currently local-only domain becomes account-synced, it must join
  the cross-account ownership/wipe guard in `src/lib/accountCache.ts`.

## V7 browser-storage inventory

This table is enforced, not advisory. `src/lib/storageInventory.test.ts` fails
the build when a `next-bar:` storage key appears in `src/` with no row here,
when a row names a key no longer present in `src/` (the mechanical proof that
no V7 key was renamed away), and when any frozen V7 key loses its read path.

Two `next-bar:`-prefixed strings are deliberately absent below because they are
`window` CustomEvent names carrying no data at rest —
`next-bar:ratings:server-update` and `next-bar:pairwise:local-update`. The guard
classifies them explicitly; adding a third broadcast is a deliberate edit there.

| Exact key | Storage | Current purpose and owner | V8 continuity rule |
| --- | --- | --- | --- |
| `next-bar:age-ack:v1` | local | Device-only age acknowledgement | Preserve; never sync. |
| `next-bar:install-nudge-dismissed:v1` | local | Device-only install prompt state | Preserve; never sync. |
| `next-bar:handle-nudge-dismissed:v1` | local | Device-only account prompt state | Preserve; never sync. |
| `next-bar:onboarding-prompted:v1` | session | Per-tab onboarding prompt state | **Local-only, never synced.** Preserve the name; expiry with the tab is intentional. |
| `next-bar:night-phase-override:v1` | local | Development/demo phase override | Preserve; never sync or ship as account data. |
| `next-bar:demo:seeded:v1` | local | Demo-rating seed marker | Preserve; never merge into a signed-in account. |
| `next-bar:demo:seeded-ids:v1` | local | IDs written by the demo seed | Preserve; never merge into a signed-in account. |
| `next-bar:follows:v1` | local | Signed-out demo follows | Signed-in owner is existing `follows`; server replaces demo state and demo rows never merge. |
| `next-bar:follows:dirty` | local-only, never synced | Cross-tab "the circle moved" ping | Carries no data — only the write is meaningful. One tab settling a follow/unfollow stamps it so other tabs re-hydrate before reporting the circle ready, instead of deriving an invite list from a snapshot taken before that write. Safe to drop at any time; the worst case is a stale circle in a background tab. |
| `next-bar:ratings:v1` | local | Rating tier, numeric score, and `ratedAt` cache | Signed-in owner is existing `ratings`; retain as the V7 cache/write-through shape. |
| `next-bar:ratings:merged-for:v1` | local | Account ownership/one-time merge latch | **Local-only, never synced** — it is a device-side latch naming a server user ID, not account data. Preserve the exact ID. See the ownership/retry caveat below. |
| `next-bar:pairwise:v1` | local | Append-only comparison transcript | Signed-in owner is existing `pairwise_comparisons`; retain as the V7 cache shape. |
| `next-bar:pairwise:merged-for:v1` | local | Account ownership/one-time merge latch | **Local-only, never synced** — device-side latch naming a server user ID. Preserve the exact ID. See the ownership/retry caveat below. |
| `next-bar:lists:v1` | local | Named lists and ordered bar IDs | Remains readable in V8; planned server owner is `account_content_state` key `lists`. |
| `next-bar:profile:v1` | local | Vibe profile plus `savedAt` | Remains readable in V8; planned server owner is owner-only `vibe_profiles`. |
| `next-bar:night-log:v1` | local | Current/most-recent night visits | Remains readable in V8; V8 Night Out persistence must import it into the canonical night owner. |
| `next-bar:intent:v1` | local | Expiring tonight intent | Preserve through the current night; V8 Night membership/status becomes server-owned. |
| `next-bar:night-vibe:v1` | local | Expiring per-night vibe selection | Preserve through the current night; server sync is not required. |
| `next-bar:list:want-to-go:v1` | local | Want-to-Go entries | Preserve; fold into the named-list server owner without renaming this V7 source key. |
| `next-bar:account:owner:v1` | local | V8 addition: which account this device cache belongs to | **Local-only, never synced** — a device-side marker holding a server user ID. Written on every successful signed-in hydrate and on every server-mode write-through, before the data it describes. **Survives sign-out and the residual clear** (the seal, V8-2 round-3): it is what lets a later foreign sign-in wipe the personal keys. Removed only by a foreign-account wipe, which installs the new owner's session in its place. Not a V7 key. |
| `next-bar:dirty:v1` | local | V8 addition: unacked-write journal (`Record<barId, {s: stamp, op: 'u'\|'d'}>`) | **Local-only, never synced** — device-side sync bookkeeping, not account data. Written (last-writer-wins per bar) before every local rating write with that write's own stamp; an ack clears the entry only on an exact stamp match, so an older in-flight ack can never strip a newer write's protection (round-4). `op:'d'` entries are created only by signed-in deletes — anonymous clears withdraw intent instead, so they can never replay against an account's server data. Non-empty blocks the ratings surface of the sign-out/residual wipe, and sign-in retries exactly these rows (`'u'` as an LWW upsert with the row's own ratedAt; `'d'` as a stamp-guarded delete). Wiped with the account cache on a foreign sign-in. Not a V7 key. |
| `next-bar:saved:v1` | local | Legacy saved-bar store; `src/lib/saved.ts` still reads it, no UI calls it | **Local-only, never synced.** Preserve unread data; if it is ever retired, migrate it into the named-list owner deliberately — never silently delete it. |
| `next-bar:pending-invite:v1` | **session + local (30-min TTL)** | V8-3 addition: Night Out invite token riding the sign-in handoff | **Local-only, never synced** — a share_token uuid, stored by the /night-out page before /auth and consumed exactly once after sign-in. **Written to BOTH stores.** sessionStorage carries the same-tab case; localStorage carries a 30-minute TTL copy because the common path for a brand-new account is an email-confirmation link that opens a NEW TAB, which cannot see the original tab's sessionStorage. **Scope, stated precisely:** Web Storage is per-origin *within one browser profile*, so the localStorage copy recovers the new-tab case ONLY — a different browser, or a mail webview with partitioned storage, is not recoverable this way and that half of the flow is still open. **This row said "session only, must not leak across tabs" after that stopped being true;** it is corrected here because a wipe or sweep written from this table would otherwise miss a BEARER token sitting in localStorage for up to 30 minutes. The TTL is what keeps the original intent honest — the context must not become durable state, it just has to outlive a tab. `consumePendingInvite` clears both. Not a V7 key. |
| `next-bar:started-night-out:v1` | local | V8-3b: Night Outs CREATED but never opened, **keyed by account** | **Local-only, never synced.** Value is a MAP, `{ [userId]: { planId, nightKey } }` — not a bare uuid. Written by StartNightOutButton immediately after create_night_out succeeds; a user's own entry is cleared the moment they open that plan, or when its night has rolled over. It exists because component state died on unmount, re-arming Start and letting the next tap create a SECOND plan for the same night. The map (rather than one slot) is because a tab can see more than one account in a session, and the earlier single-slot versions let each account inherit, destroy or overwrite another's record. Per-user *keys* were not an option — the interpolation gate below forbids computed key names, precisely so entries stay visible to this registry. **This row previously said "a night_outs uuid" and "Holds no account data" (round 2, both lanes): both were false once the value became a map keyed by SERVER USER IDs.** It holds account identifiers and must be treated as account data by any wipe or sweep written from this table. **Store changed session -> local (cold panel round 2, Codex).** sessionStorage was chosen so the record would not outlive the session, but it dies with the TAB, and a create whose follow-up read failed was then forgotten on tab close - the next Start made a SECOND plan for the same night, which is the exact defect criterion 4 exists to prevent. The two properties that made session scope feel safe are now in the VALUE: the map is keyed by user id, and every record carries its night key. Records for a past night are pruned on every write, so the entry lives exactly as long as it is still true. Not a V7 key. |
| `next-bar:journal-era:v1` | local | V8 addition: one-time journal-era reconciliation marker (user id) | **Local-only, never synced** — a device-level continuity record, like the age-ack, deliberately OUTSIDE the account-cache wipe sets. A v0.5-era build latched `merged-for` on hydrate rather than upload completion, so an upgrading device can hold a matching latch beside rows the old build stranded with no journal entries; until this marker names the signed-in user, one extra insert-only server-wins merge runs to pick those rows up. Not a V7 key. |
| `next-bar:stories:v1` | local | V8-1f addition: YOUR story items for the next 24 hours (photo data URLs, chosen bar, tag list, action-time audience) | **Local-only, never synced.** There is no photo-memory table yet, so a story is a device object that expires by age on read (24h) rather than by eviction. When a server owner arrives it takes this shape over unchanged. Wiped by `guardAgainstForeignCache` on a FOREIGN sign-in (it is in `FOREIGN_ONLY_KEYS`, not `ALL_KEYS`), so it survives the device owner's own sign-out but never reaches a second account. Not a V7 key. |
| `next-bar:stories-seen:v1` | local | V8-1f addition: ids of story items already watched — the unseen RING's only source | **Local-only, never synced** — a device-side view marker, like the age-ack. Capped ring buffer; losing it re-rings a story you have seen, which is the harmless failure. Never merged into an account, and wiped on a foreign sign-in with the other story keys. Not a V7 key. |
| `next-bar:story-replies:v1` | local | V8-1f addition: replies you typed on a story or a Feed memory | **Local-only, never synced.** Written so the reply control is not a no-op while the messages owner does not exist; when one ships it takes these rows over and this key is retired deliberately, never silently dropped. Wiped on a foreign sign-in — typed replies are the device owner's words. Not a V7 key. |
| `next-bar:stories-untagged:v1` | local | V8-1f addition: ids of stories you have taken your own tag off | **Local-only, never synced.** A consent record, and the reason it is written down rather than held in component state: an untag that survives only until the next reload is a control that looked like it worked. It suppresses your tag on the READ side only — the seeded story it applies to is not yours to edit — so when a photo-memory owner ships, this becomes a request against that owner and the key is retired deliberately, never silently dropped. Wiped on a foreign sign-in: a consent record belongs to the account that gave it. Capped ring buffer. Not a V7 key. |

## Server ownership and conflict rules

| Account object | One server owner | Initial V7 import | Later conflicts |
| --- | --- | --- | --- |
| Authentication | Supabase Auth | Existing refresh/session state remains untouched. | Supabase token refresh and revocation are authoritative. |
| Ratings and numeric scores | Existing `ratings`, one row per user/bar | Upload (`mergeLocalRatingsToServer`) inserts only bars absent on the server: the server row wins a same-bar collision. Hydrate (`mergeFreshest` in `useRatings`) then takes the newer `ratedAt` of the two, so a local row newer than the server's wins **in local state and cache** even though the upload skipped it — see the divergence note below. | Existing strict `updated_at` LWW trigger; equal timestamps keep the stored row. Score is part of that row, and equal scores on different bars remain valid ties. |
| Pairwise ranking transcript | Existing `pairwise_comparisons` | Union by exact `(winner, loser, comparedAt)` tuple — deduped against the server set **and** within the local list. | Append-only; replay by `compared_at`, then row ID. Hydrate unions server with local (`unionTranscripts`) and never replaces, so a failed upload cannot destroy un-uploaded rows. Never replace the transcript with derived scores. **Deletion is not a merge outcome:** the union deliberately has no way to observe a server-side removal, so Settings → "Clear ALL bar ratings" (the only deletion path) clears server rows *and* the local transcript on the device that runs it, and a second signed-in device keeps its own copy until it runs the same control. A cross-device propagating delete needs timestamped tombstones and is out of scope here. |
| Named lists and Want to Go | Planned owner-only `account_content_state`, domain `lists` | Union unrelated list IDs. For the same ID, newer `updatedAt` wins; an exact tie keeps the server value. | Per-list LWW. Deletes require timestamped tombstones so an offline device cannot resurrect a deleted list. |
| Vibe profile | Planned owner-only `vibe_profiles` | Compare local `savedAt` with server `saved_at`; newer wins and an exact tie keeps the server value. | Strict LWW. A clear must delete the server row successfully before clearing the local cache. Invalid or failed server reads never overwrite valid local data. |
| Night history | Canonical V8 Night Out tables introduced by the Night Out goal | Import the valid `next-bar:night-log:v1` night once. Merge distinct visits by stable timestamp and bar ID; retain all server-only nights. | Server owns membership and lifecycle. Visit/event inserts are idempotent; status changes use server timestamps. |
| Follows | Existing `follows` (RPC-backed) | **No import, by design:** signed-out follows are demo-circle seed data, never real profiles, so nothing local merges into an account. On sign-in the server set replaces demo state. | Server authoritative. The local key is wiped by the foreign-sign-in guard (it is in `ALL_KEYS`) and reseeded by the demo layer signed-out. |
| Shared nights | Existing `shared_nights` | No browser-storage import: the server row and bearer token already are the durable state. | Server row wins. Row presence is explicit sharing consent; unshare deletes it and invalidates the token. |
| Notification devices | Planned native-device table from the notifications goal; existing `push_subscriptions` remains web-only and dark | Register only after authenticated native permission succeeds. | Device token is unique. Latest authenticated registration transfers that token to the current user; sign-out/revoke deletes it. Never merge credentials through localStorage. |

## Import-retry and ownership (fixed during the V8-2 review)

The V8-2 panel found one defect wearing three faces, all on the sign-in import
path. Recorded here because this document is the contract of record for how
account data reaches the server.

**The latch meant two things at once.** `next-bar:ratings:merged-for:v1` (and
its pairwise twin) meant both "this cache belongs to user X" — read by the
foreign/residual cache guards — and "X's one-time import finished". The hooks
deliberately latched it after *any* successful hydrate so the cache was never
ownerless, which also marked the import done. A single transient import
failure was therefore never retried, and the loss was not hypothetical: when
the session later expired, `useAuth` calls `clearResidualAccountCache`, which
wipes the account cache *because* the latch is present — deleting rows that
had never reached the server.

Fixed by splitting the meanings. `next-bar:account:owner:v1` now carries
ownership and is written on every successful hydrate **and** on every
server-mode write-through (before the data it describes, so failing storage
leaves a stale owner rather than ownerless account data); a `:merged-for:` key
means only that the import completed, so a failed import retries on the next
sign-in.

**Which guard reads which signal — they are not the same, and the difference is
deliberate:**

| Guard | Reads | Why |
| --- | --- | --- |
| `guardAgainstForeignCache(currentUserId)` — a user signs IN | owner key **and** both legacy `:merged-for:` latches | A current account id makes ownership unambiguous, so a device upgrading from V7/early-V8 keeps full cross-account protection. Wipes account data AND the personal `FOREIGN_ONLY_KEYS`, owner included — the new session installs its own. |
| `clearResidualAccountCache()` — resolved signed-out | owner key **only**, then the pending check (latch mismatch OR non-empty dirty journal) | A legacy latch is an import sentinel, not proof the cache is disposable. Treating it as ownership erased V7 data during an install-over before the user signed back in. Clears `DATA_KEYS` only — the owner marker survives so a later foreign sign-in still fires. |
| `sealAccountCacheOnSignOut()` — explicit sign-out | same as the residual clear, plus an unconditional epoch bump | The sign-out button and a session expiry must have identical data semantics; only the epoch bump (abandoning in-flight hydrates) is unconditional. |
| `destroyAccountDataOnDeletion()` — account deletion | nothing; unconditional | Hard-destroys the account cache, owner marker, AND the personal `FOREIGN_ONLY_KEYS` (round-4): the deleted owner can never return, and leaving the personal keys with no ownership signal handed them to the next account. |

Both clears are **per surface** (round-4): ratings clear only when latched with an empty journal;
pairwise clears only when latched; follows always clear (server-authoritative demo state). One
pending ratings row no longer keeps the whole otherwise-synced cache visible signed-out. A write
whose ack lands AFTER the seal triggers the residual clear from its own ack callback, so just-synced
data does not linger until the next launch. Same-bar server writes are serialized client-side (a
per-bar promise chain in `useRatings`), so a rate followed by a fast clear can no longer arrive at
the server out of order and resurrect the cleared row; migration `0020_pairwise_tuple_unique.sql`
(schema-additive with an exact-duplicate dedup, idempotent, awaiting attended apply) makes the
concurrent pairwise import database-idempotent.

**Account switches reload the tab (cycle-2 panel).** A wipe by
`guardAgainstForeignCache` hard-reloads the wiping tab, and `useAuth` keeps a
tab-lifetime memory of the last signed-in account so a background tab
receiving a cross-tab account switch reloads too — storage alone cannot say
so, because the first tab's wipe consumes the residue signals. React state
holding the previous account's data never survives an account change.
`useAuth` also CLAIMS the owner marker on every signed-in transition, so
personal keys written by non-ratings surfaces are never ownerless.

**Accepted hydrate transient (cycle-2 panel, Codex):** an upsert created and
acked entirely inside a hydrate fetch's flight window is retained by the
`fetchStartedAt` freshness check; the symmetrical DELETE case can re-render
the cleared bar for one fetch cycle before the next hydrate heals it. No data
is lost or resurrected server-side — the delete already acked — and closing
the window entirely would require reconciling hydrate state against every
in-flight mutation, which this contract deliberately trades away.

Two consequences, both accepted and named rather than hidden:

- A device that upgrades carrying **only** the legacy latches (it signed in
  under an older build and its session has already expired) no longer has that
  data wiped on a signed-out resolution, so the previous account's ratings stay
  readable **locally** on that device until someone signs in. Nothing can reach
  another account: the sign-in guard still wipes on a foreign id. The first
  successful signed-in hydrate writes the owner key and the device converges to
  normal behaviour.
- `clearResidualAccountCache()` additionally **refuses to wipe over a pending
  import** — account data present whose matching `:merged-for:` latch is not
  the owner has never reached the server, so wiping it is permanent loss. The
  owner key is left in place in that case, so a foreign sign-in still wipes.
  (Found in the V8-2 round-1 panel by Codex and Claude independently: the
  hooks write the owner key after a successful *fetch* even when that session's
  *upload* failed, so an expiry still destroyed never-uploaded rows.)

**The one-time import is gated on the latch; everything after it is driven by
the dirty journal (V8-2 round-3).** Round-2's "re-merge everything on every
sign-in" fixed the stranded-row loss but created resurrection: a row deleted on
another device is absent from the server, so a blind insert-only re-merge
re-uploaded it forever. The two requirements are reconciled by
`next-bar:dirty:v1`, a per-bar unacked-write counter maintained by
`accountCache` (`markRatingDirty` before every local write in BOTH modes,
`ackRatingDirty` on the confirmed server ack — `upsertServerRating` /
`deleteServerRating` now return an explicit success boolean):

- **Latch mismatch** (first sign-in for this user, or a prior import failed):
  full insert-only `mergeLocalRatingsToServer`, latch on success, journal
  entries for the uploaded rows cleared in bulk. When there is nothing local
  to import the latch is written anyway — the import is vacuously complete,
  and leaving it unset made the pending check report a pending import forever
  for every account that first signed in on an empty device (round-2).
- **Latch matches:** ONLY journaled rows retry — a dirty id with a local row
  re-upserts carrying the row's own `ratedAt` (so a genuinely newer write from
  another device still wins LWW); a dirty id with no local row is an unacked
  DELETE and retries as one. Untouched rows never re-upload, so deletions made
  elsewhere stay deleted.
- **Hydrate is dirty-aware:** after the latch, only journaled local rows
  survive `mergeFreshest` over the server snapshot (a tap during the in-flight
  fetch marks dirty, preserving the old race protection), and a journaled
  delete suppresses its server row instead of resurrecting it in state.
- Rows rated while signed OUT on an owned device journal too, so they survive
  the residual wipe and upload on the owner's next sign-in.

**Sign-out seals; it never destroys (V8-2 round-3, all four lanes).**
`signOut()` calls `sealAccountCacheOnSignOut()`: synced account data is
cleared (same signed-out UX as before), anything pending — unimported payload
or non-empty journal — is kept, and the owner marker ALWAYS survives. The next
sign-in resolves the seal: the same account retries its pending rows; a
different account triggers the foreign wipe, which clears account data and the
personal keys. The old unconditional wipe both destroyed never-uploaded rows
and, by removing the owner marker, handed the personal `FOREIGN_ONLY_KEYS` to
the next account. One deliberate exception: **account deletion** hard-destroys
the cache (`clearAccountCache`, owner included) after signing out — that owner
can never return, so sealing for them would be a lie.

**The pairwise transcript import lives on the ratings sign-in path.** The
pairwise UI was deliberately unwired in the U2 batch (rank-on-rankings), which
orphaned `usePairwise`'s import — it never ran in production (round-3, Codex).
The one-time local→server transcript merge now runs from `useRatings`' auth
effect, latch-gated: the transcript is append-only with exact-tuple server
dedup and has no remaining production writer, so once-per-user cannot strand
data and re-running cannot resurrect any.

**A foreign sign-in clears more than the account cache.** `ALL_KEYS` covers the
ratings/pairwise/follows surface, and an ordinary sign-out clears only that:
the device owner's named lists, Want to Go, vibe profile, night log, night
vibe, tonight intent, saved bars and stories are their own data and must
survive signing out. On a **foreign** sign-in the owner signal already names a
different account, so the device has demonstrably changed hands and those keys
are wiped too — leaving the previous user's lists and night history on screen
would be a privacy leak, not continuity (V8-2 round-2, GLM).

**The pairwise transcript was destroyed outright.** A failed upload followed by
a successful fetch *replaced* local state and storage with the server
transcript. Fixed: hydrate unions via `unionTranscripts` and re-reads the cache
at union time, so a comparison answered while the fetch was in flight also
survives.

**Row identity ignored timestamp spelling.** `compared_at` is `timestamptz`, so
PostgREST returns `…+00:00` where the client wrote `…Z`. The tuple key compared
those as strings, so every already-synced row looked new: the union kept a
second copy of the whole transcript and a retry would re-upload it into an
append-only table. `comparisonKey` now compares the parsed instant.

**Still true, and intended:** before the import latches, hydrate keeps the
*freshest* rating per bar, so a local row newer than the server's wins in local
state and cache even though the upload step skipped that bar (server-wins on
insert). After the latch, that freshest-wins retention applies only to
journaled (unacked) rows — see the dirty-journal contract above. Ratings
written after sign-in upsert normally.

## Verification boundary

What is mechanically proven, and by what:

| Claim | Proof |
| --- | --- |
| Every storage key has exactly one owner row; no V7 key renamed or dropped | `src/lib/storageInventory.test.ts` |
| Ratings merge rule (server-wins union, never latch on failure) | `src/lib/ratings.server.test.ts` |
| Pairwise merge rule (union by exact tuple, append-only, re-answers survive) | `src/lib/pairwise.server.test.ts` |
| Ties stay exactly tied through local→server→local, including ranking and reconcile | `src/lib/tiePreservation.test.ts` |
| Cross-account cache ownership, residue wipe, sign-out seal, and the dirty journal | `src/lib/accountCache.test.ts` |
| Latch-gated import, dirty-row retry, and dirty-aware hydrate | `src/hooks/useRatings.test.ts` |
| Every V7 key survives navigation, reload, and force-close/reopen | `e2e/v7-continuity.spec.ts` |
| The public shared-night route writes no local key | `e2e/v7-continuity.spec.ts` |

Run the Playwright continuity spec against a production build
(`PLAYWRIGHT_RELEASE=1`). The Next dev server's cold-compile navigation race
(CLAUDE.md) is not a product defect but it does make the dev run flaky.

Still outside any offline fixture, and therefore attended or server-backed
release gates: authentication, real `shared_nights` rows and their rendering
(`e2e/night-page.spec.ts` needs a configured Supabase client), cross-device
sync, notification registration, and the physical V7→V8 install-over on a real
device.
