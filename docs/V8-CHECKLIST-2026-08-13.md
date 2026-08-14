# V8 product and release checklist — 2026-08-13

V8 begins only after V7 is frozen and rolling out. Work stays staging-first and
must not change the production alias or production database without separate
attended approval.

Authoritative product requirements: `docs/V8-PRD-2026-08-13.md`.

Design lock status: the native interaction contract is locked. The final visual
art direction remains gated on the operator's labeled reference images; no
overnight lane may apply an app-wide visual restyle before that selection.

## 1. Image-led interface refresh

- [ ] Treat the physical iPhone as a native-app surface, not a responsive web
  page: remove visible browser-style scrollbars and accidental scroll rails.
- [ ] Audit every screen for unwanted horizontal scroll, nested scrolling,
  rubber-band/overscroll behavior, fixed-nav movement, and clipped safe areas.
- [ ] Keep scrolling only where the product deliberately needs it; filters,
  sheets, cards, and tab content should not expose desktop-web affordances.
- [ ] Validate the keyboard, bottom navigation, lightboxes, and sheets in the
  Capacitor WebView rather than approving them from desktop browser sizing.
- [ ] Collect and label the operator-provided reference images.
- [ ] Map each reference to an existing Next Bar surface before changing code.
- [ ] Define the V8 visual tokens for cards, overlays, motion, spacing, and type.
- [ ] Redesign one representative bar card and lightbox first.
- [ ] Preserve Google Places UI Kit attribution and no-photo-cache policy.
- [ ] Validate reduced motion, contrast, 44px touch targets, and text scaling.
- [ ] Apply the approved system to Home, Map, Rankings, Lists, and Friends.
- [ ] Verify compact iPhone, large iPhone, Android, landscape, and desktop.

## 2. Venue tags and expansion

- [ ] Add at most five customer-facing tags per venue.
- [ ] Include useful types such as food, pub, wine, cocktail, rooftop, lounge,
  nightclub, sports, gay bar, and reservation-led.
- [ ] Show tags at the bottom of the bar lightbox without crowding the result card.
- [ ] Define deterministic tag priority when more than five apply.
- [ ] Add Hoboken and the approved NYC suburbs only after Manhattan stabilizes.
- [ ] Validate each expansion venue with stable Place ID, operational status,
  address/coordinates, allowed type, location, and duplicate detection.

## 3. Social sharing and invitation experience

- [ ] Establish one canonical Night Out invitation object and share URL.
- [ ] Add branded Open Graph art for invitation links and shared nights.
- [ ] Add tasteful share/invite transitions using the approved V8 motion system.
- [ ] Support native share sheet, copy link, and recipient landing state.
- [ ] Preserve attribution and avoid embedding private account data in previews.
- [ ] Make join, accept, decline, and `Not tonight` states explicit.
- [ ] Add bar suggestions and voting to the invitation timeline.
- [ ] Add persistent night history before considering persistent group chat.
- [ ] Defer group chat until moderation, reporting, blocking, retention, and
  notification volume rules are approved.

## 4. Native invitation notifications

- [ ] Decide the minimum V8 notifications: invited to a night, invite accepted,
  bar suggested, and plan changed.
- [ ] Add an explicit in-app notification preference screen before prompting iOS.
- [ ] Request iOS permission only after a user performs a notification-relevant
  action; never on first launch.
- [ ] Configure the iOS app identifier and push-notification entitlement in Xcode.
- [ ] Enable the required Apple Push Notification service capability/profile.
- [ ] Register Capacitor/iOS for remote notifications and persist the device token
  against the signed-in account.
- [ ] Store tokens server-side with RLS, device ownership, rotation, and revoke on
  sign-out/account deletion.
- [ ] Add a server-side notification event/outbox with idempotency and retries.
- [ ] Choose and configure the APNs sender; keep APNs credentials server-only.
- [ ] Deep-link notification taps to the exact Night Out invitation.
- [ ] Handle foreground, background, terminated, denied, revoked, expired-token,
  duplicate-event, and multi-device cases.
- [ ] Add per-event opt-outs, quiet behavior, and basic rate limiting.
- [ ] Update App Store privacy disclosures and notification support copy.
- [ ] Test on a real physical iPhone; simulator-only evidence is insufficient.

## 5. Account and database continuity

- [ ] Finish cross-device sync for vibe profile and all named lists.
- [ ] Inventory every local storage key and its Supabase owner/table.
- [ ] Define per-object merge rules and last-write/conflict behavior.
- [ ] Keep staging and production schemas migration-compatible and versioned.
- [ ] Promote catalog/content separately from private user/account data.
- [ ] Never reseed, truncate, overwrite, or replace the production user tables.
- [ ] Add update tests from the exact V7 TestFlight build to the V8 candidate.
- [ ] Verify Tester 1 / Conor Feeney retains Bar 54, lists, scores, night history,
  shared nights, profile, and authentication after update and force-close.
- [ ] Add rollback and backup-restoration evidence before production migration.

## 6. V8 release gate

- [ ] V7 physical-device baseline is complete and archived.
- [ ] All V8 migrations are additive, reviewed, and tested against a production-like
  staging snapshot with synthetic accounts only.
- [ ] Full unit, type, build, Chromium, WebKit, and physical-iPhone checks pass.
- [ ] Notification delivery and deep links pass on a physical device.
- [ ] No Google content is cached contrary to Places terms.
- [ ] Accessibility and privacy review are complete.
- [ ] Staging approval is recorded before TestFlight upload.
- [ ] TestFlight upgrade preserves the V7 tester account baseline.
- [ ] Production promotion remains a separate attended decision.
