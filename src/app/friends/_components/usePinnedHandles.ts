'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNightRefresh } from '@/hooks/useIntent';
import { nycNightKey } from '@/lib/nightKey';
import { getCacheEpoch } from '@/lib/accountCache';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { fetchCircleSuggestions } from '@/lib/suggestions.server';
import { VIEWER_HANDLE } from '@/components/story/storyStore';

/**
 * Handles that have pinned a spot tonight — the SHARED BAR PRESENCE signal
 * the Stories rail draws as its squared pin badge.
 *
 * It reads the same live rows the presence list does (`get_circle_suggestions`,
 * migration 0011); the badge is therefore real server state and not a second
 * story-derived flag. Keeping the two signals on two different sources is the
 * point: a ring means an unseen story, a pin means someone is out, and they
 * are never merged into one affordance.
 *
 * Signed out there is no circle to read, so the set is empty and the rail
 * simply draws no pins.
 *
 * TWO things make YOUR OWN pin visible on the rail, and neither is optional:
 *
 *  - the rows carry backend handles while the rail's own cell is the local
 *    `VIEWER_HANDLE` constant (stories are local-first and never see a profile
 *    handle), so your row is re-keyed to that constant — without it the
 *    own-avatar badge could not match and was unreachable code;
 *  - `Pin my spot` lives in TonightPresence, which refreshes only its OWN
 *    copy of these rows. This hook otherwise re-reads on auth/night alone, so
 *    the rail sat a whole night behind your own write. The write announces
 *    itself on `PRESENCE_CHANGED_EVENT` and both readers re-fetch.
 */

/** Fired after a pin/unpin the server confirmed. */
export const PRESENCE_CHANGED_EVENT = 'next-bar:presence-changed';

/** Announce a confirmed pin/unpin to every presence reader on the page. */
export function announcePresenceChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PRESENCE_CHANGED_EVENT));
}
export function usePinnedHandles(): string[] {
  const auth = useAuth();
  const isSignedIn = auth.status === 'signed-in';
  const youId = isSignedIn ? auth.user.id : null;
  const [night, setNight] = useState(() => nycNightKey());
  const [handles, setHandles] = useState<string[]>([]);
  useNightRefresh(() => setNight(nycNightKey()));

  const load = useCallback(
    (isCancelled: () => boolean): void => {
      if (!isSignedIn) {
        setHandles([]);
        return;
      }
      const supabase = getBrowserSupabase();
      if (supabase === null) return;
      const epoch = getCacheEpoch();
      void (async () => {
        const rows = await fetchCircleSuggestions(supabase, night);
        // An account switch mid-flight must not land another account's circle.
        if (isCancelled() || rows === null || getCacheEpoch() !== epoch) return;
        setHandles(
          rows
            .map((row) =>
              youId !== null && row.userId === youId ? VIEWER_HANDLE : row.handle,
            )
            .filter((handle): handle is string => handle !== null),
        );
      })();
    },
    [isSignedIn, night, youId],
  );

  useEffect(() => {
    let cancelled = false;
    const isCancelled = (): boolean => cancelled;
    load(isCancelled);
    const onChanged = (): void => load(isCancelled);
    window.addEventListener(PRESENCE_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(PRESENCE_CHANGED_EVENT, onChanged);
    };
  }, [load]);

  return handles;
}
