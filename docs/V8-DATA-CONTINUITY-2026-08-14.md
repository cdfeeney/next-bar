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
| `next-bar:account:owner:v1` | local | V8 addition: which account this device cache belongs to | **Local-only, never synced** — a device-side marker holding a server user ID. Written on every successful signed-in hydrate; wiped with the rest of the account cache on sign-out or a foreign-account signal. Not a V7 key. |
| `next-bar:saved:v1` | local | Legacy saved-bar store; `src/lib/saved.ts` still reads it, no UI calls it | **Local-only, never synced.** Preserve unread data; if it is ever retired, migrate it into the named-list owner deliberately — never silently delete it. |

## Server ownership and conflict rules

| Account object | One server owner | Initial V7 import | Later conflicts |
| --- | --- | --- | --- |
| Authentication | Supabase Auth | Existing refresh/session state remains untouched. | Supabase token refresh and revocation are authoritative. |
| Ratings and numeric scores | Existing `ratings`, one row per user/bar | Upload (`mergeLocalRatingsToServer`) inserts only bars absent on the server: the server row wins a same-bar collision. Hydrate (`mergeFreshest` in `useRatings`) then takes the newer `ratedAt` of the two, so a local row newer than the server's wins **in local state and cache** even though the upload skipped it — see the divergence note below. | Existing strict `updated_at` LWW trigger; equal timestamps keep the stored row. Score is part of that row, and equal scores on different bars remain valid ties. |
| Pairwise ranking transcript | Existing `pairwise_comparisons` | Union by exact `(winner, loser, comparedAt)` tuple — deduped against the server set **and** within the local list. | Append-only; replay by `compared_at`, then row ID. Hydrate unions server with local (`unionTranscripts`) and never replaces, so a failed upload cannot destroy un-uploaded rows. Never replace the transcript with derived scores. |
| Named lists and Want to Go | Planned owner-only `account_content_state`, domain `lists` | Union unrelated list IDs. For the same ID, newer `updatedAt` wins; an exact tie keeps the server value. | Per-list LWW. Deletes require timestamped tombstones so an offline device cannot resurrect a deleted list. |
| Vibe profile | Planned owner-only `vibe_profiles` | Compare local `savedAt` with server `saved_at`; newer wins and an exact tie keeps the server value. | Strict LWW. A clear must delete the server row successfully before clearing the local cache. Invalid or failed server reads never overwrite valid local data. |
| Night history | Canonical V8 Night Out tables introduced by the Night Out goal | Import the valid `next-bar:night-log:v1` night once. Merge distinct visits by stable timestamp and bar ID; retain all server-only nights. | Server owns membership and lifecycle. Visit/event inserts are idempotent; status changes use server timestamps. |
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
ownership and is written on every successful hydrate; a `:merged-for:` key
means only that the import completed, so a failed import retries on the next
sign-in. The guards read the owner key **and** the legacy latches, so a device
upgrading from V7/early-V8 keeps its cross-account protection.

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

**Still true, and intended:** hydrate keeps the *freshest* rating per bar, so a
local row newer than the server's wins in local state and cache even though the
upload step skipped that bar (server-wins on insert). Ratings written after
sign-in upsert normally.

## Verification boundary

What is mechanically proven, and by what:

| Claim | Proof |
| --- | --- |
| Every storage key has exactly one owner row; no V7 key renamed or dropped | `src/lib/storageInventory.test.ts` |
| Ratings merge rule (server-wins union, never latch on failure) | `src/lib/ratings.server.test.ts` |
| Pairwise merge rule (union by exact tuple, append-only, re-answers survive) | `src/lib/pairwise.server.test.ts` |
| Ties stay exactly tied through local→server→local, including ranking and reconcile | `src/lib/tiePreservation.test.ts` |
| Cross-account cache ownership and residue wipe | `src/lib/accountCache.test.ts` |
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
