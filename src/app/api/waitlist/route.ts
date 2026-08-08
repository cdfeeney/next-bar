import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  clientIpFromHeaders,
  isValidWaitlistEmail,
  normalizeEmail,
  sanitizeNeighborhood,
} from '@/lib/waitlistGuard';
import { guardOrigin, readBoundedJson } from '@/lib/requestBoundary';
import { createTieredLimiter } from '@/lib/rateLimiter';
import {
  durableCounterFromEnv,
  rateLimitSaltFromEnv,
} from '@/lib/rateLimiter.durable';
import { parseWaitlistVibeProfile } from '@/lib/vibeProfileSchema';

/**
 * POST /api/waitlist — hardened per audit MED-23 (H1):
 *   - email shape-validated + normalized; junk never reaches the DB
 *   - per-IP rate limit — now shared across instances (Item 10), no longer
 *     one window per warm serverless instance
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

/**
 * DURABLE (Item 10). Per-instance counting meant the real cap was
 * `10 x warm instances`; the shared counter makes it 10.
 *
 * FAIL-OPEN, and this is a RECORDED DEVIATION from Item 10's acceptance
 * criterion, which said "fail-closed on the shared store, local limiter as
 * backstop" for this route. Flagged in review; kept deliberately, with the
 * reasoning corrected rather than the deviation hidden:
 *
 *  - The quota protects list quality, not an irreversible action, and the
 *    local backstop still caps damage at the old `limit x instances` — so
 *    fail-open is bounded, never unlimited (pinned by
 *    `route.failopen.test.ts`).
 *  - It is what makes the rollout safe. `RATE_LIMIT_KEY_SALT` is the
 *    activation switch; if it is set before migration 0043 is applied, every
 *    durable call errors. Under literal fail-closed that would 429 EVERY
 *    signup for the length of that window.
 *  - Honest limit on the benefit, which an earlier draft of this comment
 *    overstated: the rate-limit store and the waitlist INSERT are the same
 *    Supabase Postgres, so in a true database outage the insert fails anyway.
 *    Fail-open genuinely helps only for RPC-specific failures — an unapplied
 *    migration, the 1.5s timeout, a revoked grant — not for "the database is
 *    down".
 *
 * The contrast to hold onto: `/api/account/delete` is fail-CLOSED and must
 * stay that way. Uniformity between these two routes would be a bug.
 */
const RATE_LIMIT_PER_HOUR = 10;
const limiter = createTieredLimiter({
  bucket: 'waitlist-ip',
  limit: RATE_LIMIT_PER_HOUR,
  windowMs: 60 * 60 * 1000,
  durable: durableCounterFromEnv(),
  salt: rateLimitSaltFromEnv(),
  onDegraded: 'fail-open',
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

  if (!(await limiter.consume(clientIpFromHeaders(request.headers))).allowed) {
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
