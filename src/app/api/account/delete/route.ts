import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { clientIpFromHeaders, createRateLimiter } from '@/lib/waitlistGuard';

/**
 * POST /api/account/delete — H2 (N3): delete the CALLER's auth user.
 * Deleting auth.users cascades through profiles (0001: on delete cascade)
 * into ratings, comparisons, follows, follow_requests — everything.
 *
 * SECURITY MODEL (blueprint: api/waitlist + set-password.mjs pattern):
 *   - SUPABASE_SERVICE_ROLE_KEY is read server-side from env ONLY. It has
 *     no NEXT_PUBLIC_ prefix, so Next.js can never bundle it client-side.
 *   - The target of deletion is NEVER taken from the request body. The
 *     caller proves who they are with their own access token
 *     (Authorization: Bearer), the token is verified against Supabase
 *     auth, and the verified user id is the ONLY id that can be deleted —
 *     you can delete yourself, nobody else.
 *   - Generic error responses; details stay in server logs (MED-23 rule).
 *   - TWO-STAGE rate limit (C2 audit F1 + F3). Deletion is destructive and
 *     needs no retries, but the quota must bound the ACCOUNT, not the wire:
 *       stage 1 — a coarse per-IP bound charged ONLY to attempts that fail
 *         verification, checked with a NON-consuming peek so a legitimate
 *         delete never spends the shared bucket. Previously the 5/hour IP
 *         limiter ran before auth, so five anonymous POSTs (no preflight
 *         needed, reachable cross-origin) burned an address's whole budget
 *         and locked the real user behind that NAT out of deleting their
 *         own account for the rest of the hour.
 *       stage 2 — the real 5/hour quota, keyed on the VERIFIED user id.
 *         That identity cannot be rotated or spoofed, so it neither leaks
 *         across users sharing an egress IP nor evaporates when one user
 *         changes address.
 *     RESIDUAL, stated honestly: stage 1 must decide before the token can
 *     be verified, so an attacker willing to send 20 forged-token POSTs an
 *     hour can still 429 one address. That is the price of bounding
 *     outbound amplification, and it is strictly narrower than the old
 *     behaviour (five token-less POSTs, and every legitimate delete also
 *     spending the shared bucket). The durable fix is C2 F4 — move these
 *     counters to a shared store; the repo already has the pattern in
 *     handle_claim_attempts / follow_attempts.
 *
 * UNATTENDED SAFETY GATE (nightlog rule 10, DeepSeek/Codex review): under
 * LOOP_UNATTENDED=1 this route refuses outright — the overnight loop (and
 * any dev/e2e server it spawns, which inherits the env) must never be able
 * to execute a service-role deletion against live auth, stubs or no stubs.
 * The morning operator runs without the flag and the route goes live.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Stage 2 — the real quota. One account, five deletions an hour. */
const DELETES_PER_USER_PER_HOUR = 5;
const userLimiter = createRateLimiter({
  limit: DELETES_PER_USER_PER_HOUR,
  windowMs: HOUR_MS,
});

/**
 * Stage 1 — coarse bound on attempts that never proved an identity. Set
 * well above the real quota because it is a flood damper for the
 * token-verification path, not a user-facing limit: no legitimate client
 * ever charges it.
 */
const UNVERIFIED_ATTEMPTS_PER_IP_PER_HOUR = 20;
const unverifiedIpLimiter = createRateLimiter({
  limit: UNVERIFIED_ATTEMPTS_PER_IP_PER_HOUR,
  windowMs: HOUR_MS,
});

function rateLimited(): NextResponse {
  return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
}

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.LOOP_UNATTENDED === '1') {
    // Hard-closed while an unattended loop owns this process tree. Logged
    // loudly (DeepSeek review): if this flag ever leaks into a production
    // deployment it silently denies users their deletion right — the log
    // line is what makes that misconfiguration findable.
    console.error(
      '[account/delete] refused: LOOP_UNATTENDED=1 — unattended safety gate. ' +
        'If this is production, this env var must be removed.',
    );
    return NextResponse.json(
      { ok: false, error: 'unavailable' },
      { status: 503 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    // Not configured on this deployment — an honest 503, not a crash.
    return NextResponse.json(
      { ok: false, error: 'unavailable' },
      { status: 503 },
    );
  }

  // Stage 1, gate: PEEK, never consume. A caller holding a valid token must
  // be able to delete their account even from an address someone else has
  // already flooded, so only the failure paths below charge this bucket.
  const ip = clientIpFromHeaders(request.headers);
  if (!unverifiedIpLimiter.peek(ip)) return rateLimited();

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    // NOT charged: a token-less POST costs us no outbound call, and stage 1
    // exists to bound that cost. Charging free requests would mean twenty
    // empty POSTs could 429 an address — the cheapest possible version of
    // the very lockout being fixed.
    return unauthorized();
  }

  // Service client: server-only, no session persistence, no token refresh.
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // try/catch (Opus review): getUser/deleteUser surface expected failures
  // via { error }, but genuine transport throws (DNS, socket) would
  // otherwise escape the handler — a destructive endpoint converts those
  // to the same generic 500 explicitly instead of leaning on framework
  // default behavior.
  try {
    // Verify the token really is a live Supabase session and extract ITS
    // user — the one and only deletable identity for this request. Token
    // confusion (DeepSeek review, verified refuted): getUser(token) sends
    // the token as the USER bearer to GoTrue's /user, which validates it
    // as a signed, unexpired ACCESS-token JWT for THIS project — refresh
    // tokens are opaque non-JWTs and fail, foreign-project JWTs fail
    // signature verification. The service apikey does not bypass that.
    const { data: userData, error: userError } =
      await admin.auth.getUser(token);
    const userId = userData?.user?.id;
    if (userError || !userId) {
      // A rejected token IS an unverified attempt — charge stage 1 here so
      // forged-token floods stay bounded. Deliberately NOT charged in the
      // catch below: a transport throw means OUR backend is failing, and
      // billing the caller's IP for our outage would re-create the very
      // lockout this two-stage design removes.
      unverifiedIpLimiter.allow(ip);
      return unauthorized();
    }

    // Stage 2: the real quota, on an identity the caller cannot rotate.
    if (!userLimiter.allow(userId)) return rateLimited();

    // Revoke EVERY refresh session BEFORE deleting (cross-device stale-session
    // fix, staging 2026-08-01): deleting an auth user does not invalidate
    // already-issued access tokens, and a device that can still refresh keeps
    // authenticated UI past expiry. Revoke-then-delete means no refresh can
    // land in a delete-then-revoke gap. Deliberately NON-blocking: deletion is
    // the user's right and must not gate on defense-in-depth — deleteUser
    // cascades sessions anyway, and the client-side getUser validation is the
    // authoritative terminator for the already-issued token. Placed after
    // stage 2 so a rate-limited request cannot sign the user out everywhere.
    // supabase-js reports failure BOTH ways: a resolved { error } and a
    // transport throw (DeepSeek review) — handle each, block on neither.
    // PARTIAL-FAILURE TRADE, accepted (santa round-1): if revocation succeeds
    // and deleteUser then fails, the user is signed out of every device while
    // the account survives. Recoverable, not a lockout — the access token
    // stays valid until expiry so the same bearer can retry this route, and
    // password sign-in still works afterwards. Delete-first would instead
    // forfeit the refresh-race protection the revocation exists to provide.
    try {
      const { error: revokeError } = await admin.auth.admin.signOut(
        token,
        'global',
      );
      if (revokeError) {
        console.error(
          '[account/delete] session revocation failed (continuing to delete):',
          revokeError.message,
        );
      }
    } catch (revokeThrown) {
      console.error(
        '[account/delete] session revocation threw (continuing to delete):',
        revokeThrown,
      );
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error('[account/delete] failed:', deleteError.message);
      return NextResponse.json(
        { ok: false, error: 'server_error' },
        { status: 500 },
      );
    }
  } catch (thrown) {
    console.error('[account/delete] transport failure:', thrown);
    return NextResponse.json(
      { ok: false, error: 'server_error' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
