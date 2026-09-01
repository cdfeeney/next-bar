import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * V8-R-ACC-011 — signing out revokes this installation's notification token.
 *
 * The two were stated as one action and shipped as two: every caller in the
 * app went straight to `auth.signOut()`, so the browser push subscription and
 * its `push_subscriptions` row both outlived the session. A signed-out device
 * could keep receiving that account's notifications — worst on a shared phone,
 * which is exactly the case the requirement is written for.
 */

const supabase = { rpc: vi.fn() };
let unsubscribe: (client: unknown) => Promise<boolean>;

vi.mock('@/lib/push', () => ({
  unsubscribeFromPush: (client: unknown) => unsubscribe(client),
}));
vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => supabaseOrNull,
}));

let supabaseOrNull: typeof supabase | null = supabase;

import { signOutAndRevokePush } from './_signOut';

beforeEach(() => {
  supabaseOrNull = supabase;
  unsubscribe = async () => true;
});

describe('signOutAndRevokePush', () => {
  test('revokes the push token BEFORE ending the session', async () => {
    // Order is load-bearing: `delete_push_subscription` is an authenticated
    // RPC, so after the session is gone RLS refuses it and the server row
    // outlives the account's own ability to remove it.
    const order: string[] = [];
    unsubscribe = async () => {
      order.push('unsubscribe');
      return true;
    };

    await signOutAndRevokePush(async () => {
      order.push('signOut');
    });

    expect(order).toEqual(['unsubscribe', 'signOut']);
  });

  test('still signs out when the push teardown throws', async () => {
    // Refusing to sign someone out because a service worker was unavailable
    // is a worse failure than a stale token. Teardown is best-effort.
    unsubscribe = async () => {
      throw new Error('no service worker');
    };
    const signOut = vi.fn(async () => {});

    await expect(signOutAndRevokePush(signOut)).resolves.toBeUndefined();
    expect(signOut).toHaveBeenCalledOnce();
  });

  test('still signs out when the push teardown never settles', async () => {
    // `navigator.serviceWorker.ready` RESOLVES on registration and otherwise
    // never settles — it does not reject, so the surrounding try/catch could
    // never end it. A browser exposing `navigator.serviceWorker` with no
    // active registration hung sign-out, the under-21 exit, and the
    // post-deletion cleanup forever. The teardown races a deadline instead.
    vi.useFakeTimers();
    try {
      unsubscribe = () => new Promise<boolean>(() => {});
      const signOut = vi.fn(async () => {});

      const settled = signOutAndRevokePush(signOut);
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(settled).resolves.toBeUndefined();

      expect(signOut).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  test('still signs out when there is no supabase client at all', async () => {
    supabaseOrNull = null;
    const signOut = vi.fn(async () => {});

    await signOutAndRevokePush(signOut);

    expect(signOut).toHaveBeenCalledOnce();
  });

  test('rejects exactly as the sign-out does, so callers can still detect failure', async () => {
    // The under-21 exit treats a rejection as a failed sign-out. Wrapping the
    // call must not swallow that signal.
    await expect(
      signOutAndRevokePush(async () => {
        throw new Error('network');
      }),
    ).rejects.toThrow('network');
  });
});
