import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { CALLBACK_ERROR, callbackErrorCode } from '@/lib/authCallbackErrors';

/**
 * Magic link callback handler — the PKCE code-exchange path.
 *
 * Supabase redirects here after the user taps the email link, with `?code=...`
 * in the query string. We exchange that code for a session, then redirect to
 * the app surface.
 *
 * KEPT for links already in flight. New emails should point at `/auth/confirm`
 * instead: the exchange below needs the code VERIFIER cookie written by the
 * browser that started the flow, which does not exist when the link opens in
 * a different browser (the TestFlight WKWebView → Safari boundary) or on a
 * different device. See that route's header for the full account.
 *
 * Failures redirect with a STABLE SENTINEL (2026-08-06 audit), never
 * `error.message`. The old behaviour URL-encoded raw SDK prose into a
 * user-visible URL and made the client's banner logic depend on English
 * wording that upstream can reword at any time.
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

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const requested = searchParams.get('redirect_to');
  const redirectTo = requested && isSafeRedirect(requested) ? requested : '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/auth?error=${CALLBACK_ERROR.missingCode}`);
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.redirect(`${origin}/auth?error=${CALLBACK_ERROR.unconfigured}`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/auth?error=${callbackErrorCode(error)}`);
  }

  return NextResponse.redirect(`${origin}${redirectTo}`);
}
