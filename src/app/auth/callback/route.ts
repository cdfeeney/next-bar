import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

/**
 * Magic link callback handler.
 *
 * Supabase redirects here after the user taps the email link, with `?code=...`
 * in the query string. We exchange that code for a session, then redirect to
 * the app surface.
 */
/**
 * `redirect_to` is attacker-visible query input — restrict it to a plain
 * same-origin path (single leading slash, no `//`, no backslash) so the
 * final redirect can never be steered cross-origin, regardless of how the
 * runtime's URL parsing evolves.
 */
function isSafeRedirect(path: string): boolean {
  return /^\/(?!\/)[^\s\\]*$/.test(path);
}

/**
 * Every response this route emits carries a one-time credential in the URL it
 * was reached by, so none of them may be stored.
 *
 * `Set-Cookie` alone does NOT make a response uncacheable (RFC 9111), and a
 * `token_hash` is a self-contained bearer credential — unlike the PKCE `code`,
 * which is useless without the verifier held in the initiating browser. A
 * shared cache or proxy that retained one of these redirects would retain a
 * redeemable credential. `no-referrer` keeps the token out of the Referer of
 * anything the redirect target loads.
 */
function redirect(url: string): NextResponse {
  const res = NextResponse.redirect(url);
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}

/**
 * The `type` values Supabase's own `verifyOtp` accepts for an emailed token.
 *
 * An allowlist rather than a cast: `type` is attacker-visible query input, and
 * handing an arbitrary string to the SDK would let a caller choose a
 * verification flow this route never meant to expose.
 */
const EMAIL_OTP_TYPES = new Set([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]);

/**
 * Accepts BOTH shapes of emailed link:
 *
 *  - `?code=...`        the PKCE magic-link exchange (unchanged).
 *  - `?token_hash=...&type=...`  the emailed-token verification, which is what
 *    lets the auth templates link at THIS domain instead of the Supabase
 *    project host. Gmail treats a link whose host does not match the sending
 *    domain as a phishing signal — it stripped the href and banner-warned on
 *    the recovery mail — so keeping the visible link on next-bar.com is a
 *    deliverability fix, not cosmetics.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const requested = searchParams.get('redirect_to');
  const redirectTo = requested && isSafeRedirect(requested) ? requested : '/';

  if (!code && !tokenHash) {
    return redirect(`${origin}/auth?error=missing_code`);
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return redirect(`${origin}/auth?error=supabase_unconfigured`);
  }

  if (tokenHash) {
    if (type === null || !EMAIL_OTP_TYPES.has(type)) {
      return redirect(`${origin}/auth?error=invalid_type`);
    }
    const { error } = await supabase.auth.verifyOtp({
      type: type as 'signup',
      token_hash: tokenHash,
    });
    if (error) {
      return redirect(
        `${origin}/auth?error=${encodeURIComponent(error.message)}`,
      );
    }
    return redirect(`${origin}${redirectTo}`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code!);
  if (error) {
    return redirect(
      `${origin}/auth?error=${encodeURIComponent(error.message)}`,
    );
  }

  return redirect(`${origin}${redirectTo}`);
}
