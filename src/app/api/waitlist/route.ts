import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  clientIpFromHeaders,
  createRateLimiter,
  isValidWaitlistEmail,
  normalizeEmail,
  sanitizeNeighborhood,
} from '@/lib/waitlistGuard';
import { guardOrigin, readBoundedJson } from '@/lib/requestBoundary';
import { parseWaitlistVibeProfile } from '@/lib/vibeProfileSchema';

/**
 * POST /api/waitlist — hardened per audit MED-23 (H1):
 *   - email shape-validated + normalized; junk never reaches the DB
 *   - per-IP in-memory rate limit (module-scoped: per warm instance)
 *   - GENERIC error responses — the previous error.message passthrough
 *     leaked Postgres/RLS internals to callers, and a unique-violation
 *     reply doubled as an email-existence oracle. A duplicate email now
 *     reads as plain success (idempotent join).
 *
 * Item 9 added the request boundary this route never had. It is the only
 * unauthenticated WRITE surface in the app, and it used to call
 * `request.json()` with no cap of any kind, so one request could buffer an
 * arbitrary body into the function. Checks now run in the shared order
 * documented in `@/lib/requestBoundary`: origin → rate limit → Content-Length
 * → bounded read → strict parse.
 */

type WaitlistPayload = {
  email?: unknown;
  neighborhood?: unknown;
  vibe_profile?: unknown;
};

const RATE_LIMIT_PER_HOUR = 10;
const limiter = createRateLimiter({
  limit: RATE_LIMIT_PER_HOUR,
  windowMs: 60 * 60 * 1000,
});

/**
 * Generous next to the real payload (a 254-char email, a 40-char
 * neighborhood, and a shape-bounded profile) and still small enough that a
 * flood cannot buffer anything meaningful per request.
 */
const MAX_BODY_BYTES = 4_096;

/** Postgres unique_violation — an already-joined email, not a failure. */
const UNIQUE_VIOLATION = '23505';

export async function POST(request: Request): Promise<NextResponse> {
  // FIRST, before the limiter. A cross-origin request must not be able to
  // spend the quota belonging to the IP it was forged from — see the check
  // order rationale in `@/lib/requestBoundary`.
  //
  // Strict by default: an ABSENT Origin is rejected too, and no `allowAbsent`
  // exception is claimed. Browsers send Origin on every POST, and on HTTPS an
  // intermediary cannot strip a header without terminating TLS, so the
  // realistic population that lands here is scripted abuse rather than real
  // signups. That makes it a cheap bot filter on the only unauthenticated
  // write surface in the app — which is the actual threat here, since an
  // anonymous session-less route has no CSRF to defend against.
  const blocked = guardOrigin(request.headers, () =>
    NextResponse.json({ ok: false, error: 'forbidden_origin' }, { status: 403 }),
  );
  if (blocked) return blocked;

  if (!limiter.allow(clientIpFromHeaders(request.headers))) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429 },
    );
  }

  const read = await readBoundedJson(request, MAX_BODY_BYTES);
  if (read.kind === 'too-large') {
    return NextResponse.json(
      { ok: false, error: 'payload_too_large' },
      { status: 413 },
    );
  }
  if (read.kind === 'stream-error') {
    // The client went away mid-body. Their problem, not a server fault —
    // 400, never an unhandled 500.
    return NextResponse.json(
      { ok: false, error: 'invalid_body' },
      { status: 400 },
    );
  }
  if (read.kind === 'invalid-json') {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 },
    );
  }
  const body = (read.value ?? {}) as WaitlistPayload;

  if (!isValidWaitlistEmail(body.email)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_email' },
      { status: 400 },
    );
  }

  const email = normalizeEmail(body.email);
  const neighborhood = sanitizeNeighborhood(body.neighborhood);
  const vibeProfile = parseWaitlistVibeProfile(body.vibe_profile);

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
