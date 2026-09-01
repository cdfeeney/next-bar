'use client';

import { unsubscribeFromPush } from '@/lib/push';
import { getBrowserSupabase } from '@/lib/supabase/client';

/**
 * Sign out AND revoke this installation's notification token.
 *
 * V8-R-ACC-011 states the two as one action, and they were not: every
 * `signOut` caller in the app called `auth.signOut()` alone, so the browser
 * push subscription and its `push_subscriptions` row both survived. A device
 * signed out of an account could keep receiving that account's notifications
 * — the exact leak the requirement names, and worse on a shared phone than on
 * a personal one.
 *
 * ponytail: this belongs in `useAuth().signOut()`, which is where every caller
 * already goes and where no caller could forget it. `src/hooks/` is outside
 * this lane's write scope, so the fix lives one level out and every sign-out
 * THIS lane owns routes through it. Move it inward when that file is
 * assignable; the three call sites collapse to none.
 *
 * ORDER MATTERS. Revoke first: `delete_push_subscription` is an authenticated
 * RPC, so after the session is gone RLS refuses it and the server row would
 * outlive the account's access to remove it.
 *
 * BEST-EFFORT, NEVER BLOCKING. `unsubscribeFromPush` already resolves `false`
 * rather than throwing, but a caller must not be left signed in because a
 * service worker was unavailable — refusing to sign someone out is a worse
 * failure than a stale token. So its outcome is deliberately not awaited into
 * the result, and the returned promise settles exactly as `signOut` does. That
 * is what lets the under-21 exit keep treating a rejection as a failed
 * sign-out and a resolution as "the call is over".
 *
 * "NEVER BLOCKING" NEEDS A CLOCK, NOT JUST A `catch`. The teardown awaits
 * `navigator.serviceWorker.ready`, which is a promise that RESOLVES when a
 * registration becomes active and otherwise never settles at all — it does not
 * reject, so no try/catch can end it. A browser that exposes
 * `navigator.serviceWorker` with no active registration (a `/sw.js`
 * registration that failed, and that failure is swallowed where it happens)
 * therefore hung this function forever, and with it:
 *
 *   - Settings sign-out, which simply never signed the person out;
 *   - the under-21 exit, which sat on "Signing you out…" beside a live
 *     session with no retry offered — the same false assurance an earlier
 *     round removed, reintroduced through a different door; and
 *   - account deletion, where the awaited call sits in a `try` whose `finally`
 *     destroys the local account data and redirects. The server had already
 *     deleted the account; the browser kept its data and stayed put.
 *
 * So the teardown races a deadline. Losing the race costs a stale push token,
 * which is exactly the trade the paragraph above already chose.
 */

/** How long the best-effort teardown gets before the sign-out proceeds without
 *  it. Short on purpose: nothing downstream waits on the result, and the cost
 *  of giving up is one stale subscription. */
const PUSH_TEARDOWN_TIMEOUT_MS = 3_000;

function withDeadline(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  // `finally` clears the timer on BOTH outcomes, so a fast teardown does not
  // leave a pending handle holding a test runner (or a tab) awake.
  return Promise.race([work.then(() => undefined, () => undefined), deadline])
    .finally(() => clearTimeout(timer));
}

export async function signOutAndRevokePush(
  signOut: () => Promise<void>,
): Promise<void> {
  const supabase = getBrowserSupabase();
  if (supabase) {
    // Teardown is best-effort: neither a rejection nor a promise that never
    // settles may keep the sign-out below from running.
    await withDeadline(unsubscribeFromPush(supabase), PUSH_TEARDOWN_TIMEOUT_MS);
  }
  await signOut();
}
