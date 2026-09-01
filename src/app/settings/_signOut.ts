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
 */
export async function signOutAndRevokePush(
  signOut: () => Promise<void>,
): Promise<void> {
  const supabase = getBrowserSupabase();
  if (supabase) {
    try {
      await unsubscribeFromPush(supabase);
    } catch {
      // Teardown is best-effort; the sign-out below is not optional.
    }
  }
  await signOut();
}
