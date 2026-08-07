/**
 * authCallbackErrors — the shared vocabulary between the server-side email
 * link routes (`/auth/callback`, `/auth/confirm`) and the `/auth` banner.
 *
 * TWO JOBS, one file, because they are two halves of one contract:
 *
 *   1. `callbackErrorCode(error)` — the ROUTE side. Collapses an Auth SDK
 *      failure into a stable sentinel. Routes used to redirect with
 *      `?error=${encodeURIComponent(error.message)}`, which put raw SDK
 *      wording in a user-visible URL and made the client's classification
 *      depend on English prose that upstream can reword at any time.
 *
 *   2. `classifyCallbackError(raw)` — the CLIENT side. Turns that sentinel
 *      back into a banner kind.
 *
 * THE BUG THIS FIXES (audit 2026-08-06, P0). `@supabase/ssr` hardcodes
 * `flowType: 'pkce'` in BOTH `createBrowserClient` and `createServerClient`.
 * The PKCE code verifier is written as a cookie in whichever browser started
 * the flow. In the TestFlight wrapper the flow starts inside the Capacitor
 * WKWebView, but the email link opens in Safari — a different cookie jar — so
 * `exchangeCodeForSession` finds no verifier and throws
 * `AuthPKCECodeVerifierMissingError`, whose own message reads "PKCE code
 * verifier **not found** in storage. This can happen if the auth flow was
 * initiated in a different browser or device...".
 *
 * That phrase "not found" matched the broad expired-link regex, so the user
 * was told **"That link has expired or was already used"** and offered a
 * "Send a new link" button — which produced another link that failed exactly
 * the same way. An unbreakable loop whose message pointed away from the cause.
 *
 * Hence: PKCE is tested BEFORE the broad rule, and the ordering is pinned by
 * test. Do not reorder these branches.
 *
 * Both functions stay tolerant of legacy raw-message input. A link minted by
 * an already-deployed build still redirects with URL-encoded prose, and those
 * users must keep getting a correct banner after this ships.
 */

/** Stable sentinels. These appear in user-visible URLs — keep them opaque. */
export const CALLBACK_ERROR = {
  /** Server has no Supabase env vars — an app misconfiguration, not user error. */
  unconfigured: 'supabase_unconfigured',
  /** Supabase bounced back without a `code` at all (expired/consumed link). */
  missingCode: 'missing_code',
  /** The cross-browser / cross-device PKCE boundary. */
  pkceMismatch: 'pkce_code_verifier_not_found',
  /** One-shot link already used, or past its TTL. */
  otpExpired: 'otp_expired',
  /** Anything else during the code exchange. */
  exchangeFailed: 'exchange_failed',
  /** `/auth/confirm` reached with a missing/blank token_hash or a type outside the allowlist. */
  invalidConfirmationLink: 'invalid_confirmation_link',
  /** `/auth/confirm` reached with well-formed params that `verifyOtp` rejected. */
  confirmationFailed: 'confirmation_failed',
} as const;

export type CallbackErrorKind =
  | 'pkce-mismatch'
  | 'expired-link'
  | 'unconfigured'
  | 'generic';

function readString(error: unknown, key: string): string {
  if (typeof error !== 'object' || error === null) return '';
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function looksLikePkce(code: string, name: string, message: string): boolean {
  return (
    code === 'pkce_code_verifier_not_found' ||
    code === 'validation_failed_pkce' ||
    name === 'AuthPKCECodeVerifierMissingError' ||
    /pkce|code[\s_-]?verifier/.test(message)
  );
}

/**
 * ROUTE side. Never returns anything derived from `error.message` — only one
 * of the fixed sentinels above.
 */
export function callbackErrorCode(error: unknown): string {
  const code = readString(error, 'code').toLowerCase();
  const name = readString(error, 'name');
  const message = readString(error, 'message').toLowerCase();

  // PKCE first, for the same reason as the client classifier below: the
  // SDK's PKCE message contains "not found", which the expired-link test
  // would otherwise claim.
  if (looksLikePkce(code, name, message)) return CALLBACK_ERROR.pkceMismatch;

  if (
    code === 'otp_expired' ||
    code === 'flow_state_not_found' ||
    code === 'flow_state_expired' ||
    /expired|already been used|invalid/.test(message)
  ) {
    return CALLBACK_ERROR.otpExpired;
  }

  return CALLBACK_ERROR.exchangeFailed;
}

/**
 * ROUTE side, `/auth/confirm` variant. The token-hash flow carries no code
 * verifier by construction, so `pkceMismatch` is unreachable there and a
 * non-expiry failure is reported as a confirmation failure rather than an
 * exchange failure. Like `callbackErrorCode`, returns only fixed sentinels.
 */
export function confirmErrorCode(error: unknown): string {
  const code = callbackErrorCode(error);
  return code === CALLBACK_ERROR.otpExpired
    ? CALLBACK_ERROR.otpExpired
    : CALLBACK_ERROR.confirmationFailed;
}

/**
 * CLIENT side. `raw` is the untrusted `?error=` query value: one of our
 * sentinels, or legacy URL-decoded SDK prose from an older deployment.
 */
export function classifyCallbackError(raw: string): CallbackErrorKind {
  const value = raw.trim().toLowerCase();
  if (!value) return 'generic';

  if (value === CALLBACK_ERROR.unconfigured) return 'unconfigured';

  // ORDER IS LOAD-BEARING — see the header. PKCE must be claimed before the
  // broad rule below, whose `not.?found` alternative also matches the SDK's
  // PKCE message.
  if (looksLikePkce(value, '', value)) return 'pkce-mismatch';

  if (
    value === CALLBACK_ERROR.missingCode ||
    value === CALLBACK_ERROR.otpExpired ||
    value === CALLBACK_ERROR.invalidConfirmationLink ||
    value === CALLBACK_ERROR.confirmationFailed ||
    /expired|invalid|otp|flow.?state|not.?found|already|used/.test(value)
  ) {
    return 'expired-link';
  }

  return 'generic';
}
