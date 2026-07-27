# Analytics layer — design + decision (N4, night-5 2026-07-27)

**Status: SKELETON AUTHORED, DARK.** No events flow until the operator
(a) applies migration `0018_analytics_events.sql` (AUTHORED, DO NOT
APPLY overnight) and (b) sets `NEXT_PUBLIC_ANALYTICS=1` +
`ANALYTICS_ENABLED=1` in Vercel. Pre-launch gap this closes: we
currently have ZERO signal on whether anyone searches, shares, saves,
or visits.

## Security review outcome (routed security-reviewer, night-5)

- **H1 (unbounded growth) → FIXED by moving to a COUNTER MODEL**: the
  table is `(name, night, count)` with an atomic upsert-increment
  (`bump_analytics_event`) — bounded at 4 rows/night forever; no
  retention job needed. A flood can inflate counters (accepted for an
  anonymous counter — poisoning, not compromise) but never bloat
  storage. Independently corroborated by SCALE-PLAN.md Finding F.
- **M2 → FIXED**: transport-level throws around the Supabase call are
  caught and returned as the same generic 503 (account/delete
  precedent).
- **M4 → MITIGATED**: a PRESENT `Origin` header must match the request
  host (blocks third-party browser pages poisoning counts). Origin-less
  clients (curl) are accepted — undetectable anyway; the counter model
  bounds the damage. Conscious accept.
- **M3 (enum drift) → NOTE**: adding a 5th event name requires a NEW
  migration widening the `analytics_events_name_check` CHECK — a code
  change alone will 503 the new event (safe failure, but silent).
- **L1 (precision)**: "no IP stored" refers to the DB row and logs; the
  in-memory rate limiter necessarily holds the client IP for ≤60s per
  window. Never persisted, never logged.

## Decision: self-rolled counts, not Vercel Analytics (for product events)

| | Vercel Web Analytics | Self-rolled /api/event |
|---|---|---|
| Pageviews | free, zero-code | not the goal |
| Custom events (search/share/save/visit) | **Pro plan ($20/mo)** | free (Supabase rows) |
| Privacy | cookieless | we store NOTHING per-user (below) |
| Query access | dashboard only | SQL |

**Recommendation:** self-rolled for the four product events (free, SQL-
queryable, matches the night-keyed mental model). Vercel Web Analytics
is a fine ADD-ON for pageviews if the operator flips it on in the
dashboard (zero code with the new auto-inject; the `@vercel/analytics`
package is NOT added — no new deps overnight).

## Privacy stance (drives the schema)

A row is a COUNTER `(name, night, count)` — **no user id, no session
id, no IP, no user agent, no bar id**. Aggregate product signal only
("42 searches Friday night"), nothing to disclose in /privacy beyond a
one-line "we count feature usage anonymously" (queued for the morning:
add that line WHEN the flag flips). Deliberately NOT event-sourcing:
if per-user funnels are ever wanted, that's a new consented design.

## Shape

- **`src/lib/analytics.ts`** — `trackEvent('search'|'share'|'save'|'visit')`:
  fire-and-forget `navigator.sendBeacon`/fetch POST to `/api/event`;
  hard no-op unless `NEXT_PUBLIC_ANALYTICS === '1'`. Never throws, never
  blocks UI. Call sites wired in a later pass (keep the skeleton diff
  pure-additive).
- **`src/app/api/event/route.ts`** — POST: 503-dark unless
  `ANALYTICS_ENABLED === '1'` AND the service-role key exists (account-
  delete route precedent); validates name against the 4-event enum;
  computes the night key SERVER-side (client clocks lie); inserts via
  service role. Table grants: **nothing** to anon/authenticated — the
  route is the only writer, which deletes the whole RLS-abuse-surface
  problem. Per-instance token bucket (60/min) as a cheap flood damper —
  honest limitation: per-serverless-instance, not global.
- **`supabase/migrations/0018_analytics_events.sql`** — counter table +
  `bump_analytics_event` atomic increment; revoke-everything from client
  roles, explicit service_role grant. AUTHOR-ONLY tonight.

## Morning checklist

1. Review this doc; if approved: apply 0018 (`apply-one-migration` ×2).
2. Set `ANALYTICS_ENABLED=1` (Vercel server env) + `NEXT_PUBLIC_ANALYTICS=1`.
3. Add the /privacy one-liner when flipping the flag.
4. Wire `trackEvent` call sites (search submit, share taps, want-to-go
   saves, visit records) — kept out of the skeleton PR so the flag flip
   is the only behavior change to review.
5. Optional: enable Vercel Web Analytics in the dashboard for pageviews.
