# Domain prep + design-audit decision packet (g-b83d1c77) — 2026-08-03

Canonical domain: **next-bar.com**. next-bar.app is STALE — never use.
Nothing here is deployed; code changes in this slice are local commits.

## What this slice already fixed (mechanical/truthful, no judgment needed)

- "Manhattan only/·" claims corrected to NYC across /install (Hero,
  HowItWorks, footer), /quiz footer, root OG image, manifest name +
  description, layout keywords, settings coverage line (catalog spans
  Manhattan + Brooklyn + parts of Queens since the 2026-07 expansions).
- Fabricated "learns your radius" removed from AppStoreCta (no such
  feature exists — radius is a manual filter chip).
- R2: /share/[barId] post-vote stacked three accent CTAs → "See your
  list" is now outline.
- R4: primary CTAs bumped to ≥56px on onboarding, /share, WaitlistForm,
  /nights empty state, shared-night gone-state + Get Next Bar.
- R5/a11y: /join gained an h1 and a way out ("← What is Next Bar?");
  /quiz gained a landmark h1; LocationPrompt spinner respects
  prefers-reduced-motion.
- R7: /share/[barId] card and /u/[handle] list rows lead with the bar's
  visual tile (photo-when-policy-allows, glyph fallback).
- Metadata reconciliation: per-page titles/descriptions for /install,
  /join (matches its waitlist OG), /auth, /onboarding, /quiz, /nights,
  /u/[handle] and /u/[handle]/night/[shareId] (param-derived, display-only).
- Site identity centralized in src/lib/siteIdentity.ts (one env-var
  switch); env-aware sitemap.ts (marketing/legal routes only) and
  robots.ts (production allows; staging/preview/local disallow all).

## Decisions needed from the operator

1. **Support email.** All mailtos say `hi@next-bar.app` (privacy, terms,
   settings ×2, OSM sweep User-Agent). The goal forbids claiming
   `hi@next-bar.com` works, and no mailbox is verified for either domain.
   Options: (a) set up `hi@next-bar.com` (forwarding is enough), confirm
   receipt, then I swap all six refs — RECOMMENDED; (b) swap now and
   accept a window where mail may bounce; (c) drop mailtos until the
   mailbox exists. Nothing edited pending your call.
2. **Legacy Google photos liability (pre-existing, surfaced by audit).**
   ~3,435 re-hosted Google Place photos ship in public/bar-photos behind
   `NEXT_PUBLIC_LEGACY_PHOTOS` (default ON per .env.example) — the code's
   own comments say re-hosting isn't permitted by Places policy; the
   compliant `NEXT_PUBLIC_GOOGLE_MEDIA` path is OFF pending your spend-cap
   review. Decide: flip legacy off (visual downgrade to glyphs), fund the
   compliant path, or accept the exposure knowingly.
3. **"iOS app / TestFlight" framing.** WaitlistForm + AppStoreCta present
   the wrapped PWA as "the iOS app" without disclosure. Not false, but
   it's a brand-voice call whether to soften ("early access") or leave.
4. **CartoCDN map tiles** are a third-party runtime dependency on every
   map surface. Accept (industry-normal) or self-host later. No action
   taken.
5. **DNS cutover** (when you buy/point next-bar.com — checklist):
   - Vercel: add next-bar.com + www.next-bar.com to the production
     project; recommendation: **www → apex 308 redirect** (apex
     canonical). NOT configured by me.
   - Set `NEXT_PUBLIC_SITE_URL=https://next-bar.com` on production (this
     is now the single switch for metadataBase/OG/sitemap/robots).
   - Intent (not created): `staging.next-bar.com` as the stable staging
     host — needed by the Supabase auth allowlist and Maps referrer
     restrictions.
   - Email DNS before any mailto swap: MX (or forwarding), SPF, DKIM,
     DMARC (start p=none), and a deliverability probe to the new mailbox.
   - TLS is automatic via Vercel once DNS points.
6. **Supabase auth redirect matrix** (per environment — dashboard config,
   not code; code builds callbacks from window.location.origin so it
   inherits whatever host it runs on):
   | Env | Site URL | Redirect allowlist |
   |---|---|---|
   | Local | http://localhost:3000 | http://localhost:3000/auth/callback |
   | Preview | (ephemeral) | own isolated project or no real auth |
   | Staging | https://staging.next-bar.com | staging callback only |
   | Production | https://next-bar.com | https://next-bar.com/auth/callback ONLY — no wildcards, no staging host |
   Separate SMTP sender for non-production (never the production sender).
7. **Apple associated domains**: no Team ID/bundle ID exists locally —
   correctly NOT invented; apple-app-site-association deferred until real
   identifiers exist.
