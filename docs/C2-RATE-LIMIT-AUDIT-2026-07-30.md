# API rate-limit audit — 2026-07-30

Audit only. No production behaviour was changed. Every claim cites a file and,
where a claim rests on a specific line, a line number.

**Scope:** every route under `src/app/api`. Route and method list was re-derived
mechanically, not taken from any prior document — and that mattered: the
`MASTER-TODO:146` claim that "only `account/delete` and `waitlist` have it today"
is **wrong**. `event` has had a limiter all along.

---

## 1. The matrix

| Route | Method | Auth | Kind | Limiter | Key | Window / limit | On limiter exhaustion | Tests |
|---|---|---|---|---|---|---|---|---|
| `api/account/delete` | POST | **Bearer token**, verified against Supabase (`:67-72`, 401 otherwise) — but **limiter runs first, at `:50`** (F1) | destructive mutation | yes (`:29-32`) | client IP | **5 / hour** | fail **closed** | unit |
| `api/waitlist` | POST | **none** (public) | mutation (insert) | yes (`:29-32`) | client IP | **10 / hour** | fail **closed** | **none** |
| `api/event` | POST | **none** (public), same-origin check | mutation (counter bump) | yes (`:30-33`) | client IP | **60 / minute** | fail **closed** | **none** |
| `api/health` | GET | **none** (public) | read | **no** (F7) | — | — | — | e2e + prod-smoke |

That is the entire application API surface: four `route.ts` files, one exported
method each. No `PUT`/`PATCH`/`DELETE`/`OPTIONS`/`HEAD` handler is **exported**
anywhere — but see F9: Next.js answers `HEAD` from `GET` without app code, so
this table describes what the app exports, not every method the platform serves.

`src/middleware.ts` applies **no** rate limiting, but it is not inert: it runs
`supabase.auth.getUser()` on every `/api/*` request, *before* any route limiter
can act. See F1b for what that does and does not cost.

---

## 2. How the limiter actually works

All three limiters are the same `createIpRateLimiter` from
`src/lib/waitlistGuard.ts:101`. Reading it rather than assuming:

- **Fixed-window, in-memory `Map`**, created at module scope in each route.
- **Hard memory cap**: `MAX_BUCKETS = 10_000`. On a new-window insert it prunes
  expired buckets, and if the map is *still* full it **rejects the new IP**
  (`:126-128`). The comment is right that this is the correct trade: "an
  untracked new IP must not become an untracked unlimited IP".
- **Fail-closed** is therefore the behaviour under memory pressure. That is the
  opposite of the usual in-memory-limiter failure mode and is the best thing
  about this implementation — **but it is a two-edged property**, see F8. An
  earlier draft praised it without noting the trade.
- **Key** is `clientIpFromHeaders` (`:79`): first hop of `x-forwarded-for`, else
  `x-real-ip`, else the literal string `'unknown'`.

---

## 3. Findings, most severe first

### F1 — HIGH · Pre-auth quota poisoning locks a user out of deleting their account
`src/app/api/account/delete/route.ts:50` (limiter) vs `:67-72` (auth)

The rate limiter runs at line 50. The Bearer token is not read until line 67 and
not verified until after that. So **unauthenticated** requests consume the IP
budget: five anonymous `POST`s from an address burn that address's entire 5/hour
allowance, all returning 401, and the legitimate user behind that IP then gets
429 for the rest of the hour when they try to delete their own account.

This is reachable cross-origin — a simple `POST` needs no preflight and the
attacker never has to read the response — and it is worse behind NAT, where one
sender poisons every user sharing the egress IP.

*Fix:* two-stage. Keep a coarse pre-auth IP bound to protect the token-verification
path itself, then apply the real 5/hour quota **after** verification, keyed by the
verified `user.id` (which also fixes F3).

### F1b — MEDIUM · A forged cookie turns the unlimited route into a Supabase amplifier
`src/middleware.ts:39` and `:44-50`

`await supabase.auth.getUser()` runs on every request matching
`matcher: ['/auth/:path*', '/settings/:path*', '/api/:path*']`, and the only
early return is the missing-env-var guard at `:19`. Middleware runs **before**
route handlers, so no per-route limiter can gate it.

**Measured, because the first draft of this finding was wrong.** I claimed every
such request produces an outbound Supabase call. It does not — `getUser()`
short-circuits locally when there is no session. Instrumenting `fetch` around
`createServerClient` gave:

| Request | Outbound calls |
|---|---|
| no cookie | **0** |
| fabricated `sb-<ref>-auth-token` cookie | **1** → `/auth/v1/user` |

So ordinary anonymous traffic costs nothing. The finding survives in a narrower,
still-real form: an attacker attaches **one forged auth cookie** — no valid
credential needed, the token is rejected 401 *after* the round trip — and every
request to the **unlimited** `/api/health` (F7) then forces an uncached Supabase
auth call. Route limiters cannot help, because middleware precedes them; and on
the limited routes a 429'd request has already paid for the round trip.

Downgraded from HIGH to MEDIUM: it needs a deliberately crafted request rather
than being incurred by all traffic. It stays a genuine finding because the
trigger is one header, the amplification is 1:1 and uncached, and nothing in the
application can throttle it.

*Fix:* narrow the matcher so routes that never read a session are excluded —
`/api/health`, `/api/waitlist` and `/api/event` are all unauthenticated — or
return early inside the middleware for those paths before constructing the
client.

### F2 — MEDIUM · `x-forwarded-for` trust is correct today but fragile by construction
`src/lib/waitlistGuard.ts:79-86`

`clientIpFromHeaders` takes the **first** hop of `x-forwarded-for`, an ordinary
client-settable header. That is safe **only** because something upstream
overwrites it — and this deployment does: `.vercel/project.json` exists, and
`docs/NIGHTLOG-2026-07-25.md:39` records a live post-deploy smoke against
`https://next-bar-two.vercel.app` with GitHub↔Vercel auto-deploy confirmed.
Vercel replaces the header, so header rotation does **not** mint fresh buckets
today.

An earlier draft of this audit rated this a live HIGH bypass on the grounds that
the platform was unverifiable from the repository. That was wrong — the evidence
above is in the repo, and review caught it. Recorded rather than quietly amended,
because the mistake is instructive: the severity of this finding is entirely a
property of the deployment, not the code.

It remains a real finding at MEDIUM because the safety is **implicit**. Nothing
in the code asserts the assumption, so it breaks silently if the app is ever
self-hosted, moved behind a different proxy, or reached directly at its origin.

*Fix:* make the assumption explicit — prefer a hop the client cannot set
(`request.ip`, or Vercel's `x-vercel-forwarded-for`) and fall back to XFF only
with a comment naming the trust requirement.

### F3 — HIGH · `account/delete` is limited by IP, not by user
`src/app/api/account/delete/route.ts:29-32, 67-72`

This route authenticates a Bearer token and deletes **the caller's own** account.
It has a verified user id available, yet the limiter keys on IP. Consequences
both ways:

- Several users behind one NAT/campus/VPN egress share one 5/hour budget, so one
  user's retries can lock out others.
- Conversely, one user rotating IPs (or spoofing XFF, were F2 ever to break) is unlimited.

*Fix:* key this route on the verified `user.id` — it is already in hand after
token verification, needs no header trust, and is exactly the identity the limit
is meant to bound. Keep an IP limit as a coarse outer bound if desired.

### F4 — MEDIUM · Limits are per warm instance, not per deployment
`src/app/api/waitlist/route.ts:16` states it outright: "per-IP in-memory rate
limit (module-scoped: per warm instance)".

The `Map` lives in module scope, so each serverless instance keeps its own
counters. Effective capacity is therefore `limit × instance count`, and every
redeploy or cold start resets everything. With N warm instances the real waitlist
cap is `10 × N` per hour, not 10.

*Fix:* a shared store (Postgres table, Upstash/Redis) for anything where the
number genuinely matters. Note the repo already has the precedent —
`handle_claim_attempts` / `handle_search_attempts` / `follow_attempts` are
database-backed rate-limit tables (migrations `0006`, `0007`), so a durable
pattern exists in-project and these routes simply do not use it.

### F5 — MEDIUM · `'unknown'` is one shared bucket
`src/lib/waitlistGuard.ts:85`

All traffic with no XFF and no `x-real-ip` collapses into a single bucket keyed
`'unknown'`. The comment calls this "strict for abusers, harmless for the normal
path", which holds only while such traffic is rare. If a real client population
ever arrives header-less, they collectively get 10 waitlist inserts per hour and
throttle each other. Worth a metric before it is worth a fix.

### F6 — MEDIUM · Two of four routes have no test at all
- `account/delete` — unit-tested (`src/app/api/account/delete/route.test.ts`).
- `health` — covered end-to-end by `e2e/app-store-pack.spec.ts:96,100` and
  `e2e-prod/prod-smoke.spec.ts:71`. An earlier draft of this audit said health
  had no coverage; that was wrong, and review caught it.
- `waitlist` and `event` — **no test of any kind.**

`src/lib/waitlistGuard.test.ts` covers the limiter *primitive*, so the algorithm
is tested. What no test asserts anywhere is that a **route** returns 429 when its
budget is exhausted, that `event`'s same-origin check rejects a foreign origin,
or that the `ANALYTICS_ENABLED` gate holds. Those are exactly the behaviours this
audit's matrix depends on, and they are unguarded.

### F7 — MEDIUM · `health` is unlimited AND its probe cache does not de-duplicate
`src/app/api/health/route.ts`

No limiter, and `dynamic = 'force-dynamic'` so it is never statically served.
It caches its Supabase probe for `PROBE_CACHE_TTL_MS = 30_000` with a 3 s timeout.

**That cache does not de-duplicate in-flight probes.** `cachedProbe` is assigned
only *after* `await fetch` resolves, so every request arriving during a cold start
or immediately after expiry sees `cachedProbe` as null and starts its own fetch. A
burst of N concurrent requests therefore produces N outbound calls to Supabase,
and each warm instance repeats that independently.

An earlier draft of this audit claimed "at most two probes per minute regardless
of request volume". That is **false**, and review caught it. The accurate
description is *sequential-hit* caching: it collapses serial traffic, not
concurrent traffic — which is precisely the traffic shape an unlimited public
endpoint invites.

*Fix:* single-flight — cache the in-flight promise, not just the settled value,
so concurrent callers await one fetch.

I still do **not** recommend an application rate limit on this route: a health
endpoint that throttles itself is worse than useless to an uptime checker. The
amplification, not the request volume, is the part worth fixing.

---

## 4. Prioritised remediation

| # | Action | Why in this order |
|---|---|---|
| 1 | Move the `account/delete` quota **after** auth and key it on `user.id` (F1 + F3) | One change fixes both. It is the finding an attacker can use today, on the current deployment, to deny a real user a destructive action they are entitled to. |
| 2 | Add route tests asserting the 429 paths, `event`'s origin check, and the analytics gate (F6) | Cheap, and stops 1 from silently regressing. `waitlist` and `event` have no test at all. |
| 3 | Single-flight the health probe (F7) | Removes outbound amplification on the one unlimited public route. |
| 4 | Narrow the middleware matcher (F1b) — then make the XFF trust assumption explicit (F2) | Correct today on Vercel; this stops it breaking silently if the deployment ever moves. |
| 5 | Move counters to a shared store (F4) | Only bites with more than one warm instance; the DB-backed pattern already exists in-project. |
| 6 | Instrument `'unknown'` bucket volume (F5) | Measure before fixing. |

**No rate limits were implemented in this audit** — that was explicitly out of
scope for this item.

---

## 5. Adjacent surface — NOT audited here

- **Client-callable RPCs bypass `src/app/api` entirely.** `0013_unrsvp_rpc.sql`
  and the `security definer` functions across 14 migrations are reachable
  directly from the browser via PostgREST. Some carry their own caps —
  `search_handles` has a 500/day cap (`0006`), and the `*_attempts` tables exist
  precisely for this — but the rate-limit posture of that surface belongs to the
  RLS audit (C3), not here. Naming it so it is not mistaken for covered.

---

## 6. UNVERIFIED — operator-only

1. **Whether a platform rate limiter (Vercel WAF / firewall rules) is configured
   in the dashboard.** That the app runs on Vercel *is* established from the repo
   (`.vercel/project.json`, and the recorded prod smoke in
   `docs/NIGHTLOG-2026-07-25.md:39`), which settles the header-trust question in
   F2 — but whether any additional platform-level throttling exists is dashboard
   state and cannot be read here.
2. **How many warm instances run in practice**, which sets the real multiplier in
   F4.
3. **Whether the origin is reachable directly**, bypassing the Vercel edge. If it
   is, F2 returns to HIGH.

### F8 — MEDIUM · Fail-closed is also a denial lever
`src/lib/waitlistGuard.ts:120-131`

§2 credits the limiter for rejecting new IPs once `MAX_BUCKETS = 10_000` live
buckets are held. That is right for bounding memory — but read from the other
side, it is a way to deny service to everyone else.

An attacker who can present 10,000 distinct keys within one window fills the map.
From then until buckets expire, **every genuinely new IP is refused** with a 429
on that instance, because `buckets.has(ip)` is false and the map is full. On
`waitlist` the window is an hour, so one burst can lock out new signups from that
instance for up to an hour.

Whether the keys can be produced cheaply depends entirely on F2: on Vercel today
they cannot be spoofed via a header, so this needs 10k real source addresses
(botnet-scale, not trivial). If the XFF assumption ever breaks, the same request
that gains unlimited buckets also gains this denial for free — the two findings
compound.

Not a reason to remove the cap. It is a reason to (a) size `MAX_BUCKETS` against
expected legitimate concurrency, and (b) prefer the durable per-user keying in F3
for anything where lockout matters.

### F9 — LOW · The method table is not quite the whole surface
§1 says no `HEAD`/`OPTIONS` handler exists, so those return 405. That is true of
*app code*, but Next.js serves `HEAD` automatically for any route exporting
`GET`, so `/api/health` answers `HEAD` requests without app involvement — and
that path shares F1b's middleware cost. The matrix describes what the app
exports; it should not be read as the complete set of methods the platform will
answer.
