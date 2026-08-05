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
of which construct their own client with `persistSession: false`. They differ in what they
trust, and the difference is the point:

- `api/account/delete` takes **no** identity from the request body — the user id comes from a
  verified bearer token. This is the strong pattern.
- `api/event` **does** read a value from the body (`route.ts:65-66`) and forwards it to the RPC
  as `p_name` (`:84-85`). It is safe because that value must first match the `ANALYTICS_EVENTS`
  allowlist (`:71-72`) — the control is the allowlist, not the caller's identity. Do not
  generalise "neither trusts the request body" across both routes; it is only true of one.

## Trust boundaries

| # | Boundary | What crosses | Control |
|---|---|---|---|
| 1 | Browser → Vercel | anything the user sends | per-route validation; in-memory IP rate limits |
| 2 | Vercel → Supabase (anon) | user session cookie | RLS |
| 3a | Vercel → Supabase (service role), `api/account/delete` | verified user id only | route code; `LOOP_UNATTENDED` hard gate on deletion |
| 3b | Vercel → Supabase (service role), `api/event` | a **request-supplied** event name | allowlist: `route.ts:71-72` rejects anything outside `ANALYTICS_EVENTS` before it reaches `p_name` in the RPC (`:84-85`). Not a verified-identity path — the control is the allowlist, not the caller. |
| 4 | Browser → Supabase (direct, PostgREST) | RPC arguments | **RLS does not apply inside definer functions** — the function body is the boundary (audited in C4) |
| 5 | Vercel → Google Places / Maps | venue queries | API key restrictions (**UNVERIFIED**) + `ALLOW_GOOGLE_*_INGEST` kill switches |
| 6 | Build → App Store | signed bundle | **no signing/submission tooling exists in this repository.** Whether a signed build was ever produced outside it is **UNVERIFIED** — the repo cannot see that. |

Boundary 4 is the one people get wrong: a browser can call any granted RPC directly, without
going through the app. C4 audited all 29 definer functions on exactly that basis — 28 of which
are browser-callable, which is the number quoted in the credential table above.

## Environment variables (names only)

Twenty-five referenced across `src/`, `scripts/`, `ceo/`, `e2e/` and the configs.

<!-- Do not hand-count this. Two successive reviews found the total wrong (23 -> 24 -> 25;
     PROD_URL and VERCEL_ENV were each missed once). Regenerate by grepping process.env.*
     across those directories plus the root configs, and reconcile against
     scripts/check-env.mjs, which is the closest thing to a machine-readable list. -->


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
| `PROD_URL` | not a secret. Overrides the production-smoke target in `playwright.prod.config.ts:23`, which otherwise falls back to a hard-coded Vercel URL. That the fallback URL is currently live and deployed is **UNVERIFIED**. Harmless in app runtime; it only steers where the smoke suite points. |

### Platform-injected (Vercel)

`VERCEL_GIT_COMMIT_SHA`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `NODE_ENV`,
`VERCEL_ENV` (read at `scripts/check-env.mjs:20`, defaulting to `local`).

## Dependencies

Nine runtime dependencies — a deliberately small surface.

| Package | Role | Note |
|---|---|---|
| `next@^14.2.35` | framework | App Router; `^` allows minor drift between environments |
| `react` / `react-dom@18.3.1` | UI | pinned exactly |
| `@supabase/supabase-js@^2.105.4` | data + auth | carries the **service-role key (rated CRITICAL above)** and the anon key (public by design — safe only if RLS and the definer functions are correct; see the credential table). `^` allows minor drift between environments; run `npm audit` before bumping. |
| `@supabase/ssr@^0.10.3` | cookie session in middleware | mediates the auth cookie on every matched request. `^` allows minor drift; same audit-before-bump rule. |
| `leaflet@1.9.4` + `react-leaflet@4.2.1` + `leaflet-gesture-handling` | map | pinned. Tiles come from a third-party provider — `BarMap.tsx:246-247` requests a public CARTO basemap with no API key. The open question is *their* terms and rate limits, which we do not control. Whether any billing or account relationship with CARTO exists is **UNVERIFIED** (the repo shows no key, which is not the same as showing no account). |
| `framer-motion@11.11.17` | animation | pinned exactly |

No analytics SDK, no ad SDK, no error-tracking SDK is installed **in this repository**. That is
a **finding for the App Privacy answers** (no third-party SDK we ship is collecting) and
simultaneously the gap goal 11 exists to close (nothing *in this repository* reports errors).
Platform-level coverage that needs no dependency — Vercel's own alerting, an external uptime
monitor — is **UNVERIFIED**; see "Unverifiable from the repository" below.

## External services contacted

| Host | Purpose | Credential |
|---|---|---|
| `*.supabase.co` | data, auth, storage | anon key (browser) / service role (server) |
| `places.googleapis.com`, `maps.googleapis.com` | venue enrichment, tiles | Google keys |
| `overpass-api.de` | OSM coordinate backfill | none (public) |
| custom domain (**spelling unresolved**) / `next-bar-two.vercel.app` | canonical + preview origins | **UNVERIFIED.** Both are environment-driven (`NEXT_PUBLIC_SITE_URL`, Vercel's injected URL), so the repo cannot prove which origin is canonical today or that DNS maps to it. **The custom domain is recorded inconsistently in this file — `nextbar.app` in some places, `next-bar.app` in others. Do not treat either as authoritative.** Confirm it against the registrar and then unify every mention; until then this row deliberately does not name one. |

`example.com`, `example.supabase.co`, `evil.example` and `push.example` appear **only in
tests** — `evil.example` is the cross-origin fixture in the `api/event` suite.

## Production access

| Question | Answer from the repository |
|---|---|
| Who can deploy? | **UNVERIFIED** — Vercel project membership is not in the repo |
| Who holds the service-role key? | **UNVERIFIED** — it exists in `.env.local` on this machine and in Vercel's env store |
| Is `main` protected? | **UNVERIFIED** |
| Recovery if the primary owner loses access? | **The one to answer first.** Split per system, because each has a *different* recovery mechanism — a single "UNVERIFIED" hides that. What the repo DOES prove: no `CODEOWNERS`, no break-glass doc, no `vercel.json`, so **nothing in this repository documents a recovery path for any of them.** Per system: **Vercel** — org membership + who can re-add a deployer: UNVERIFIED. **Supabase** — org membership, whether the DB password is recorded anywhere: UNVERIFIED. **GitHub** — the remote is `github.com/cdfeeney/next-bar`, a **personal** repository, so there is probably no org to fall back on. Sole account holder vs. any collaborator with admin rights, and whether 2FA recovery codes are stored: UNVERIFIED. **Domain registrar** (custom domain — see the spelling caveat under "External services contacted"; do not assume either form) — who can transfer/renew it; an expired domain is an outage no code fixes: UNVERIFIED. **Apple Developer** — account holder vs admin; the account holder role cannot be self-served: UNVERIFIED. |
| What runs CI? | `.github/workflows/ci.yml` — typecheck, Vitest, production build on PRs and pushes to `main` |

## Unverifiable from the repository

Everything below needs attended dashboard evidence. **None of it may be recorded as passing
without that.**

**The single highest-value thing the operator can do here needs no dashboard at all:** state,
per system, whether a second admin/owner exists today and where recovery codes are stored
(e.g. which password-manager vault). That is self-reportable from memory, and it converts the
five recovery UNVERIFIEDs below into either a real recovery procedure or a confirmed
single-point-of-failure worth fixing this week.

- Vercel: project settings, env var values per environment, domains, deployment protection.
- Supabase: whether production RLS matches the committed migrations, backup plan and retention,
  region, restore capability. *(The ledger position — **0032** applied, `0033`–`0035` authored
  but not — is a live-database fact recorded on 2026-07-30 from an earlier attended query, NOT
  something this repository can prove. Re-verify before relying on it; it may already be stale.)*
- Google: whether the Maps/Places keys carry referrer/IP restrictions, quotas and budget alerts.
- GitHub: branch protection and required checks.
- DNS/TLS for the custom domain (**exact spelling unresolved** — `nextbar.app` vs `next-bar.app`; confirm at the registrar, then unify every mention in this file).
- Brevo: DKIM/SPF and deliverability.
- Apple: enrollment and App Store Connect access.
- Monitoring: **no monitoring integration is installed in this repository.** Whether Vercel's
  built-in alerting or an external uptime monitor covers the deployment is **UNVERIFIED** —
  neither can be seen from here.

## What this inventory itself reveals

1. **No observability of any kind ships FROM THIS REPOSITORY today.** No error tracker, no
   uptime check beyond `/api/health` existing, no alert path — *in the code and config we
   control*. Whether Vercel's built-in alerting or an external uptime monitor is switched on
   in a dashboard is **UNVERIFIED** and cannot be settled from here. If nothing external
   exists either, a production failure would be discovered by a user.
2. **The service-role surface is small and well-guarded** — two routes, both constructing
   their own client, neither trusting a request-supplied identity.
3. **The anon key's safety is entirely a function of RLS and definer-function correctness**,
   which is why C3 and C4 were the right audits to run before launch.
4. **Single-owner risk is undocumented.** That much the repository proves: there is no
   `CODEOWNERS`, no secondary-access or break-glass document, and no `vercel.json`. Whether
   it is also *unmitigated* — a second org member, a recovery contact, saved recovery codes —
   lives in the Vercel/Supabase/GitHub/registrar/Apple dashboards and is **UNVERIFIED**.
   Access recovery is the cheapest high-value thing on this list to fix.
