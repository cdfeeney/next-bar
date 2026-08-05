import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  clientIpFromHeaders,
  createRateLimiter,
  isValidWaitlistEmail,
  normalizeEmail,
  sanitizeNeighborhood,
  sanitizeVibeProfile,
} from '@/lib/waitlistGuard';
import type { VibeProfile } from '@/types';

/**
 * POST /api/waitlist — hardened per audit MED-23 (H1):
 *   - email shape-validated + normalized; junk never reaches the DB
 *   - per-IP in-memory rate limit (module-scoped: per warm instance)
 *   - GENERIC error responses — the previous error.message passthrough
 *     leaked Postgres/RLS internals to callers, and a unique-violation
 *     reply doubled as an email-existence oracle. A duplicate email now
 *     reads as plain success (idempotent join).
 */

type WaitlistPayload = {
  email?: unknown;
  neighborhood?: unknown;
  vibe_profile?: VibeProfile | null;
};

const RATE_LIMIT_PER_HOUR = 10;
const limiter = createRateLimiter({
  limit: RATE_LIMIT_PER_HOUR,
  windowMs: 60 * 60 * 1000,
});

/** Postgres unique_violation — an already-joined email, not a failure. */
const UNIQUE_VIOLATION = '23505';

export async function POST(request: Request): Promise<NextResponse> {
  if (!limiter.allow(clientIpFromHeaders(request.headers))) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429 },
    );
  }

  let body: WaitlistPayload;
  try {
    body = (await request.json()) as WaitlistPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 },
    );
  }

  if (!isValidWaitlistEmail(body.email)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_email' },
      { status: 400 },
    );
  }

  const email = normalizeEmail(body.email);
  const neighborhood = sanitizeNeighborhood(body.neighborhood);
  const vibeProfile = sanitizeVibeProfile(body.vibe_profile);

  if (supabase) {
    const { error } = await supabase
      .from('waitlist')
      .insert({ email, neighborhood, vibe_profile: vibeProfile });

    if (error && error.code !== UNIQUE_VIOLATION) {
      // Generic on purpose: DB internals stay server-side (MED-23). The
      // detail goes to the server log where it belongs.
      console.error('[waitlist] insert failed:', error.code, error.message);
      return NextResponse.json(
        { ok: false, error: 'server_error' },
        { status: 500 },
      );
    }
  } else {
    console.log('[waitlist]', { email, neighborhood });
  }

  return NextResponse.json({ ok: true });
}
