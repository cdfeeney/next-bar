# TestFlight release architecture — Phase 1 implementation scope

Date: 2026-08-03
Tier: T0 (native release, authentication, environment isolation)
Goal: `g-e6febb81-bfac-4033-9b22-a3a9fbe27691`
Status: local implementation only; no Apple, Vercel, DNS, Supabase, or deployment writes

## Objective

Turn the reviewed TestFlight architecture decision into a Windows-verifiable
implementation slice without colliding with the active UI/social work in
`nb-overnight`.

The confirmed origins are:

- public brand site: `https://next-bar.com`;
- consumer Production web/API/auth: `https://app.next-bar.com`;
- protected consumer Staging: `https://staging.next-bar.com`;
- venue partner app: `https://partners.next-bar.com`;
- investor portal: `https://investors.next-bar.com`.

The existing Vercel Staging project remains the consumer QA and future hosted
API/auth environment. It is not the investor portal. Its Vercel SSO protection
must remain enabled. A protection-bypass credential must never be embedded in a
binary, so protected Staging is not a safe Capacitor `server.url` target.

## In scope

1. Reconcile the reviewed TestFlight ADR/preflight commits and the iOS wrapper
   already merged on `origin/main` into this isolated implementation branch,
   preserving exact provenance.
2. Remove the hard-coded obsolete `next-bar-two.vercel.app` assumption.
3. Make release configuration fail closed if `server.url` is present. Any
   remote-origin shell must be explicitly development/internal-only and cannot
   silently graduate to an external TestFlight or App Store build.
4. Encode the consumer Staging/Production origin map without credentials and
   test that public, partner, and investor origins cannot be selected as the
   consumer API/auth origin.
5. Reconcile the native release plan with locally packaged UI, hosted API/auth,
   PKCE/deep-link prerequisites, and the invisible server-surface inventory.
6. Implement only Windows-safe native-value work that can be verified without
   Apple credentials, prioritizing native geolocation with a web fallback and
   native sharing where the existing product boundary supports it.
7. Strengthen deterministic preflight checks for the architecture, origin map,
   1024 icon/support-route gaps, environment isolation, and release provenance.
8. Run focused unit tests, typecheck, production build, TestFlight preflight,
   secret scan, and `git diff --check` in proportion to the final diff.

## Explicit gates and exclusions

- `com.nextbar.app` remains the recommended but operator-unconfirmed Bundle ID.
  Do not create or modify an Apple identifier, certificate, profile, App Store
  Connect record, TestFlight group, or signed build.
- Do not dispatch the TestFlight workflow or upload an IPA.
- Do not weaken Vercel Staging protection or embed a Vercel bypass token.
- Do not attach a custom domain, change Vercel variables, change Supabase auth
  callbacks, touch Production, or enable analytics/PostHog.
- Do not apply any migration.
- Do not modify, stage, or overwrite the four operator-owned documents in
  `nb-overnight`.
- The 1024 App Store icon and public `/support` route may be reported as honest
  gaps; material implementation belongs in focused follow-up goals unless the
  dependency is trivial and explicitly approved.

## Acceptance

- No stale Vercel hostname remains in release-capable native configuration.
- Release configuration cannot contain `server.url`.
- Staging and Production consumer origins are explicit, tested, and fail closed.
- Native location/share paths preserve browser behavior and have focused tests.
- The preflight discriminates the prohibited remote-shell release shape.
- Remaining PKCE, Team ID, Bundle ID, signing, App Store, domain, icon, support,
  and Production dependencies are recorded with exact next actions.
- Only reviewed, explicitly named files are committed; nothing is pushed or
  deployed without a separate operator gate.
