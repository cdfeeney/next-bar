/**
 * authErrors — the single place that turns a Supabase Auth SDK failure into
 * copy we own.
 *
 * WHY THIS EXISTS (audit 2026-08-06). Every auth surface used to render
 * `error.message` verbatim. That is how the operator saw **"Load failed"** on
 * password reset: the string appears nowhere in this repository — it is
 * WebKit's `TypeError.message` for a failed `fetch()` (Chrome's equivalent is
 * "Failed to fetch"). `@supabase/auth-js` wraps any fetch rejection into
 * `AuthRetryableFetchError(e.message, 0)` (lib/fetch.js `_handleRequest`), and
 * `_getErrorMessage` copies the browser's wording straight through. So a
 * transient network blip in the iOS WebView surfaced to users as a bare
 * engine-internal string with no guidance and no retry affordance.
 *
 * The rule this module enforces: **an SDK message is never rendered.** Every
 * failure resolves to one of the kinds below, and each kind has app-owned
 * copy. Unknown failures get the generic line — never `error.message`.
 *
 * Deliberately PRESERVED distinctions (they change what the user should do
 * next, so collapsing them into "something went wrong" would be a regression):
 * invalid credentials, unconfirmed email, rate limiting, and same-password.
 *
 * Detection keys off the STABLE error code first and falls back to message
 * matching, because `code` is not always populated: `handleError` only reads
 * `data.code` when the response carries an `x-api-version` >= 2024-01-01, and
 * otherwise only `data.error_code`. A GoTrue response predating either shape
 * arrives with `code === undefined`, and the fallback is what keeps those
 * classified instead of silently degrading to generic copy.
 */

import { isAuthRetryableFetchError } from '@supabase/supabase-js';

export type AuthErrorKind =
  | 'network'
  | 'invalid-credentials'
  | 'email-not-confirmed'
  | 'email-exists'
  | 'rate-limited'
  | 'same-password'
  | 'weak-password'
  | 'unknown';

/** Which form raised the error — only affects wording, never classification. */
export type AuthContext = 'signin' | 'signup' | 'reset' | 'update';

/**
 * App-owned copy. Exported so tests can assert on the constant rather than
 * duplicating the string, and so a wording change can never silently diverge
 * from what the tests pin.
 */
export const AUTH_COPY = {
  network:
    "Couldn't reach the server. Check your connection and try again.",
  generic: 'Something went wrong on our end. Please try again.',
  invalidCredentials:
    'Wrong email or password. No password yet? Use "Forgot your password?" below.',
  emailNotConfirmed:
    'Almost there — tap the verification link we emailed you, then sign in.',
  emailExists: 'That email already has an account — sign in instead.',
  rateLimitedEmail:
    "Too many emails requested — you've hit the rate limit. Wait about a minute and try again.",
  rateLimitedAttempts:
    "Too many attempts — you've hit the rate limit. Wait about a minute and try again.",
  samePassword: 'That is already your password.',
  weakPassword:
    'That password is too easy to guess — try a longer one with a mix of characters.',
} as const;

function readString(error: unknown, key: string): string {
  if (typeof error !== 'object' || error === null) return '';
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function readStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const value = (error as Record<string, unknown>).status;
  return typeof value === 'number' ? value : null;
}

/**
 * `isAuthRetryableFetchError` brands via `__isAuthError`, which fails if two
 * copies of auth-js are loaded (a real hazard once a transitive dep pulls its
 * own). The `name` check is the documented-stable fallback for that case, so
 * a duplicated module cannot silently downgrade a network blip to generic
 * copy — the exact failure this module exists to make legible.
 */
function isNetworkError(error: unknown): boolean {
  return (
    isAuthRetryableFetchError(error) ||
    readString(error, 'name') === 'AuthRetryableFetchError'
  );
}

export function classifyAuthError(error: unknown): AuthErrorKind {
  if (!error) return 'unknown';

  // Transport first: a retryable fetch failure carries whatever wording the
  // engine chose ("Load failed", "Failed to fetch", "NetworkError when
  // attempting to fetch resource"), so it must never reach message matching.
  if (isNetworkError(error)) return 'network';

  const code = readString(error, 'code').toLowerCase();
  const message = readString(error, 'message').toLowerCase();
  const name = readString(error, 'name');
  const status = readStatus(error);

  if (code === 'invalid_credentials' || /invalid login credentials/.test(message)) {
    return 'invalid-credentials';
  }
  if (code === 'email_not_confirmed' || /email not confirmed/.test(message)) {
    return 'email-not-confirmed';
  }
  if (
    code === 'user_already_exists' ||
    code === 'email_exists' ||
    /already registered|already has an account|user already exists/.test(message)
  ) {
    return 'email-exists';
  }
  if (code.includes('rate_limit') || status === 429 || /rate limit/.test(message)) {
    return 'rate-limited';
  }
  if (
    code === 'same_password' ||
    /should be different from the old password|same.*password/.test(message)
  ) {
    return 'same-password';
  }
  if (
    code === 'weak_password' ||
    name === 'AuthWeakPasswordError' ||
    /password is too weak|weak password/.test(message)
  ) {
    return 'weak-password';
  }

  return 'unknown';
}

/**
 * The only function a component should call. Returns copy this app owns for
 * every input — including inputs that are not Auth errors at all.
 */
export function authErrorMessage(
  error: unknown,
  context: AuthContext,
): string {
  const emailBearing = context === 'reset' || context === 'signup';

  switch (classifyAuthError(error)) {
    case 'network':
      return AUTH_COPY.network;
    case 'invalid-credentials':
      return AUTH_COPY.invalidCredentials;
    case 'email-not-confirmed':
      return AUTH_COPY.emailNotConfirmed;
    case 'email-exists':
      return AUTH_COPY.emailExists;
    case 'rate-limited':
      return emailBearing
        ? AUTH_COPY.rateLimitedEmail
        : AUTH_COPY.rateLimitedAttempts;
    case 'same-password':
      return AUTH_COPY.samePassword;
    case 'weak-password':
      return AUTH_COPY.weakPassword;
    default:
      return AUTH_COPY.generic;
  }
}
