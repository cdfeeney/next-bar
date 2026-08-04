'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNightRefresh } from '@/hooks/useIntent';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch } from '@/lib/accountCache';
import { fetchFriendPins } from '@/lib/pins.server';
import {
  claimSessionPinSeed,
  getSessionPinRevision,
  isSessionPinSeedCurrent,
  releaseSessionPinSeed,
  setSessionPinnedBarId,
} from '@/lib/pinSignal';
import { socialNightKey } from '@/lib/socialNight';

/**
 * useSessionPinSeed — keep the shared session pin store aligned with
 * SERVER truth, no matter which surface mounts first (round-2 review
 * HIGH) and no matter how long the tab stays open (round-3 review HIGH:
 * a "Pinned" badge must not outlive the 6:00 AM expiry the confirm
 * dialog promised).
 *
 * useNightRefresh re-runs the effect every minute and on tab-visible —
 * the same shared clock signal every other night-scoped surface uses.
 * Each run recomputes the (user, cache-epoch, night) key:
 *   - same key → the claim latch makes it a no-op (one RPC total
 *     across N mounted buttons);
 *   - night rolled over → the stale pin is cleared IMMEDIATELY (the
 *     server would refuse it anyway) and the new night re-seeds;
 *   - cache epoch bumped (account wipe) → the new key re-seeds from
 *     the new account's truth.
 *
 * Write-safety: the seed captures the store revision at claim time and
 * refuses to clobber anything the user changed while the fetch was in
 * flight (round-3, Codex lane), and re-checks epoch + latch after the
 * await so a sign-out mid-fetch wins (round-3, DeepSeek lane).
 */
export function useSessionPinSeed(): void {
  const auth = useAuth();
  const userId = auth.status === 'signed-in' ? auth.user.id : null;
  const [tick, setTick] = useState(0);
  useNightRefresh(() => setTick((t) => t + 1));
  const lastNightRef = useRef<string | null>(null);

  useEffect(() => {
    if (userId === null) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const night = socialNightKey();
    const epoch = getCacheEpoch();

    // Rollover: yesterday's pin is over the moment the night key moves —
    // clear NOW rather than waiting on the re-seed fetch (offline tabs
    // must not keep promising presence past 6am).
    if (lastNightRef.current !== null && lastNightRef.current !== night) {
      setSessionPinnedBarId(null);
    }
    lastNightRef.current = night;

    const key = `${userId}:${epoch}:${night}`;
    if (!claimSessionPinSeed(key)) return;
    const revisionAtClaim = getSessionPinRevision();
    void fetchFriendPins(supabase, night).then((rows) => {
      if (rows === null) {
        releaseSessionPinSeed(key);
        return;
      }
      // A reset (sign-out), a newer claim, an epoch bump, or a user
      // action while in flight all win over this snapshot.
      if (!isSessionPinSeedCurrent(key)) return;
      if (getCacheEpoch() !== epoch) return;
      if (getSessionPinRevision() !== revisionAtClaim) return;
      setSessionPinnedBarId(
        rows.find((p) => p.userId === userId)?.barId ?? null,
      );
    });
  }, [userId, tick]);
}
