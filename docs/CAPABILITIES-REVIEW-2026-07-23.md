# Capabilities Review — 2026-07-23 (evening)

Code-evidence audit of what Next Bar can do today vs what's blocked, and on what.
Companion doc: `UI-PATH-REVIEW-2026-07-23.md`. Overnight queue lives at the bottom of that doc's process — see `NIGHTLOG` for loop contract.

Legend: **CODE-ABLE-NOW** = no external key/account needed · **NEEDS-KEY** = blocked on operator credential · **NEEDS-DECISION** = operator choice first. Size: S/M/L.

## Matrix

| # | Capability | State today (evidence) | Missing | Class | Size |
|---|---|---|---|---|---|
| 1 | **D1 real social graph** | Tables partial: `supabase/schema.sql` (profiles, bars, visits, saves, waitlist) + migrations 0001 (profiles+ratings, owner-only RLS) and 0002 (pairwise, owner-only RLS). `useRatings` is dual-mode (localStorage + Supabase merge on sign-in via `ratings.server.ts`). `usePairwise`, `useFollows`, `useLists`, intents, group votes = localStorage only; friends are demo-seeded (`src/lib/demo/friends.ts`); `u/[handle]` renders demo data. **All RLS is owner-only — no policy lets a friend read anything**, which structurally blocks a real friends feed. | follows/lists/intents/votes tables + migrations; friend-visible RLS; server sync for follows/lists/pairwise; real profile-by-handle lookup | CODE-ABLE-NOW | L |
| 2 | **Google OAuth sign-in** | Zero wiring — `auth/page.tsx` is email+password only; no `signInWithOAuth` anywhere; magic-link callback exists (`auth/callback/route.ts`) | Google Cloud OAuth client + Supabase provider config, then small code change | NEEDS-KEY (Google Cloud) | S |
| 3 | **Phone OTP (SMS)** | None; explicitly deferred in `auth/page.tsx` ("needs an SMS provider"). **UPDATE 2026-07-23: operator has a Twilio account** — provider blocker is gone | Operator: enable Phone in Supabase Auth + paste Twilio SID/token/Messaging Service SID (dashboard). Code: phone+OTP flow on `/auth` | NEEDS-dashboard-config, then CODE-ABLE | M |
| 4 | **Web push (D2)** | `public/sw.js` is app-shell cache only — no `push`/`notificationclick` handlers, no VAPID anywhere. `src/lib/cadence.ts` (Thu–Sat night predicate, 5 tests) is the ready gate | SW push handlers, subscription client + table, send endpoint/cron, VAPID keypair (self-generatable free via `web-push` — real blocker is the send-server decision) | NEEDS-DECISION (send infra); scaffolding CODE-ABLE-NOW shipped dark | M/L |
| 5 | **Google Places open-now (D3)** | Pipeline fully built: `OpenNowBadge.tsx` + `lib/openNow.ts` (12 tests) compute from stored hours; `scripts/refresh-places.mjs` budgeted for free tier — but sidecar `bars.places.ts` is an empty stub, so every badge renders null | `GOOGLE_MAPS_API_KEY` with Places API (New), then one script run | NEEDS-KEY | S |
| 6 | **Analytics** | Nothing in src or package.json (no PostHog/Vercel/gtag/plausible) | Pick provider. Rec: Vercel Analytics toggle + PostHog free tier (funnels: quiz→suggestion→rating, consensus→vote→share) | NEEDS-DECISION | S |
| 7 | **App-Store hardening** | Almost nothing: no /privacy or /terms routes, no 21+ age gate, no health endpoint (only API route is `api/waitlist`), account "deletion" = localStorage clear + signOut (auth-user deletion needs a service-role endpoint; delete-own RLS exists on profiles) | All four items are pure code | CODE-ABLE-NOW | M |
| 8 | **Deploy** | Vercel-linked (`.vercel/project.json`, project `next-bar`), GitHub `cdfeeney/next-bar`. App gracefully no-ops without Supabase (middleware + client). Env names referenced: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, GOOGLE_MAPS_API_KEY, NEXT_PUBLIC_SITE_URL | — | live | — |

## Test footprint (safety net for overnight work)

- **Vitest ~257 / 24 files.** Strong: matching 29, pairwise 44, ratings 47 (incl. server sync), groupVote 15, travelTime 14, freshness 13, openNow 12, intent 8, lists 7, cadence 5.
- **Playwright ~56 / 14 specs**: app-shell 10, auth-page 8, friends-flow 8, rating-and-nav 5, pairwise 4, map 4.
- Thin spots: `quiz.ts`, `saved.ts`, `storedProfile.ts`, places overlay.

## Operator key/decision queue (unchanged items still open)

1. ~~Supabase service-role key~~ ✅ done 2026-07-23 (login unblocked via set-password)
2. Brevo SMTP → Supabase (durable email) — in progress tonight
3. Twilio → Supabase Phone provider (dashboard paste) — account acquired tonight
4. Google Cloud: OAuth client (sign-in) + Places API key (open-now)
5. Analytics accounts (PostHog) / Vercel Analytics toggle
6. Apple Developer $99/yr (App Store path)

## Top 5 CODE-ABLE-NOW (feeds tonight's overnight queue)

1. **D1 social migrations + RLS** — follows/lists/intents/votes tables + friend-readable ratings policy (pattern established in 0001/0002).
2. **Server sync for follows/lists/pairwise** — clone the proven `useRatings` dual-mode merge pattern.
3. **App-Store hardening pack** — /privacy, /terms, 21+ gate, /api/health, account-deletion endpoint (service-role pattern exists in waitlist route).
4. **Web-push scaffolding shipped dark** — SW handlers + subscription plumbing gated by `cadence.ts`, lights up when VAPID/send-infra lands.
5. **Real `u/[handle]` profiles** — profiles-table lookup replacing demo data (after #1).

Blocked overnight regardless: Places refresh run, Google OAuth, analytics wiring — key/decision-gated.
