# APNs real-device testing (V8, staging/sandbox only)

This covers testing push notifications on a real iPhone against the APNs
**sandbox** (development) gateway. The native iOS shell is configured for
`aps-environment = development` only (`ios/App/App/App.entitlements`) —
switching to production is a separate, attended change and is explicitly out
of scope here. Do not attempt it as part of this doc.

## 1. Prerequisites — attended, not provided by this work

None of the following exist yet as a result of the iOS-shell config change.
**Until all four exist, no real notification can be delivered to a device,**
no matter how correct the client/server code is:

1. An APNs **auth key** (`.p8` file) created in the Apple Developer portal,
   plus its **Key ID** and your **Team ID**. This is generated once per
   Apple Developer account and downloaded — Apple will not let you download
   it a second time, so store it somewhere durable immediately.
2. The **Push Notifications capability** enabled on the `com.nextbar.app`
   App ID in the Apple Developer portal (Certificates, Identifiers &
   Profiles → Identifiers → `com.nextbar.app` → check Push Notifications).
3. A **provisioning profile** for `com.nextbar.app` that includes the Push
   Notifications entitlement, regenerated/downloaded after step 2.
4. A **physical iPhone**, registered as a test device if you're using a
   development-signed build, with the app installed via one of the
   documented non-Xcode paths (PWABuilder + iTMSTransporter, or cloud Mac
   CI — there is no local `xcodebuild` on Windows).

Simulator testing is not a substitute for any of the above: the iOS
Simulator cannot receive real APNs pushes at all (only local, synthetic
`.apns` payloads dropped onto it), so **simulator-only evidence proves
nothing about real delivery.** A physical device is required to consider
this feature verified.

## 2. Server environment variables

The notification sender (drain job) needs these set. Names only — never
commit or paste actual values anywhere, including into this doc:

| Variable | Purpose |
|---|---|
| `APNS_KEY_ID` | Key ID of the `.p8` auth key from step 1 above |
| `APNS_TEAM_ID` | Apple Developer Team ID |
| `APNS_BUNDLE_ID` | `com.nextbar.app` |
| `APNS_PRIVATE_KEY` | Contents of the `.p8` key (store as a secret, not a file in the repo) |
| `APNS_ENVIRONMENT` | Must be `sandbox` for all testing under this doc — matches the `development` `aps-environment` the client ships with. Do not set this to `production` against a device built with this configuration; production APNs will reject a sandbox-signed token and vice versa. |
| `NOTIFICATIONS_DRAIN_SECRET` | Shared secret protecting the drain endpoint/job that walks `notification_outbox` |

## 3. Test matrix — four event types x three app states

The PRD defines exactly four notification event types, generated server-side
by triggers in `supabase/migrations/0061_notification_outbox.sql`: `invited`,
`accepted`, `bar_suggested`, `plan_changed`. Test each in each app state.

Setup common to all rows: two accounts (A = owner, B = invitee/member) on two
separate physical devices, or one physical device plus one account acting as
the "other side" via a second logged-in device/browser. Both need to have
opened the app once, sent or accepted an invitation (see permission timing in
§5), and granted notification permission.

| Event | Trigger action | FOREGROUND (app open) | BACKGROUND (app suspended) | TERMINATED (app force-quit) |
|---|---|---|---|---|
| `invited` | A invites B to a Night Out | B gets a system banner while the app is open | B gets a system notification banner; badge increments | B gets a system notification; tapping cold-launches the app |
| `accepted` | B accepts A's invite | A gets a system banner while the app is open | A gets a system notification banner | A gets a system notification; tapping cold-launches the app |
| `bar_suggested` | An accepted member suggests a bar | Other accepted members get a system banner while the app is open | Other accepted members get a system notification | Other accepted members get a system notification; tapping cold-launches the app |
| `plan_changed` | A changes the night/title/status/decided bar | All accepted members get a system banner while the app is open | All accepted members get a system notification | All accepted members get a system notification; tapping cold-launches the app |

Expected result for every FOREGROUND row: **a system notification banner**,
with sound and a badge increment. `capacitor.config.ts` ships
`presentationOptions: ['badge', 'sound', 'alert']`, which is the app opting IN
to the full system presentation while it is in the foreground; the app
registers no `pushNotificationReceived` handler and therefore draws no in-app
banner of its own. A foreground event that produces **silence** is a failure,
and so is one that produces only an in-app toast — that would mean the
presentation options are not the ones this repository ships.

## 4. Deep-link verification

Every notification's payload routes to `/night-out/<share-token>`
(`src/app/night-out/[token]/page.tsx`). For each of the four event types,
verify:

1. **Cold launch tap**: force-quit the app, receive the notification, tap
   it. The app must launch directly into the correct Night Out at
   `/night-out/<share-token>` — not the home screen with a subsequent
   navigation, and not a different Night Out if the recipient belongs to
   more than one.
2. **Signed-out-then-sign-in tap**: sign out, receive a notification (this
   requires a device token still registered under a previous session — see
   token cases below, or use a second device that stays signed in), tap it
   while signed out. Confirm the app either prompts sign-in and THEN lands
   on `/night-out/<share-token>`, or defers the navigation until after
   sign-in completes — either is acceptable, but the tap target must not be
   silently dropped.

## 5. Permission cases

- **First launch**: opening the app for the first time must **not**
  prompt for notification permission. Confirm no system permission dialog
  appears on first launch.
- **Prompt timing**: the permission prompt should appear only after the
  user's first action that needs it — sending an invitation or accepting
  one. Confirm the prompt appears at that point and not before.
- **Denied**: deny the permission prompt. Confirm the app doesn't crash or
  loop the prompt, and that `save_native_device_token` is never called (no
  new row in `native_device_tokens` for that installation).
- **Granted then revoked**: grant permission, confirm a token is saved, then
  go to iOS Settings → Next Bar → Notifications and turn notifications off.
  Confirm subsequent events still enqueue in `notification_outbox` (server
  doesn't know about the OS-level revoke) but delivery fails gracefully —
  check `notification_deliveries.apns_status` / `apns_reason` for the
  rejection (APNs typically reports this as an invalid-token-class error on
  the next send, not immediately).

## 6. Token cases

- **Rotation**: reinstall or otherwise force iOS to reissue a device token
  for the same install. Confirm `save_native_device_token` updates the
  existing row (same `installation_id`, new `token`) rather than creating a
  duplicate — see the `on conflict ... do update` in
  `save_native_device_token` (`supabase/migrations/0060_native_device_tokens.sql`).
- **Reinstall**: delete and reinstall the app on the same device/account.
  This produces a new `installation_id`. Confirm the stale token row for the
  old installation is cleaned up if the same physical token comes back (see
  the ownership-transfer `delete` in `save_native_device_token`), and that
  the account isn't left with two live rows for one physical device.
- **Two devices, one account**: sign into the same account on two physical
  iPhones. Confirm both receive notifications for the same event (two rows
  in `notification_deliveries` for the one `notification_outbox` row, one
  per `device_token_id`).
- **Sign-out revocation**: sign out on one device. Confirm
  `revoke_native_device_token` is called for that installation
  (`revoked_at` set) and that device stops receiving notifications while
  the other device (if any) keeps working.

## 7. Reading results server-side

Don't rely on eyeballing the phone alone — confirm the server's view too:

- `public.notification_outbox`: one row is created per event. Check
  `status` (`pending` → `sent`/`failed`/`suppressed`), `attempts`, and
  `last_error` for anything that didn't drain cleanly. `dedupe_key` lets you
  confirm a repeated action (e.g. accepting twice) did NOT double-enqueue.
- `public.notification_deliveries`: one row per (outbox row, device).
  `status` (`sent`/`failed`/`invalid_token`), `apns_status` (the HTTP status
  APNs returned), and `apns_reason` (APNs' error string, e.g.
  `BadDeviceToken`, `Unregistered`) tell you exactly what APNs said about a
  given device — this is the fastest way to tell "server never tried",
  "APNs rejected the token", and "APNs accepted it but the phone didn't
  show it" apart.

## 8. Bottom line

Until the prerequisites in §1 exist (APNs key, capability, provisioning
profile, physical device), this configuration change enables the CLIENT and
SERVER plumbing but cannot deliver a single real notification. Treat any
claim of "notifications work" that isn't backed by a physical-device run
through this matrix, with corroborating `notification_outbox` /
`notification_deliveries` rows, as unverified.
