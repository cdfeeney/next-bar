import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { clientIpFromHeaders, createIpRateLimiter } from '@/lib/waitlistGuard';

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
 *   - Rate-limited per IP: deletion is destructive and needs no retries.
 *
 * UNATTENDED SAFETY GATE (nightlog rule 10, DeepSeek/Codex review): under
 * LOOP_UNATTENDED=1 this route refuses outright — the overnight loop (and
 * any dev/e2e server it spawns, which inherits the env) must never be able
 * to execute a service-role deletion against live auth, stubs or no stubs.
 * The morning operator runs without the flag and the route goes live.
 */

const RATE_LIMIT_PER_HOUR = 5;
const limiter = createIpRateLimiter({
  limit: RATE_LIMIT_PER_HOUR,
  windowMs: 60 * 60 * 1000,
});

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

  if (!limiter.allow(clientIpFromHeaders(request.headers))) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429 },
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

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized' },
      { status: 401 },
    );
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
      return NextResponse.json(
        { ok: false, error: 'unauthorized' },
        { status: 401 },
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
