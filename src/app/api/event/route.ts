import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { clientIpFromHeaders, createIpRateLimiter } from '@/lib/waitlistGuard';
import { ANALYTICS_EVENTS } from '@/lib/analytics';
import { nycNightKey } from '@/lib/nightKey';

/**
 * POST /api/event — privacy-light product-event counter (N4 skeleton,
 * DARK). Design: docs/ANALYTICS-DESIGN.md.
 *
 * SECURITY MODEL (account/delete route precedent):
 *  - 503-dark unless ANALYTICS_ENABLED === '1' AND the service-role key
 *    is configured — the flag flip is the launch switch.
 *  - The service role is the ONLY writer (0018 grants nothing to
 *    anon/authenticated), so there is no client-side RLS surface.
 *  - COUNTER MODEL (security review H1): bump_analytics_event() is an
 *    atomic (name, night) upsert-increment — the table is bounded at 4
 *    rows/night, so a flood can inflate counters (accepted: anonymous
 *    counter, poisoning ≠ compromise) but can never bloat storage.
 *  - The night key is computed SERVER-side (client clocks lie) and the
 *    body carries nothing but the name.
 *  - Per-instance IP token bucket as a flood damper (honest limitation:
 *    per-serverless-instance, not global).
 *  - Cross-origin writes (review M4): a PRESENT Origin header must match
 *    the request host — blocks third-party pages poisoning counts from
 *    browsers. Origin-less clients (curl) are indistinguishable from
 *    beacons and are accepted; the counter model bounds the damage.
 */

const RATE_LIMIT_PER_MINUTE = 60;
const limiter = createIpRateLimiter({
  limit: RATE_LIMIT_PER_MINUTE,
  windowMs: 60 * 1000,
});

export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.ANALYTICS_ENABLED !== '1') {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  if (!limiter.allow(clientIpFromHeaders(request.headers))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  // Review M4: a browser always sends Origin on cross-origin POST/beacon
  // — when present it must match our host.
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return NextResponse.json({ ok: false }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
  }

  let name: unknown;
  try {
    const body = (await request.json()) as { name?: unknown };
    name = body.name;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (
    typeof name !== 'string' ||
    !(ANALYTICS_EVENTS as readonly string[]).includes(name)
  ) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Review M2 (account/delete precedent): transport-level throws
  // (DNS/socket) don't come back as { error } — convert them to the same
  // generic 503 explicitly instead of leaning on framework defaults.
  try {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin.rpc('bump_analytics_event', {
      p_name: name,
      p_night: nycNightKey(),
    });
    if (error) {
      // Unapplied 0018 lands here too — generic error, details in logs.
      console.error('[api/event] bump failed:', error.code, error.message);
      return NextResponse.json({ ok: false }, { status: 503 });
    }
  } catch (err) {
    console.error('[api/event] transport failure:', err);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
