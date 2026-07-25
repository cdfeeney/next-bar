# App Store Plan — next-bar iOS (drafted 2026-07-25)

Operator is enrolling in the Apple Developer Program. This is the
sequenced path from the live PWA (next-bar-two.vercel.app) to an App
Store listing, grounded in what already exists in the repo.

## Build-path decision (make this first)

**Recommended: Capacitor wrap + cloud Mac builds.** Operator is on
Windows with no Mac.

| Path | Cost | Risk |
|---|---|---|
| **A. Capacitor wrap** (recommended) | Days-weeks; reuses the entire web app | Apple guideline 4.2 "minimum functionality" — thin webview wrappers get rejected. Mitigate with real native surface: APNs push (0009 scaffolding goes live), haptics, native share sheet, app shortcuts. |
| B. PWABuilder.com packaging | Hours | Same 4.2 risk, less control than Capacitor. Fallback probe, not the plan. |
| C. React Native/Expo rebuild | Months | Cleanest approval + native feel. v2 decision, not a launch blocker. |

Cloud Mac build: Codemagic (Capacitor-native support) or GitHub Actions
macOS runners. No local Mac needed until debugging demands one.

Capacitor + Next.js note: the app is server-rendered on Vercel, so the
wrap ships a native shell around the remote origin (Capacitor "server"
config) rather than a static export — keeps one deploy pipeline, but
means the 4.2 mitigation (native plugins actually used) carries the
approval argument.

## Hard Apple requirements — status

| Requirement | Status | Action |
|---|---|---|
| Account deletion in-app (mandatory since 2022) | Route BUILT, dark; **blocked on the invalid SUPABASE_SERVICE_ROLE_KEY in .env.local + Vercel env** | Operator re-copies key → deletion go-live → e2e already exists |
| Privacy policy at public URL | `/privacy` draft has `[PLACEHOLDER]`s | Finalize copy; host on next-bar.app once DNS lands |
| Terms | `/terms` draft, same | Same |
| Support URL + marketing URL | none | next-bar.app (purchase in progress) + `mailto` or a /support page |
| Age rating | 21+ gate SHIPPED (`next-bar:age-ack:v1`) | Declare 17+/frequent-alcohol in the rating questionnaire |
| App Privacy "nutrition labels" | not started | Inventory: email (auth), display name/handle, bar ratings, RSVPs/suggestions, coarse+fine location (while-using, for matching), no tracking/ads. Generate from codebase before submission. |
| Sign in with Apple | NOT required | Only mandated alongside third-party social logins; email/password + magic link is exempt |

## Assets checklist

- App icon 1024×1024 (brand glyph exists — serif "N" on #0a0a0a; needs
  non-italic vector render, no alpha)
- Screenshots: 6.7" (1290×2796) + 5.5" (1242×2208) sets — home flow,
  quiz, map, rankings (with the new numbers), Where-should-we-go vote
- Name ("Next Bar"), subtitle (≤30 chars), description, keywords,
  category (Food & Drink), copyright
- APNs auth key (.p8) once push goes native

## Sequence

1. Operator: Apple Developer enrollment ($99/yr, individual — no D-U-N-S).
2. Operator: service-role key re-copy → deletion go-live (repo-side ready).
3. Domain live (next-bar.app → Vercel + Brevo DKIM/SPF + Supabase
   allowlist) → finalize /privacy + /terms on it.
4. Capacitor scaffold in-repo (`ios/` project, remote-origin config,
   push/haptics/share plugins) + Codemagic pipeline → TestFlight build.
5. Operator phone-tests via TestFlight (replaces the PWA install for dogfooding).
6. App Privacy questionnaire + assets + listing copy.
7. Submit; expect one 4.2 conversation with review — the native-plugin
   surface and the listing framing ("social bar-night planner", not
   "our website in an app") are the counter-arguments.

## Open questions

- Q1: Bundle the web app statically in the shell later (offline + faster
  cold start) vs stay remote-origin? Start remote, revisit.
- Q2: Push notifications launch scope — suggestions/RSVP pings for your
  circle is the obvious first (0009 tables + SW handlers exist).
- Q3: Does the demo/sample-night experience need gating for review
  accounts? Prepare a review-notes doc with a seeded test account.
