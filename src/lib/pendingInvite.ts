/**
 * Invite-context handoff across the sign-in flow (V8-3 criterion 7).
 *
 * Opening a Night Out share link signed-out must land the user back on THAT
 * exact plan after they sign in. The share page stores the token before pushing
 * to /auth, and PendingInviteRedirect (mounted in the root layout) consumes it
 * on the first signed-in render anywhere in the app.
 *
 * sessionStorage ALONE was the original design — "one tab's in-flight intent,
 * must not leak to other tabs or survive the session". That reasoning is sound
 * and it broke the primary flow (cold panel, Codex, HIGH): email-confirmation
 * signup opens the verification link in a NEW TAB, another browser, or a mail
 * webview, none of which can see the original tab's sessionStorage. The user
 * confirms their address and lands on /settings, with no way back to the plan
 * that brought them here — and that is the COMMON path for a brand-new account,
 * which is who an invite link is usually for.
 *
 * So the token is written to BOTH: sessionStorage for the same-tab case, and
 * localStorage with a short TTL for the cross-TAB handoff. The TTL is what
 * keeps the original concern honest — the context still must not survive as
 * durable state, it just has to outlive a tab.
 *
 * THIS FILE IS NOT THE WHOLE HANDOFF ANY MORE. Web Storage is scoped to an
 * origin within ONE browser profile, so these two stores recover the new-tab
 * case and nothing else:
 *
 *   new tab, same browser      RECOVERED by the localStorage copy
 *   a different browser        not reachable from here — separate storage
 *   a mail app's webview       usually not reachable — most partition storage
 *
 * Those last two are closed OUTSIDE this module, by `/auth`: when a signup
 * begins with an invite pending, `callbackUrl()` puts the token in the
 * confirmation link's own `redirect_to`, which is the one channel that crosses
 * profiles. /auth/callback validates it as a plain same-origin path.
 *
 * (This header previously said the cross-profile case "remains OPEN" and needed
 * "a different goal" — round 4, Claude. That was true when it was written and
 * false by the time it was read, which is the exact failure mode this goal has
 * filed against its own docs three times. If you change where the token can
 * ride, change this paragraph.)
 *
 * What is genuinely still open: a signup that begins with NO readable pending
 * invite. If both stores refuse a write — private mode at quota — nothing is
 * stored, so nothing can ride the URL either, and the user lands on the default
 * post-auth page. Password RECOVERY deliberately never carries an invite: that
 * link exists to reach the account card's "Set a password" (round 4, Codex).
 */

const PENDING_INVITE_KEY = 'next-bar:pending-invite:v1';

/**
 * How long a handoff may sit in localStorage. Long enough to read an email and
 * click a link on a phone; short enough that a stale invite never resurfaces
 * days later on a shared machine.
 */
const HANDOFF_TTL_MS = 30 * 60 * 1000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function storePendingInvite(token: string): void {
  if (typeof window === 'undefined' || !UUID_RE.test(token)) return;
  try {
    window.sessionStorage.setItem(PENDING_INVITE_KEY, token);
  } catch {
    // Private mode / quota — fall through; localStorage may still work.
  }
  try {
    window.localStorage.setItem(
      PENDING_INVITE_KEY,
      JSON.stringify({ token, expiresAt: Date.now() + HANDOFF_TTL_MS }),
    );
  } catch {
    // Private mode / quota — the user just lands on the default post-auth
    // page and can reopen the link; no data at risk.
  }
}

/** The cross-tab half: a token only counts while it is inside its TTL. */
function readLocalHandoff(): string | null {
  try {
    const raw = window.localStorage.getItem(PENDING_INVITE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { token, expiresAt } = parsed as { token?: unknown; expiresAt?: unknown };
    if (typeof token !== 'string' || !UUID_RE.test(token)) return null;
    if (typeof expiresAt !== 'number' || Date.now() > expiresAt) {
      window.localStorage.removeItem(PENDING_INVITE_KEY);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

function clearLocalHandoff(): void {
  try {
    window.localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Nothing to do — a stale entry expires on its own TTL.
  }
}

/** Read AND clear BOTH stores — the redirect must fire exactly once. */
export function consumePendingInvite(): string | null {
  if (typeof window === 'undefined') return null;
  const token = peekPendingInvite();
  try {
    window.sessionStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Ignore — clearing localStorage below is what stops a replay.
  }
  clearLocalHandoff();
  return token;
}

/**
 * Non-destructive read, for pages that only need to know one is pending.
 * Same tab wins; the cross-tab handoff is the fallback.
 */
export function peekPendingInvite(): string | null {
  if (typeof window === 'undefined') return null;
  let sameTab: string | null = null;
  let sameTabReadable = true;
  try {
    sameTab = window.sessionStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    sameTabReadable = false; // private mode — the cross-tab store is all we have
  }
  // A PRESENT same-tab value is authoritative, valid or not. Falling back to
  // localStorage when it fails validation would let a poisoned sessionStorage
  // entry silently substitute a different token — the existing tampering test
  // caught exactly that when the fallback was unconditional. Only genuine
  // absence (a new tab, or an unreadable store) reaches the handoff.
  if (sameTabReadable && sameTab !== null) {
    return UUID_RE.test(sameTab) ? sameTab : null;
  }
  return readLocalHandoff();
}
