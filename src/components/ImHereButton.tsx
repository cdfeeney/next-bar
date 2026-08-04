'use client';

/**
 * ImHereButton — "I'm here" on a bar result surface (g-31f36bf8
 * criterion 2). Explicit check-in only: tapping opens the shared
 * PinConfirmDialog (bar + audience + expiry), and confirming writes a
 * catalog bar id + night key through pins.server — never a coordinate.
 *
 * Pinned state is SHARED session truth (src/lib/pinSignal.ts), not
 * per-button state: several cards render at once, the server enforces
 * one pin per night (move semantics), and two buttons must never both
 * read "Pinned" (round-1 review HIGH, Fable lane).
 *
 * Signed-in server-mode only: renders nothing otherwise, so the result
 * card is unchanged for signed-out and local-mode users.
 */

import { useState, useSyncExternalStore } from 'react';
import PinConfirmDialog from '@/components/PinConfirmDialog';
import { useAuth } from '@/hooks/useAuth';
import { useSessionPinSeed } from '@/hooks/useSessionPin';
import { getCacheEpoch } from '@/lib/accountCache';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { pinVenue } from '@/lib/pins.server';
import {
  getServerPinnedBarId,
  getSessionPinnedBarId,
  setSessionPinnedBarId,
  subscribeSessionPin,
} from '@/lib/pinSignal';
import { socialNightKey } from '@/lib/socialNight';
import type { Bar } from '@/types';

export default function ImHereButton({ bar }: { bar: Bar }): JSX.Element | null {
  const auth = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pinnedBarId = useSyncExternalStore(
    subscribeSessionPin,
    getSessionPinnedBarId,
    getServerPinnedBarId,
  );
  // Seed the shared store from server truth no matter which surface the
  // session lands on first (one RPC total across all mounted buttons).
  useSessionPinSeed();

  if (auth.status !== 'signed-in' || getBrowserSupabase() === null) {
    return null;
  }

  const isPinnedHere = pinnedBarId === bar.id;

  const handleConfirm = async (): Promise<void> => {
    if (busy) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(true);
    // Snapshot the account identity BEFORE the await: a sign-out (cache
    // wipe) while the RPC is in flight must win, or the previous
    // account's pin would be written into the next account's session
    // store (round-3 review HIGH, Codex + DeepSeek lanes).
    const epochBefore = getCacheEpoch();
    const nightBefore = socialNightKey();
    try {
      const ok = await pinVenue(supabase, bar.id, nightBefore);
      setFailed(!ok);
      // Close the confirm on BOTH outcomes: the failure notice renders
      // beside the button, and a still-open fullscreen dialog would sit
      // on top of the only explanation of what went wrong (round-2
      // review HIGH — same lesson PinWhereIAm already carries).
      setConfirming(false);
      // Night check alongside the epoch check: a response that raced
      // the 6:00 AM rollover belongs to an ALREADY-ENDED night and must
      // not resurrect the badge the rollover just cleared.
      if (
        ok &&
        getCacheEpoch() === epochBefore &&
        socialNightKey() === nightBefore
      ) {
        // One pin per night, MOVED server-side — mirror that in the
        // shared session truth so every other card un-pins visually.
        setSessionPinnedBarId(bar.id);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`I'm here at ${bar.name}`}
        aria-pressed={isPinnedHere}
        className="text-xs text-accent font-display min-h-[44px] inline-flex items-center touch-manipulation hover:underline underline-offset-4 shrink-0"
      >
        {isPinnedHere ? '📍 Pinned' : "📍 I'm here"}
      </button>
      {failed ? (
        <span role="status" className="text-xs text-muted">
          Couldn&apos;t pin — try again
        </span>
      ) : null}
      {confirming ? (
        <PinConfirmDialog
          bar={bar}
          busy={busy}
          onConfirm={() => void handleConfirm()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}
