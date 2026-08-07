import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { CALLBACK_ERROR, confirmErrorCode } from '@/lib/authCallbackErrors';
import { logConfirmFailure } from '@/lib/authConfirmDiagnostics';

/**
 * /auth/confirm — the token-hash email confirmation route.
 *
 * WHY THIS EXISTS (audit 2026-08-06, P0). `/auth/callback` implements the
 * PKCE code exchange, which requires the code VERIFIER cookie written by the
 * browser that started the flow. In the TestFlight wrapper the flow starts in
 * the Capacitor WKWebView while the email link opens in Safari — a different
 * cookie jar — so the verifier is absent and the exchange can never succeed.
 * The same boundary applies to any cross-device use: request the link on a
 * phone, open it on a laptop.
 *
 * `verifyOtp({ token_hash })` needs no verifier. The token hash in the email
 * is itself the proof, so the flow completes in whatever browser opens it.
 * That makes this route the actual repair for the cross-context failure; the
 * classifier work only makes the failure legible.
 *
 * BOTH email types are handled here because BOTH cross the same boundary:
 * password recovery *and* signup confirmation. Fixing only recovery would
 * leave new users on the TestFlight build unable to activate an account.
 *
 * This route is inert until the Supabase email templates are repointed at it
 * (`{{ .TokenHash }}`). Until then `/auth/callback` continues to serve the
 * links already in flight — see docs/AUTH-EMAIL-TEMPLATES-2026-08-06.md.
 * Shipping the route first is deliberate: the template edit is a dashboard
 * action, and it must not be made against a deployment that would 404.
 *
 * Security posture:
 *   - `type` is checked against a CLOSED allowlist. `EmailOtpType` also
 *     admits `email_change`, `invite` and `magiclink`; accepting a type this
 *     app does not send would let a link minted for another purpose complete
 *     a session here.
 *   - `next` is restricted to a same-origin absolute path.
 *   - Failures redirect with a fixed sentinel. The token hash is a bearer
 *     credential and the SDK message is untrusted prose — neither reaches the
 *     URL, the page, or a log.
 *   - Failures DO emit a redacted server-side record (see
 *     `lib/authConfirmDiagnostics`). The route originally logged nothing, which
 *     made a misconfigured email template indistinguishable from an expired
 *     token and visible only through support reports. The record carries
 *     bounded categories — never the token, an email, the query string, the
 *     URL, or SDK prose.
 */

/**
 * Supabase's own templates use `type=recovery` for password reset and
 * `type=email` for signup confirmation. Nothing else is sent by this app, so
 * nothing else is accepted.
 */
const ALLOWED_TYPES = ['recovery', 'email'] as const;
type AllowedOtpType = (typeof ALLOWED_TYPES)[number];

function isAllowedType(value: string | null): value is AllowedOtpType {
  return value !== null && (ALLOWED_TYPES as readonly string[]).includes(value);
}

/**
 * Same rule as `/auth/callback`: a plain same-origin path — single leading
 * slash, no `//`, no backslash — so the redirect cannot be steered
 * cross-origin regardless of how URL parsing evolves.
 */
function isSafeRedirect(path: string): boolean {
  return /^\/(?!\/)[^\s\\]*$/.test(path);
}

/** Where a confirmed user lands: the account card makes the session visible. */
const DEFAULT_NEXT = '/settings';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  // Trimmed ONCE, so the value that is validated is the value that is sent.
  // Validating `trim()` while forwarding the raw string meant a token that
  // picked up encoded whitespace in transit passed the blank check and then
  // failed upstream as `"abc "` — a valid confirmation lost to a stray space.
  const tokenHash = searchParams.get('token_hash')?.trim() ?? '';
  // `type` is trimmed for the SAME reason as the token: whatever mangles one in
  // transit mangles the other, and an untrimmed `type` would fail the exact
  // allowlist comparison below — rejecting a valid link and reporting it as a
  // misconfigured template. Leaving these asymmetric fixed half the bug class.
  const type = searchParams.get('type')?.trim() ?? null;
  const requestedNext = searchParams.get('next');
  const next =
    requestedNext && isSafeRedirect(requestedNext) ? requestedNext : DEFAULT_NEXT;

  if (!tokenHash || !isAllowedType(type)) {
    // The misconfigured-template signal: a link built with the wrong `type`
    // lands here and is otherwise indistinguishable to the user from a
    // genuinely expired one. Categories only — see authConfirmDiagnostics for
    // what this must never carry.
    logConfirmFailure({
      stage: 'validation',
      outcome: CALLBACK_ERROR.invalidConfirmationLink,
      rawType: type,
      tokenHashLength: tokenHash.length,
    });
    return NextResponse.redirect(
      `${origin}/auth?error=${CALLBACK_ERROR.invalidConfirmationLink}`,
    );
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    logConfirmFailure({
      stage: 'unconfigured',
      outcome: CALLBACK_ERROR.unconfigured,
      rawType: type,
      tokenHashLength: tokenHash.length,
    });
    return NextResponse.redirect(`${origin}/auth?error=${CALLBACK_ERROR.unconfigured}`);
  }

  // Awaited before the redirect is constructed: verifyOtp writes the session
  // through the cookie adapter in lib/supabase/server, and those Set-Cookie
  // headers must exist on THIS response or the user lands on /settings
  // signed out.
  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  if (error) {
    const outcome = confirmErrorCode(error);
    logConfirmFailure({
      stage: 'verification',
      outcome,
      rawType: type,
      tokenHashLength: tokenHash.length,
      error,
    });
    return NextResponse.redirect(`${origin}/auth?error=${outcome}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
