# PACKET — 20,000-concurrent capacity architecture + load-harness design — 2026-08-05 (goal g-9b97c22d)

Design packet only. **No load is generated under this goal, against
anything.** Every number below is either repo-traceable (cited) or marked
**UNKNOWN** with the measurement that would establish it. Nothing here is
capacity *proof* — the harness section designs how proof would be produced
later, against localhost only.

## Load model (from real features, not hypotheticals)

Peak scenario: NYC weekend night, 20,000 concurrent users, session shape =
open app → find a bar → occasional social writes. Rates are per-feature
derivations; absolute concurrency-to-rps conversion is UNKNOWN until the
harness measures real session traces.

**Reads (dominant):**
- **Catalog fetch — the hot path.** Every open with Supabase configured
  pages the full `bars` table via PostgREST (`CatalogRefresh`, 1,000-row
  pages, explicit column list after the 833KB→smaller fetch fix; ~1,256
  Production rows today → 2 pages/open). 20k opens across a 30-min peak ≈
  ~11 opens/sec ≈ ~22 PostgREST requests/sec of few-hundred-KB responses.
  Well within PostgREST throughput, but it is pure per-user duplication of
  identical public data — the single biggest, cheapest win is removing it
  from the DB path entirely (options below).
- Bar reviews on demand (`lib/barReviews`, one bar at a time — deliberate,
  cited in CatalogRefresh comments); photos via stored URLs; map tiles hit
  the carto CDN, not our infra.
- Social reads: rankings/profiles/follows/suggestions via RLS-checked REST
  + definer RPCs; per-user, low rate, cacheable-none (auth-scoped).
- Auth: `getUser` revalidation is throttled to once per 5 min per client
  (`useAuth.ts`, REVALIDATE_MIN_INTERVAL_MS) — deliberate load shaping
  already in the code; opens still cost a session read.

**Writes (user-action rate, low):** ratings/pairwise, follows, RSVPs, vibe
votes, shares, want-to-go — all RPC/RLS-guarded single-row writes. Even at
20k concurrent, sustained writes are O(tens/sec) because they follow human
actions, not timers. **No polling writers exist; the app has NO Supabase
realtime usage at all (verified: zero `realtime`/`channel(` references in
src) — one entire scaling dimension is absent by design.**

## Bottleneck analysis (ranked)

1. **Catalog read amplification** (above) — also the main *egress cost*
   line, not just latency.
2. **PostgREST/pooler connections.** supabase-js speaks HTTP to PostgREST —
   the app never holds raw Postgres connections (the repo's only raw-`pg`
   user is the migration runner, operator-side). So the ceiling is
   PostgREST worker throughput + its pool, sized by the Supabase compute
   tier. Current tier's ceiling: UNKNOWN — measure via Supabase dashboard
   under harness load; upgrade path is a console knob, not an architecture
   change.
3. **RLS query cost.** Every social read/write evaluates RLS predicates;
   the schema's policies are per-row subqueries against small tables
   (follows, members) with PK/index access. Cost at depth: UNKNOWN until
   `EXPLAIN ANALYZE` under load; the design lever (if ever needed) is the
   security-definer RPC pattern the repo already prefers, which centralizes
   and indexes the check.
4. **GoTrue (auth) request rate.** Sign-in bursts + refresh churn. The
   5-min revalidation throttle caps steady-state; cold-open bursts are
   UNKNOWN and measured by the harness's session-open scenario.
5. **Vercel serverless/edge.** The app surface is mostly static/client;
   only 4 API routes exist — `api/account/delete`, `api/event`,
   `api/health`, `api/waitlist` (the ADR §3 enumeration, verified against
   src/app/api; santa: Fable + Codex both caught the earlier muddled
   inventory) — plus `auth/callback` and the SEPARATE edge-runtime
   metadata routes (icon, apple-icon, five opengraph-image files). None
   is on the 20k hot path; OG images are edge-runtime and CDN-cached. Cold-start
   impact: negligible for the read path (no server round-trip to render
   the picker — the static bundled catalog is the synchronous fallback).
6. **What does NOT exist to scale:** no websockets, no realtime broadcast,
   no server-held sessions, no cron fan-out. The pin feature (0038 draft)
   and Crews would add write surfaces later — each ships with its own
   capacity note when it lands (deliberately out of this packet's model).

## Scaling options (tradeoffs, in order of leverage)

1. **Serve the catalog from the CDN, not PostgREST.** Route the paged
   catalog read through a Next.js route/ISR artifact with
   `s-maxage`+`stale-while-revalidate` (or a build-time snapshot + the
   existing deferred-swap client path). Removes the dominant read from the
   DB entirely; the app already tolerates catalog staleness by design
   (static fallback + swap). Tradeoff: freshness window (minutes), one new
   cache-invalidation concern on import batches. **Recommended first.**
2. **Supabase compute upgrade + pooler tuning.** Console-level; raises
   ceilings 2–4× without code. Tradeoff: cost; doesn't fix amplification.
3. **Read replica for REST reads** (Supabase read replicas). Only if
   social-read volume — not catalog — becomes the bottleneck; adds
   replica-lag semantics to social surfaces. Not justified by current mix.
4. **Client-side backoff + jitter on the catalog swap** (spread the
   thundering herd of a viral spike). Cheap, complements #1.
5. **Not proposed:** queueing writes (write rate doesn't warrant it),
   sharding, or any realtime infrastructure.

## Measurement plan

- SLOs to certify at 20k-equivalent load: p95 catalog-path TTI unaffected
  by Supabase latency (static fallback guarantee), p95 social read <500ms,
  p95 write <800ms, error rate <1%, zero pooler exhaustion events.
- Sources: Supabase dashboard (connections, PostgREST latency, egress),
  Vercel analytics (route latency), harness-side percentiles. PostHog
  stays OFF (g-ee6c250d posture) — measurement is infra-side, not
  user-telemetry.

## Load-harness DESIGN (localhost-only by construction)

A small node script (`scripts/load-harness/` when implemented — nothing
ships tonight), no external SaaS, no new production code paths:

- **Target lock, fail-closed:** the harness constructor parses its target
  URL and **refuses to construct** unless the resolved hostname is
  `localhost`, `127.0.0.1`, or `::1` — a superset of the e2e fence allowlist
  (`localhost,127.0.0.1` in playwright.config.ts, plus `::1` here for
  IPv6-default systems — santa: Fable). The check is in the
  constructor, not the call site, so no scenario file can point it at
  Staging/Production even by typo; a unit test asserts construction throws
  for every non-loopback shape (hostname, IP). **Redirects are a request-
  layer concern the constructor cannot see** (santa: Codex): the harness
  never follows a redirect AUTOMATICALLY — each 30x is recorded, its
  Location validated against the same loopback allowlist, and only then
  chained as an explicit next request (santa round-2: Codex — blanket-
  terminal 30x would make the auth/callback flow untestable, and that
  flow is in the shaped-run scope), so a non-loopback Location dead-ends
  with a recorded violation instead of pulling traffic off-box. Additionally the
  harness process sets the fence proxy env (the dev-server pattern from
  `playwright.config.ts`) so even accidental absolute URLs in app
  responses cannot escape loopback.
- **Scenarios derived from the load model:** `open-burst` (N sessions/sec
  executing the catalog page sequence), `social-steady` (mixed authed
  reads/writes against seeded fixture accounts via the loopback fixtures),
  `auth-burst` (sign-in + revalidation churn), and
  `notification-viral-open` (santa: DeepSeek — the cadence send itself
  DRIVES correlated opens: every recipient taps the same shared venue
  near-simultaneously, so this scenario runs pre-warmed pages with COLD
  `/_next/image` optimization routes and gates on the LOCAL optimizer's measured cold-serve latency and
  concurrency cost — **the CDN cache-hit ratio itself is a
  PRODUCTION-observation gate (dashboard, during a real ramp), not a
  harness output; localhost has no CDN to measure** (santa round-2:
  Codex) — because image-optimization cold fan-out multiplies the read
  amplification the model ranks first). Mix ratios come from the
  read/write model above and are config, not code. The shaped local-stack
  run exercises ALL enumerated surfaces — the four API routes and the
  edge OG/image routes included, not only the catalog path (santa: GLM).
- **Local target:** `next start` (production build) + either the loopback
  catalog fixtures or a local Supabase stack; NEVER a shared environment.
  Measuring PostgREST/RLS ceilings specifically requires a local Supabase
  (docker) — marked ATTENDED/deferred; absent that, the harness certifies
  the app-layer + fallback behavior only, and SAYS so in its report.
- **Output:** percentile table + error taxonomy per scenario, emitted as a
  dated doc. A run that cannot prove its target was loopback aborts rather
  than reporting.

## Explicit honesty section

- Nothing in this packet is measured; every number marked UNKNOWN stays
  UNKNOWN until the harness runs.
- No mocked or localhost result will ever be presented as Production
  capacity proof — localhost certifies code behavior (fallbacks, backoff,
  amplification factors), not Supabase tier ceilings; those need the
  ATTENDED local-Supabase run plus dashboard observation under real
  traffic ramps.
- **What localhost can NEVER reproduce** (consult: DeepSeek — the named
  blind spot): connection-level behavior under real network conditions —
  pool saturation at 10–50ms RTT, TLS handshake storms from cold-start
  bursts, keep-alive races, head-of-line blocking under packet loss.
  Localhost RTT is microseconds; those failure modes are structurally
  invisible. Consequently the **local-Supabase (docker) run is REQUIRED
  before any capacity go/no-go claim, not optional**, and it must inject
  realistic network conditions (e.g. `tc`: ~50ms latency, ~0.5% loss,
  mobile-edge bandwidth caps) so pool and retry behavior is exercised,
  not just query shape. The harness's own loopback lock is a footgun
  guard, not a security boundary — both facts stated so no reader
  upgrades them.

## Dedup

- APNs transport: `docs/PACKET-APNS-2026-08-05.md` (this goal's sibling).
- TestFlight/shell architecture: `g-39169b3b` ADR (base, not duplicated).
- Crews capacity: excluded here; ships with the Crews implementation.
