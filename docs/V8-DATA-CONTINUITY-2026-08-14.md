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

| Exact key | Storage | Current purpose and owner | V8 continuity rule |
| --- | --- | --- | --- |
| `next-bar:age-ack:v1` | local | Device-only age acknowledgement | Preserve; never sync. |
| `next-bar:install-nudge-dismissed:v1` | local | Device-only install prompt state | Preserve; never sync. |
| `next-bar:handle-nudge-dismissed:v1` | local | Device-only account prompt state | Preserve; never sync. |
| `next-bar:onboarding-prompted:v1` | session | Per-tab onboarding prompt state | Preserve name; expiry with the tab is intentional. |
| `next-bar:night-phase-override:v1` | local | Development/demo phase override | Preserve; never sync or ship as account data. |
| `next-bar:demo:seeded:v1` | local | Demo-rating seed marker | Preserve; never merge into a signed-in account. |
| `next-bar:demo:seeded-ids:v1` | local | IDs written by the demo seed | Preserve; never merge into a signed-in account. |
| `next-bar:follows:v1` | local | Signed-out demo follows | Signed-in owner is existing `follows`; server replaces demo state and demo rows never merge. |
| `next-bar:ratings:v1` | local | Rating tier, numeric score, and `ratedAt` cache | Signed-in owner is existing `ratings`; retain as the V7 cache/write-through shape. |
| `next-bar:ratings:merged-for:v1` | local | Account ownership/one-time merge latch | Preserve exact user ID; set only after a successful merge. |
| `next-bar:pairwise:v1` | local | Append-only comparison transcript | Signed-in owner is existing `pairwise_comparisons`; retain as the V7 cache shape. |
| `next-bar:pairwise:merged-for:v1` | local | Account ownership/one-time merge latch | Preserve exact user ID; set only after a successful merge. |
| `next-bar:lists:v1` | local | Named lists and ordered bar IDs | Remains readable in V8; planned server owner is `account_content_state` key `lists`. |
| `next-bar:profile:v1` | local | Vibe profile plus `savedAt` | Remains readable in V8; planned server owner is owner-only `vibe_profiles`. |
| `next-bar:night-log:v1` | local | Current/most-recent night visits | Remains readable in V8; V8 Night Out persistence must import it into the canonical night owner. |
| `next-bar:intent:v1` | local | Expiring tonight intent | Preserve through the current night; V8 Night membership/status becomes server-owned. |
| `next-bar:night-vibe:v1` | local | Expiring per-night vibe selection | Preserve through the current night; server sync is not required. |
| `next-bar:list:want-to-go:v1` | local | Want-to-Go entries | Preserve; fold into the named-list server owner without renaming this V7 source key. |
| `next-bar:saved:v1` | local | Legacy saved-bar store; currently has no runtime caller | Preserve unread data; migrate deliberately if retired, never silently delete it. |

## Server ownership and conflict rules

| Account object | One server owner | Initial V7 import | Later conflicts |
| --- | --- | --- | --- |
| Authentication | Supabase Auth | Existing refresh/session state remains untouched. | Supabase token refresh and revocation are authoritative. |
| Ratings and numeric scores | Existing `ratings`, one row per user/bar | Current merge inserts only bars absent on the server; the server row wins a same-bar collision. | Existing strict `updated_at` LWW trigger; equal timestamps keep the stored row. Score is part of that row, and equal scores on different bars remain valid ties. |
| Pairwise ranking transcript | Existing `pairwise_comparisons` | Union by exact `(winner, loser, comparedAt)` tuple. | Append-only; replay by `compared_at`, then row ID. Never replace the transcript with derived scores. |
| Named lists and Want to Go | Planned owner-only `account_content_state`, domain `lists` | Union unrelated list IDs. For the same ID, newer `updatedAt` wins; an exact tie keeps the server value. | Per-list LWW. Deletes require timestamped tombstones so an offline device cannot resurrect a deleted list. |
| Vibe profile | Planned owner-only `vibe_profiles` | Compare local `savedAt` with server `saved_at`; newer wins and an exact tie keeps the server value. | Strict LWW. A clear must delete the server row successfully before clearing the local cache. Invalid or failed server reads never overwrite valid local data. |
| Night history | Canonical V8 Night Out tables introduced by the Night Out goal | Import the valid `next-bar:night-log:v1` night once. Merge distinct visits by stable timestamp and bar ID; retain all server-only nights. | Server owns membership and lifecycle. Visit/event inserts are idempotent; status changes use server timestamps. |
| Shared nights | Existing `shared_nights` | No browser-storage import: the server row and bearer token already are the durable state. | Server row wins. Row presence is explicit sharing consent; unshare deletes it and invalidates the token. |
| Notification devices | Planned native-device table from the notifications goal; existing `push_subscriptions` remains web-only and dark | Register only after authenticated native permission succeeds. | Device token is unique. Latest authenticated registration transfers that token to the current user; sign-out/revoke deletes it. Never merge credentials through localStorage. |

## Verification boundary

`e2e/v7-continuity.spec.ts` is the offline install-over guard for exact V7
keys, Bar 54, tied numeric scores, named lists, vibe profile, night history,
navigation, and reload. Authentication, existing `shared_nights`, cross-device
sync, notification registration, force-close, and the physical install-over
remain attended/server-backed release gates; an offline fixture cannot prove
them.
