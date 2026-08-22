'use client';

import { useEffect, useState } from 'react';
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
 */
export function usePinnedHandles(): string[] {
  const auth = useAuth();
  const isSignedIn = auth.status === 'signed-in';
  const [night, setNight] = useState(() => nycNightKey());
  const [handles, setHandles] = useState<string[]>([]);
  useNightRefresh(() => setNight(nycNightKey()));

  useEffect(() => {
    if (!isSignedIn) {
      setHandles([]);
      return;
    }
    const supabase = getBrowserSupabase();
    if (supabase === null) return;
    let cancelled = false;
    const epoch = getCacheEpoch();
    void (async () => {
      const rows = await fetchCircleSuggestions(supabase, night);
      // An account switch mid-flight must not land another account's circle.
      if (cancelled || rows === null || getCacheEpoch() !== epoch) return;
      setHandles(
        rows
          .map((row) => row.handle)
          .filter((handle): handle is string => handle !== null),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, night]);

  return handles;
}
