/**
 * Invite-context handoff across the sign-in flow (V8-3 criterion 7).
 *
 * Opening a Night Out share link signed-out must land the user back on THAT
 * exact plan after they sign in. The auth flow redirects to a fixed post-auth
 * path, so the context rides sessionStorage: the share page stores the token
 * before pushing to /auth, and PendingInviteRedirect (mounted in the root
 * layout) consumes it on the first signed-in render anywhere in the app.
 *
 * sessionStorage on purpose: the context is one tab's in-flight intent — it
 * must not leak to other tabs or survive the browser session.
 */

const PENDING_INVITE_KEY = 'next-bar:pending-invite:v1';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function storePendingInvite(token: string): void {
  if (typeof window === 'undefined' || !UUID_RE.test(token)) return;
  try {
    window.sessionStorage.setItem(PENDING_INVITE_KEY, token);
  } catch {
    // Private mode / quota — the user just lands on the default post-auth
    // page and can reopen the link; no data at risk.
  }
}

/** Read AND clear — the redirect must fire exactly once. */
export function consumePendingInvite(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = window.sessionStorage.getItem(PENDING_INVITE_KEY);
    window.sessionStorage.removeItem(PENDING_INVITE_KEY);
    return token !== null && UUID_RE.test(token) ? token : null;
  } catch {
    return null;
  }
}

/** Non-destructive read, for pages that only need to know one is pending. */
export function peekPendingInvite(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = window.sessionStorage.getItem(PENDING_INVITE_KEY);
    return token !== null && UUID_RE.test(token) ? token : null;
  } catch {
    return null;
  }
}
