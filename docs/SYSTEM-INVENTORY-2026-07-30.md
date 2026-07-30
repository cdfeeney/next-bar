# Next Bar — current-state system inventory

Written 2026-07-30 for goal `g-574ef5eb`. Everything here is derived from the repository at
`feat/overnight-2026-07-30`. **No secret values appear anywhere — variable NAMES only.**

Anything that depends on a dashboard is listed under [Unverifiable from the repository](#unverifiable-from-the-repository)
and is marked **UNVERIFIED**, not assumed.

## How a request actually flows

```
iPhone (Safari / PWA / future Capacitor shell)
   │  HTTPS
   ▼
Vercel edge ─────────────► Next.js 14 App Router (serverless functions)
   │                          │
   │                          ├── middleware  (ONLY /auth/*, /settings/*)
   │                          │      refreshes the Supabase cookie session
   │                          │
   │                          ├── Server components / RSC
   │                          │      read the static bundle catalog
   │                          │
   │                          └── /api/* route handlers
   │                                 waitlist · event · health · account/delete
   ▼
Browser JS ──────────────► Supabase (PostgREST + GoTrue + Storage)
                              RLS + SECURITY DEFINER RPCs
                              │
                              └── Postgres
```

Two distinct trust paths reach Supabase, and they must not be confused:

| Path | Credential | Constrained by |
|---|---|---|
| Browser → Supabase (direct) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public by design) | **RLS + the 28 definer RPCs.** The anon key is not a secret; it is a routing token. |
| Vercel function → Supabase | `SUPABASE_SERVICE_ROLE_KEY` (secret) | **Nothing — it bypasses RLS.** Used only by `api/account/delete` and `api/event`. |

The service-role path is the one that matters. It appears in exactly two route handlers, both
of which construct their own client with `persistSession: false`, and neither of which takes
its target from the request body.

## Trust boundaries

| # | Boundary | What crosses | Control |
|---|---|---|---|
| 1 | Browser → Vercel | anything the user sends | per-route validation; in-memory IP rate limits |
| 2 | Vercel → Supabase (anon) | user session cookie | RLS |
| 3 | Vercel → Supabase (service role) | verified user id only | route code; `LOOP_UNATTENDED` hard gate on deletion |
| 4 | Browser → Supabase (direct, PostgREST) | RPC arguments | **RLS does not apply inside definer functions** — the function body is the boundary (audited in C4) |
| 5 | Vercel → Google Places / Maps | venue queries | API key restrictions (**UNVERIFIED**) + `ALLOW_GOOGLE_*_INGEST` kill switches |
| 6 | Build → App Store | signed bundle | not yet exercised |

Boundary 4 is the one people get wrong: a browser can call any granted RPC directly, without
going through the app. C4 audited all 29 definer functions on exactly that basis.

## Environment variables (names only)

Twenty-three referenced across `src/`, `scripts/`, `ceo/`, `e2e/` and the configs.

### Public — compiled into the browser bundle

| Name | Purpose | If it leaks |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project endpoint | nothing — it is public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon routing token | nothing **provided RLS is correct**; this is why the RLS/definer audits matter |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | client map tiles | **billable** — needs HTTP-referrer restriction |
| `NEXT_PUBLIC_SITE_URL` | canonical origin for links/OG | low |
| `NEXT_PUBLIC_ANALYTICS` | client analytics flag | none |
| `NEXT_PUBLIC_PUSH_ENABLED` | push feature flag | none |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | push public key | none — public half by design |
| `NEXT_PUBLIC_GOOGLE_MEDIA` | Google media kill switch | none |
| `NEXT_PUBLIC_LEGACY_PHOTOS` | legacy photo flag | none |
| `NEXT_PUBLIC_BUILD_SHA` | build identity for `/api/health` | low (truncated to 12 chars) |

### Server-only secrets — must never carry `NEXT_PUBLIC_`

| Name | Purpose | If it leaks |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | full RLS bypass | **CRITICAL** — total read/write of all user data. Rotate immediately. |
| `DATABASE_URL` | direct Postgres connection | **CRITICAL** — same, plus schema control |
| `GOOGLE_MAPS_API_KEY` | server-side Places calls | **billable abuse** |
| `ANALYTICS_ENABLED` | server analytics gate | none |

### Harness / CI — must be ABSENT in production

| Name | Consequence if present in production |
|---|---|
| `LOOP_UNATTENDED` | **`/api/account/delete` hard-refuses with 503.** Users silently lose their right to delete their account. The route logs loudly for exactly this reason. |
| `CI` | changes Playwright workers/retries; harmless in app runtime |
| `G4_DUMP` | debug dump flag |
| `ALLOW_GOOGLE_PHOTO_INGEST` / `ALLOW_GOOGLE_REVIEW_INGEST` | compliance kill switches — ingest is off unless explicitly enabled |

### Platform-injected (Vercel)

`VERCEL_GIT_COMMIT_SHA`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `NODE_ENV`.

## Dependencies

Nine runtime dependencies — a deliberately small surface.

| Package | Role | Note |
|---|---|---|
| `next@^14.2.35` | framework | App Router; `^` allows minor drift between environments |
| `react` / `react-dom@18.3.1` | UI | pinned exactly |
| `@supabase/supabase-js@^2.105.4` | data + auth | |
| `@supabase/ssr@^0.10.3` | cookie session in middleware | |
| `leaflet@1.9.4` + `react-leaflet@4.2.1` + `leaflet-gesture-handling` | map | pinned; tiles are the CARTO question |
| `framer-motion@11.11.17` | animation | pinned exactly |

No analytics SDK, no ad SDK, no error-tracking SDK is installed. That is a **finding for the
App Privacy answers** (nothing third-party is collecting) and simultaneously the gap goal 11
exists to close (nothing is reporting errors either).

## External services contacted

| Host | Purpose | Credential |
|---|---|---|
| `*.supabase.co` | data, auth, storage | anon key (browser) / service role (server) |
| `places.googleapis.com`, `maps.googleapis.com` | venue enrichment, tiles | Google keys |
| `overpass-api.de` | OSM coordinate backfill | none (public) |
| `nextbar.app` / `next-bar-two.vercel.app` | canonical + preview origins | — |

`example.com`, `example.supabase.co`, `evil.example` and `push.example` appear **only in
tests** — `evil.example` is the cross-origin fixture in the `api/event` suite.

## Production access

| Question | Answer from the repository |
|---|---|
| Who can deploy? | **UNVERIFIED** — Vercel project membership is not in the repo |
| Who holds the service-role key? | **UNVERIFIED** — it exists in `.env.local` on this machine and in Vercel's env store |
| Is `main` protected? | **UNVERIFIED** |
| Recovery if the primary owner loses access? | **UNVERIFIED — and this is the one to answer first.** A single-owner Vercel + Supabase + Apple account with no documented recovery path is the highest-consequence unknown in this inventory. |
| What runs CI? | `.github/workflows/ci.yml` — typecheck, Vitest, production build on PRs and pushes to `main` |

## Unverifiable from the repository

Everything below needs attended dashboard evidence. **None of it may be recorded as passing
without that.**

- Vercel: project settings, env var values per environment, domains, deployment protection.
- Supabase: whether production RLS matches the committed migrations (the ledger says **0032**,
  and `0033`–`0035` are unapplied), backup plan and retention, region, restore capability.
- Google: whether the Maps/Places keys carry referrer/IP restrictions, quotas and budget alerts.
- GitHub: branch protection and required checks.
- DNS/TLS for `next-bar.app`.
- Brevo: DKIM/SPF and deliverability.
- Apple: enrollment and App Store Connect access.
- Monitoring: **nothing is installed**, so there is no error, uptime or alert coverage to verify.

## What this inventory itself reveals

1. **No observability of any kind ships today.** No error tracker, no uptime check beyond
   `/api/health` existing, no alert path. A production failure would be discovered by a user.
2. **The service-role surface is small and well-guarded** — two routes, both constructing
   their own client, neither trusting a request-supplied identity.
3. **The anon key's safety is entirely a function of RLS and definer-function correctness**,
   which is why C3 and C4 were the right audits to run before launch.
4. **Single-owner risk is unmitigated and undocumented.** Access recovery is the cheapest
   high-value thing on this list to fix.
