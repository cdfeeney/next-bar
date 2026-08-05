'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getCacheEpoch, guardAgainstForeignCache } from '@/lib/accountCache';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  accountContentKeyForStorageKey,
  stampLocalAccountContent,
  writeLocalAccountContent,
  type AccountContentKey,
  type LocalAccountContent,
} from '@/lib/accountContent.local';
import {
  syncAccountContent,
  syncAccountContentKey,
} from '@/lib/accountContentSync';

/**
 * Durable account sync for the app's existing synchronous local stores.
 *
 * Anonymous use remains local-only. On first sign-in, anonymous lists and night
 * state merge into that account; on later sign-ins the owner marker prevents a
 * shared device from uploading the previous account's cache. Every existing
 * writer keeps writing localStorage first, so offline and render behavior do not
 * change. Storage events become the write-through trigger.
 */
export default function AccountContentSync(): null {
  const auth = useAuth();
  const suppressed = useRef(new Set<AccountContentKey>());
  const queues = useRef(new Map<AccountContentKey, Promise<unknown>>());

  useEffect(() => {
    let cancelled = false;
    queues.current.clear();

    const signedIn = auth.status === 'signed-in';
    const supabase = signedIn ? getBrowserSupabase() : null;
    const userId = signedIn ? auth.user.id : null;

    if (userId) guardAgainstForeignCache(userId);
    const epoch = getCacheEpoch();
    const stillCurrent = (): boolean =>
      !cancelled && getCacheEpoch() === epoch;

    const hydrateLocal = (
      key: AccountContentKey,
      value: LocalAccountContent,
    ): boolean => {
      suppressed.current.add(key);
      try {
        return writeLocalAccountContent(key, value);
      } finally {
        suppressed.current.delete(key);
      }
    };

    if (supabase && userId) {
      void syncAccountContent({
        supabase,
        userId,
        stillCurrent,
        hydrateLocal,
      });
    }

    const onStorage = (event: StorageEvent): void => {
      // key=null is the account-cache "refresh everything" event after a wipe,
      // not a user mutation. Treating it as four deletes would erase the server.
      const key = accountContentKeyForStorageKey(event.key);
      if (!key || suppressed.current.has(key)) return;

      // Stamp even in anonymous mode so first sign-in can order the local value
      // against a server value deterministically.
      const local = stampLocalAccountContent(key);
      if (!supabase || !userId || local.status === 'invalid') return;

      // Preserve per-key issue order. Database LWW is the final guard, but this
      // avoids needless out-of-order requests during rapid list taps.
      const previous = queues.current.get(key) ?? Promise.resolve();
      const next = previous
        // A rejected SDK promise must not poison this key's queue forever.
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
        .catch(() => 'fetch-failed' as const);
      queues.current.set(key, next);
      void next.finally(() => {
        if (queues.current.get(key) === next) queues.current.delete(key);
      });
    };

    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
    };
  }, [auth.status, auth.status === 'signed-in' ? auth.user.id : null]);

  return null;
}
