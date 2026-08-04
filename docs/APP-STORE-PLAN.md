# App Store Plan — next-bar iOS (drafted 2026-07-25)

> **2026-08-03 status corrections:** the public brand domain is
> **next-bar.com**, the consumer app/API origin is **app.next-bar.com**, and
> next-bar.app is STALE — never use it. Apple Developer
> enrollment is **ACTIVE**; an iOS Capacitor wrapper was merged to main on
> 2026-08-02 (`ebbcd55`, PR #90) using the remote-origin `server.url`
> design; and the build-path recommendation below is **SUPERSEDED** by
> `docs/TESTFLIGHT-ARCH-DECISION-g-39169b3b-2026-08-03.md`, which rejects
> `server.url` as a release architecture (official Capacitor docs: "not
> intended for use in production") and adopts the locally-packaged shell
> with hosted APIs as the target. Phase 1 now provides fail-closed build
> profiles plus native geolocation/share; release remains red on local assets
> and PKCE. Run `npm run preflight:testflight` for the deterministic release
> check or `npm run preflight:testflight:internal` for the internal-only probe.

Operator is enrolled in the Apple Developer Program. This is the
sequenced path from the live PWA to an App Store listing, grounded in
what already exists in the repo.

## Build-path decision (SUPERSEDED — see banner above)

**Original recommendation (2026-07-25): Capacitor wrap + cloud Mac
builds.** Operator is on Windows with no Mac.

| Path | Cost | Risk |
|---|---|---|
| **A. Capacitor wrap** (recommended) | Days-weeks; reuses the entire web app | Apple guideline 4.2 "minimum functionality" — thin webview wrappers get rejected. Mitigate with real native surface: APNs push (0009 scaffolding goes live), haptics, native share sheet, app shortcuts. |
| B. PWABuilder.com packaging | Hours | Same 4.2 risk, less control than Capacitor. Fallback probe, not the plan. |
| C. React Native/Expo rebuild | Months | Cleanest approval + native feel. v2 decision, not a launch blocker. |

Cloud Mac build: Codemagic (Capacitor-native support) or GitHub Actions
macOS runners. No local Mac needed until debugging demands one.

Capacitor + Next.js note: the current app depends on Vercel server surfaces, so
the old wrapper used a remote-origin `server.url`. That shape is retained only
as an internal signing-pipeline probe. Release requires locally packaged UI,
absolute hosted consumer API/auth calls, and PKCE/deep-link auth.

## Hard Apple requirements — status

| Requirement | Status | Action |
|---|---|---|
| Account deletion in-app (mandatory since 2022) | Route BUILT, dark; **blocked on the invalid SUPABASE_SERVICE_ROLE_KEY in .env.local + Vercel env** | Operator re-copies key → deletion go-live → e2e already exists |
| Privacy policy at public URL | `/privacy` draft has `[PLACEHOLDER]`s | Finalize copy; host on next-bar.com once DNS lands |
| Terms | `/terms` draft, same | Same |
| Support URL + marketing URL | none | next-bar.com + /support route (not built yet; /install fallback) + `mailto` or a /support page |
| Age rating | 21+ gate SHIPPED (`next-bar:age-ack:v1`) | Declare 17+/frequent-alcohol in the rating questionnaire |
| App Privacy "nutrition labels" | inventory DONE | **`docs/APP-PRIVACY-LABELS-2026-07-30.md` is authoritative** — a code-evidenced inventory that supersedes the summary that used to sit in this cell. Do not restate it here; a second copy is how the two drift. Two operator answers still block submission: `public.waitlist` has no deletion path, and production analytics status is unconfirmed. |
| Sign in with Apple | NOT required | Only mandated alongside third-party social logins; email/password + magic link is exempt |

## Assets checklist

- App icon 1024×1024: PRESENT at the Xcode AppIcon path after wrapper
  reconciliation; decoded RGB/no-alpha and visually matches the serif "N" on
  #0a0a0a. Final operator visual approval remains.
- Screenshots: 6.7" (1290×2796) + 5.5" (1242×2208) sets — home flow,
  quiz, map, rankings (with the new numbers), Where-should-we-go vote
- Name ("Next Bar"), subtitle (≤30 chars), description, keywords,
  category (Food & Drink), copyright
- APNs auth key (.p8) once push goes native

## Sequence

1. Operator: Apple Developer enrollment ($99/yr, individual — no D-U-N-S).
2. Operator: service-role key re-copy → deletion go-live (repo-side ready).
3. Public domain live (`next-bar.com`) for marketing/legal/support; consumer
   Production at `app.next-bar.com`; exact Supabase allowlists per environment.
4. Finish Capacitor release migration: locally packaged UI, hosted consumer
   API origin, PKCE/deep-link auth, and the integrated geolocation/share
   plugins. Use the internal remote profile only for a gated pipeline probe.
5. Operator phone-tests via TestFlight (replaces the PWA install for dogfooding).
6. App Privacy questionnaire + assets + listing copy.
7. Submit; expect one 4.2 conversation with review — the native-plugin
   surface and the listing framing ("social bar-night planner", not
   "our website in an app") are the counter-arguments.

## Open questions

- Q1 RESOLVED: locally packaged UI is mandatory for release. Remote origin is
  internal-only and cannot graduate to external TestFlight/App Store.
- Q2: Push notifications launch scope — suggestions/RSVP pings for your
  circle is the obvious first (0009 tables + SW handlers exist).
- Q3: Does the demo/sample-night experience need gating for review
  accounts? Prepare a review-notes doc with a seeded test account.
