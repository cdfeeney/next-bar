'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNightRefresh } from '@/hooks/useIntent';
import { nycNightKey } from '@/lib/nightKey';
import { getCacheEpoch } from '@/lib/accountCache';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { fetchCircleSuggestions } from '@/lib/suggestions.server';

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
 *  - the rows and the rail's cells are both keyed on the PROFILE ID, so your
 *    own badge matches without any re-keying. Stories used to be local-first
 *    with no profile handle for your own cell, which is why this once mapped
 *    your row onto a `VIEWER_HANDLE` placeholder;
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
        // PROFILE IDS, not handles. The rail keys its cells on the same id, so
        // your own pin matches by construction — the old code had to re-key
        // your row onto a local `VIEWER_HANDLE` constant because your own cell
        // had no handle at all, and that constant is gone.
        setHandles(
          rows
            .map((row) => row.userId)
            .filter((id): id is string => id !== null),
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
