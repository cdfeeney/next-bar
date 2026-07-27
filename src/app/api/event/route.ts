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
 *  - A row is (name, night) — the night key is computed SERVER-side
 *    (client clocks lie) and the body carries nothing but the name.
 *  - Per-instance IP token bucket as a flood damper (honest limitation:
 *    per-serverless-instance, not global).
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

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin
    .from('analytics_events')
    .insert({ name, night: nycNightKey() });
  if (error) {
    // Unapplied 0018 lands here too — generic error, details in logs.
    console.error('[api/event] insert failed:', error.code, error.message);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
