# PACKET — Native APNs integration — 2026-08-05 (goal g-9b97c22d)

Design packet only. **No native code, no dependency change, no push
enablement happens under this goal.** Everything requiring Apple access,
credentials, or a physical device is marked **ATTENDED**. Base:
`docs/TESTFLIGHT-ARCH-DECISION-g-39169b3b-2026-08-03.md` (architecture C is
the release shell; A is dogfood-only) — cross-referenced, not duplicated.

## Why APNs at all (the gap this closes)

The repo's push foundation is **Web Push** and ships dark: migration 0009
(`push_subscriptions`, RPC-only writes, one-owner-per-endpoint),
`src/lib/push.ts` (VAPID subscribe path, weekend-cadence opt-in prompt,
`isPushEnabled()` double gate: `NEXT_PUBLIC_PUSH_ENABLED` +
`NEXT_PUBLIC_VAPID_PUBLIC_KEY`), unit-covered by `push.test.ts`; preflight
asserts push is OFF (Gate 5). That design serves browsers and installed
PWAs. **Inside the Capacitor WKWebView shell, Web Push does not exist** —
`Notification`/`PushManager` are unavailable to an embedded webview, so the
TestFlight/App Store binary can never receive the weekly nudge without
native APNs. APNs is the shell's replacement channel, not a second parallel
feature.

## Plugin choice (justified against the existing shell)

**`@capacitor/push-notifications` (official Capacitor plugin).** Rationale:
- The shell is already Capacitor (`origin/main` `ebbcd55`, ADR §0); the
  official plugin is the first-party integration with no extra vendor.
- Third-party push platforms (OneSignal, Firebase FCM-for-iOS wrappers) add
  an external data processor for device tokens — against the repo's
  self-managed posture (analytics dark, no third-party processors) and
  pointless for one platform: APNs direct is fully sufficient for iOS-only.
- The plugin surfaces exactly the four events the lifecycle below needs:
  `registration`, `registrationError`, `pushNotificationReceived`,
  `pushNotificationActionPerformed`.

Rejected: raw native code in the shell (loses the JS bridge the web app
already owns); FCM (adds Google as processor for zero cross-platform gain
today — revisit if Android ships).

## Entitlement + capability changes (enumerated, NOT implemented)

All ATTENDED, all outside this repo:
1. Apple Developer: enable Push Notifications capability for the bundle id;
   create an **APNs Auth Key (p8)** — key id + team id; store the p8 in the
   operator's secret manager, NEVER in this repo or its env files.
2. Xcode project (cloud Mac CI per the ADR): `aps-environment` entitlement
   (`development` for TestFlight sandbox testing, `production` for release).
3. App target: register plugin, request authorization ONLY from the same
   weekend-cadence opt-in moment `push.ts` already defines — the native
   prompt must not fire on first open (mirror of `getPushOptInPrompt`).

## Token lifecycle

Storage proposal: a new `apns_tokens` table mirroring 0009's reviewed
pattern rather than overloading `push_subscriptions` (an APNs device token
is not a Web Push endpoint; conflating them breaks the endpoint-format
checks and the VAPID-specific columns):

```
apns_tokens   user_id → profiles ON DELETE CASCADE, token text,
              environment ('sandbox'|'production'), created_at, updated_at,
              PK (user_id, token),
              UNIQUE (token)  -- one owner per device token: same shared-
                              -- device cross-wiring 0009 solved; the save
                              -- RPC transfers ownership explicitly
```

- **Register:** on `registration` event after opt-in, definer RPC upserts
  the token bound to the calling user (RLS: no direct table writes — the
  0009 pattern verbatim). Per-user token cap in the RPC (proposal: 10
  devices) matching 0009's cap discipline.
- **Rotate:** iOS rotates tokens on restore/reinstall/OS conditions; the
  shell re-registers on every launch, and the upsert refreshes
  `updated_at`. Tokens with `updated_at` older than N days (proposal: 90)
  are pruned by the sender on 410 or by a maintenance pass — never trusted
  as alive.
- **Sign-out:** the shell deletes the CALLING DEVICE's token only (RPC by
  token, not by user) — one device signing out must not silence the user's
  other devices. This is the same device-vs-account boundary the
  cross-device session revocation work (g-a345b6fc) established.
- **Account deletion:** `ON DELETE CASCADE` from profiles — token rows die
  with the account, mirroring 0009; the deletion flow needs no new code.
- **Ownership-transfer posture, stated as accepted risk** (consult:
  DeepSeek): a caller who somehow possesses another device's token string
  could register it and capture its pushes. There is NO Apple primitive
  for an app to cryptographically prove token possession — the honest
  mitigations are: registration requires an authenticated session; token
  strings are treated as secrets (never logged client- or server-side);
  and iOS exposes a device's token only to that app instance and Apple.
  The transfer behavior itself is deliberate — it is 0009's reviewed
  shared-device correctness fix, carried over.
- **Environment is per-token, never per-user** (consult: DeepSeek): the
  sender routes each token to the APNs host its `environment` column
  names; a BadDeviceToken/environment-mismatch response corrects the
  column rather than deleting the row. `(token)` uniqueness already
  prevents one string carrying two environments simultaneously.

## Sender architecture (server-side; env NAMES only, no values)

- Sender runs server-side only (a Vercel serverless route or a small job) —
  the p8 private key never reaches a client bundle.
- Env names: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`,
  `APNS_BUNDLE_ID`, `APNS_ENV` (`sandbox`|`production`). Classified per the
  repo's env classification doc (g-a0fb864b): all five are server-secret
  class; none is NEXT_PUBLIC.
- Protocol: APNs HTTP/2 with token-based (JWT) auth — no certificates to
  rotate annually.
- Rate limits + hygiene: batch sends; exponential backoff on 429/`TooMany
  Requests`; **410/`Unregistered` deletes the token row** (the lifecycle's
  garbage collector); JWT reuse within Apple's validity window rather than
  per-request signing — **capped at ~20 minutes, and the compromise story
  is key revocation in the Apple Developer portal** (consult: DeepSeek —
  there is no per-batch JWT scoping in APNs; a leaked signing key's blast
  radius ends at portal revocation, so the p8 lives only in the secret
  manager and every JWT issuance is logged).
- **Retries are idempotent per (send-window, token)** (consult: DeepSeek):
  ambiguous outcomes (5xx, connection reset) must not re-notify tokens
  that already succeeded — the sender records per-token confirmation
  (keyed by its own generated `apns-id` header) and retries ONLY
  unconfirmed tokens. Without this, the weekly nudge duplicates on every
  transient error.
- **The cadence moment is a thundering herd by design — shard it**
  (consult: DeepSeek): the weekly send fans out to every opted-in token in
  one window. Token fetch is cursor-paginated (never one giant SELECT
  holding a connection), and users are hash-sharded across a 5–10 minute
  stagger so neither APNs nor the DB sees one synchronized spike.
- Event set + opt-in policy are OWNED by the Crews packet's notification
  section (weekly nudge today; crews events later) — this packet is the
  transport, not the policy. Both stay dark until the operator enables.

## Deep-link routing

Notification payload carries `{ route: "/nights/<key>" | "/friends/…" }`.
The shell's `pushNotificationActionPerformed` handler navigates the webview
to that route **through the same same-origin validation Phase B specifies
for `?next=`** (`g-c8b26779` item 4): relative path only, reject external/
malformed/privilege-sensitive destinations. **Deep links are additionally
read-only by contract** (consult: DeepSeek — a same-origin link to a
mutating flow would let a push payload trigger an action): the route
allowlist contains only view surfaces; no app route may perform a mutation
from query parameters alone (none does today — keep it that way), and any
confirm-style flow a deep link lands on still requires an in-app user
action. No payload may carry content beyond crew/event names per the Crews
packet's lock-screen policy.

## Manual test-push runbook (ATTENDED, sandbox)

1. ADR-C staging binary installed on a physical device (build 5 is
   unusable for this: wrong origin AND no push entitlement).
2. Opt in on-device on a weekend night (or with the cadence gate stubbed in
   a dev build); capture the sandbox device token from the registration
   event log.
3. From the operator's machine (p8 from the secret manager, never the
   repo): send one sandbox push via a one-off script; verify device
   receipt, lock-screen content policy, and that tapping deep-links to the
   right route.
4. Negative checks: push to a signed-out device's stale token → expect 410
   and row deletion; second account on same device → ownership transfer
   (the 0009 shared-device scenario, now for APNs).

## Physical-device matrix (ATTENDED)

| Check | Device states |
|---|---|
| Registration + token upsert | fresh install; reinstall (rotation); second device same account |
| Delivery | foreground (in-app handler), background, killed |
| Deep link | cold-start tap; warm tap |
| Ownership transfer | account B signs in on account A's device |
| Sign-out | this device silenced; other device still receives |
| Cadence gate | no native prompt outside the opt-in moment |

## Dependencies and non-goals

- Depends on: ADR-C build (per-binary env), Apple account work (ATTENDED),
  operator enablement decision. Nothing here turns push on.
- Non-goals: Android/FCM, third-party push platforms, marketing/broadcast
  tooling, any change to the Web Push lane (it remains the browser/PWA
  channel, dark, unchanged).
