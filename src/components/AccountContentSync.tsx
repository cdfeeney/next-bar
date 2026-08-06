'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getCacheEpoch, guardAgainstForeignCache } from '@/lib/accountCache';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  accountContentKeyForStorageKey,
  stampLocalAccountContent,
  type AccountContentKey,
  type LocalAccountContent,
} from '@/lib/accountContent.local';
import { hydrateConfirmedAccountContent } from '@/lib/accountContent.confirmed';
import {
  reconcileQuarantinedAccountContent,
  syncAccountContent,
  syncAccountContentKey,
  type AccountContentSyncOutcome,
} from '@/lib/accountContentSync';
import {
  getAccountContentCapability,
  resetAccountContentCapability,
} from '@/lib/accountContent.capability';
import {
  AccountContentRetryScheduler,
  retryableOutcome,
} from '@/lib/accountContent.retry';
import { subscribeAccountContentContext } from '@/lib/accountContent.context';
import { ensureAccountContentReady } from '@/lib/accountContent.ready';

/**
 * Durable account sync for the app's existing synchronous local stores
 * (v2.1).
 *
 * Anonymous use remains local-only. On sign-in the readiness barrier settles
 * ownership FIRST (foreign residue quarantines and blocks; own residue
 * restores); only a `ready` verdict starts sync. Every existing writer keeps
 * writing localStorage first; storage events are the write-through trigger.
 * Failed syncs re-enter through a bounded per-key retry ladder that resets
 * on online/visible/auth/new-mutation and never touches too-large or
 * unavailable outcomes.
 */
export default function AccountContentSync(): null {
  const auth = useAuth();
  const suppressed = useRef(new Set<AccountContentKey>());
  const queues = useRef(new Map<AccountContentKey, Promise<unknown>>());

  // The auth context is published in lockstep by the auth store itself
  // (useAuth setSharedState) — no effect-ordering dependence here.

  // Readiness snapshot: a resolution action (gate) flips this and re-arms
  // the sync effect below without an auth change.
  const readiness = useSyncExternalStore(
    subscribeAccountContentContext,
    () => ensureAccountContentReady().status,
    () => 'blocked' as const,
  );

  useEffect(() => {
    let cancelled = false;
    queues.current.clear();
    const retry = new AccountContentRetryScheduler();

    const signedIn = auth.status === 'signed-in';
    const supabase = signedIn ? getBrowserSupabase() : null;
    const userId = signedIn ? auth.user.id : null;

    if (userId) {
      resetAccountContentCapability();
      guardAgainstForeignCache(userId);
    }
    const epoch = getCacheEpoch();
    const stillCurrent = (): boolean =>
      !cancelled && getCacheEpoch() === epoch;

    const hydrateLocal = (
      key: AccountContentKey,
      value: LocalAccountContent,
    ): boolean => {
      if (!userId) return false;
      suppressed.current.add(key);
      try {
        return hydrateConfirmedAccountContent(key, value, userId);
      } finally {
        suppressed.current.delete(key);
      }
    };

    const scheduleIfRetryable = (
      key: AccountContentKey,
      outcome: AccountContentSyncOutcome,
    ): void => {
      if (!stillCurrent()) return;
      if (!retryableOutcome(outcome)) return;
      if (getAccountContentCapability() === 'unavailable') return;
      retry.schedule(key, () => {
        void runKeySync(key);
      });
    };

    const runKeySync = async (key: AccountContentKey): Promise<void> => {
      if (!supabase || !userId || !stillCurrent()) return;
      const previous = queues.current.get(key) ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(() =>
          syncAccountContentKey({
            supabase,
            userId,
            key,
            stillCurrent,
            hydrateLocal,
          }),
        )
        .catch(() => 'fetch-failed' as const)
        .then((outcome) => {
          scheduleIfRetryable(key, outcome);
          return outcome;
        });
      queues.current.set(key, next);
      void next.finally(() => {
        if (queues.current.get(key) === next) queues.current.delete(key);
      });
      await next;
    };

    if (supabase && userId && readiness === 'ready') {
      void (async () => {
        const report = await syncAccountContent({
          supabase,
          userId,
          stillCurrent,
          hydrateLocal,
        });
        if (!stillCurrent()) return;
        // Restore reconciliation AFTER live state reflects the server: the
        // user's quarantined envelopes meet the server under LWW.
        await reconcileQuarantinedAccountContent({
          supabase,
          userId,
          stillCurrent,
          hydrateLocal,
        });
        if (!stillCurrent()) return;
        for (const [key, outcome] of Object.entries(report) as Array<
          [AccountContentKey, AccountContentSyncOutcome]
        >) {
          scheduleIfRetryable(key, outcome);
        }
      })();
    }

    const onStorage = (event: StorageEvent): void => {
      // key=null is the account-cache "refresh everything" event after a wipe,
      // not a user mutation. Treating it as four deletes would erase the server.
      const key = accountContentKeyForStorageKey(event.key);
      if (!key || suppressed.current.has(key)) return;

      // Stamp even in anonymous mode so first sign-in can order the local value
      // against a server value deterministically. Digest-idempotent: an echo of
      // confirmed content does not bump the clock (and needs no upload).
      const local = stampLocalAccountContent(key);
      if (!supabase || !userId || local.status === 'invalid') return;

      // A NEW mutation restarts this key's retry ladder by definition.
      retry.resetAttempts(key);
      retry.cancel(key);
      void runKeySync(key);
    };

    // Reconnection and re-focus reset the ladders (locked spec) — pending
    // timers keep their schedule; the next FAILURE starts from 1s again.
    const onOnline = (): void => retry.resetAttempts();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') retry.resetAttempts();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      retry.cancelAll();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [auth.status, auth.status === 'signed-in' ? auth.user.id : null, readiness]);

  return null;
}
