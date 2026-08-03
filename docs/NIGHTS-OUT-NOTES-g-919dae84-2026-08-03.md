# Nights Out (g-919dae84) — implementation notes, parks, and attended decisions

Written 2026-08-03 during the attended continuation session. Local commits
only; staging deploy needs operator approval per the standing rule.

## Shipped in this slice

- **Night archive** (`src/lib/nightArchive.ts`): the night log's rollover
  used to DISCARD the displaced night; it now archives it (device-local,
  `next-bar:night-archive:v1`, capped 60 nights) WITH a ratings snapshot
  taken at rollover, so a later re-rating can't rewrite an archived
  night's loved pick or badges. The LIVE night joins live ratings.
- **/nights history surface** (crit 4): newest-first list of every captured
  night; expand → route, RecapCard-style BarMap (crit 5), share controls.
  Reachable from Friends ("Nights Out — your past nights →", crit 3) and
  the recap card ("All your nights →").
- **Durable next-day sharing** (crit 7): `share_night`'s returned token is
  now recorded device-side (`src/lib/sharedNightsLocal.ts`,
  `next-bar:shared-nights:v1`, registered in accountCache's wipe set), so
  /nights shows "Shared", re-opens the same link, and offers
  "Stop sharing" (`unshare_night`) — no schema/RPC changes (crit 8
  untouched: the uuid token remains the only anon capability).
- **Panel-driven hardening** (bf5d7f4f review round): archived nights
  snapshot their ratings at rollover (a later re-rating can't silently
  rewrite an old night's "loved"); the night ARCHIVE joined the
  account-switch wipe set (DeepSeek Medium + Claude convergent — 60 nights
  of whereabouts is browser-history-grade on a shared device; same trade
  the vibe profile made); /nights populates post-mount (hydration rule);
  a still-shared night whose bars left the catalog keeps a manageable row
  so it can always be unshared; share/unshare writes are epoch-guarded
  against sign-out races.
- **Map on the anonymous shared-night page** (crit 5): route bars only —
  no viewer location, no personal pins/photos (crit 9 honored by
  construction).
- Reuse throughout (crit 6): composeRecap, BarMap, ShareNightButton,
  existing RPCs. No group chat anywhere (crit 10).

## Parked with evidence

- **Close Friends audience model (crit 2): PARKED.** A real audience tier
  needs server enforcement — schema (a tier column or table on follows),
  RLS/RPC changes to `get_circle_suggestions`/`get_circle_vibe_votes`, and
  a NEW migration. Migration state per STAGING-ACCEPTANCE-NOTES-2026-08-01:
  staging is applied through 0036; production state is recorded as unknown;
  0037 is attended-only and the 0038 night-photos draft was never applied —
  the operator's standing rule is that neither runs without them. New DB
  changes are attended-run decisions. A localStorage-only "close friends"
  flag would be a FAKE audience model — it can't restrict what the server
  returns to other members — and shipping the label without the boundary
  is exactly the dishonesty the honesty passes remove. Needs: an attended
  session that authors + applies the next-numbered migration with its own
  T0 review.
- **shared_nights write-amplification bound**: 0035's ±2-day window on
  `share_night` (in the applied-through-0036 staging set) bounds the write
  path; /nights adds no write volume (sharing is still one explicit tap
  per night).

## Santa round-1 adjudications (evidence-countered findings, recorded)

Three Codex round-1 findings were answered with repository evidence
rather than code changes:

- **"Successful share can leave no durable record" (epoch skip / quota
  write failure)**: the epoch-skip is the CORRECT privacy behavior — a
  share resolving after a sign-out wipe belongs to the previous account
  and must not be written into the next account's store; the resulting
  orphaned-share management gap is precisely the documented
  `list_my_shared_nights` requirement above. A quota-failed local write
  self-heals on the next re-share (same token, `share_night` keeps it).
- **"Ratings snapshot only at displacement, not at the night boundary"**:
  deliberate — the morning-after recap window is exactly when users rate
  last night's bars, and a boundary-time snapshot would freeze the night
  BEFORE those ratings. Displacement (next night's first visit) is the
  earliest moment the night is genuinely finished.
- **"Rollover is non-atomic under quota failure"**: matches the log's
  own long-standing quota stance (writes degrade to "thinner record",
  never throw); refusing tonight's first visit to protect yesterday's
  archive would trade a live failure for a historical one.

Additionally fixed from round 1: settings sign-out copy made precise
(the wipe covers past nights + share records, NOT tonight's live log or
Want-to-go — widening the wipe is an operator decision), wipe-set
regression tests for the two new keys, and per-night unshare busy state.

## Attended decisions for the operator (crit 11)

1. **Per-night thread vs persistent group chat**: recorded as REQUIRED
   DECISION, not implemented (crit 10 forbids group chat in this slice).
   If night coordination ever gets messaging, the recommendation is a
   per-night ephemeral thread attached to the consensus board, never a
   persistent chat surface — but this is the operator's product call.
2. **Server-side nights listing RPC — now REQUIRED, not optional**
   (verifier finding, 5679857e round): because the archive + share tokens
   join the account-switch wipe (privacy trade), a user who shares a
   night, signs out, and signs back in has a LIVE share the device no
   longer indexes — unmanageable until a `list_my_shared_nights` RPC
   (owner-only, auth.uid()-scoped) exists. Small migration; widens the
   reviewed anti-enumeration surface, so it rides the same attended
   migration session as Close Friends. Until then, sign-out costs the
   device's share index — accepted over leaking whereabouts on shared
   devices, and the settings copy says so.
