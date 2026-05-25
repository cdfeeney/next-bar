'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PairwiseComparison, Rating } from '@/types/ratings';
import { loadRatings, writeRatings } from '@/lib/ratings';
import {
  appendComparison,
  loadComparisons,
} from '@/lib/pairwise.local';
import {
  applyComparison,
  pickComparisonTarget,
} from '@/lib/pairwise';
import { useAuth } from '@/hooks/useAuth';

const COMPARISONS_BROADCAST = 'next-bar:pairwise:local-update';

export type PendingPrompt = {
  /** The bar the user just rated. */
  justRatedBarId: string;
  /** The peer the matcher chose for them to compare against. */
  peerBarId: string;
  /** The tier both bars sit in — drives the prompt copy. */
  tier: Extract<Rating, 'loved' | 'liked'>;
};

export type UsePairwiseReturn = {
  comparisons: PairwiseComparison[];
  pendingPrompt: PendingPrompt | null;
  /**
   * Try to open a comparison prompt for a bar the user just rated. Looks
   * for a same-tier peer with the fewest existing comparisons. No-op when:
   *   - tier is 'pass' (matcher returns null per Q2)
   *   - the user has no other same-tier rated bars
   *   - the user is signed in (server-mode pairwise lands in a follow-up)
   */
  requestPrompt: (justRatedBarId: string, tier: Rating) => void;
  /**
   * Record a comparison the user just answered. Appends the row to local
   * storage, recomputes scores via `applyComparison`, persists the new
   * BarRating[] via `writeRatings`, and dismisses the prompt.
   */
  addComparison: (winnerBarId: string, loserBarId: string) => void;
  /** Dismiss the prompt without recording a pick (Skip / Escape / backdrop). */
  dismissPrompt: () => void;
};

/**
 * Pairwise comparison state for the local (signed-out) ratings path.
 *
 * Server-mode pairwise (writes against the `pairwise_comparisons` table
 * + ratings.score column) is not yet implemented; the hook gates itself
 * to a no-op when the user is signed in so we don't silently diverge
 * local state from the server.
 *
 * Architecture: usePairwise is the writer for comparisons AND for the
 * derived BarRating.score field. It calls writeRatings() directly rather
 * than going through useRatings.setRating, which is per-bar and doesn't
 * carry score. The two hooks both read/write `next-bar:ratings:v1` and
 * stay coherent via the storage event.
 */
export function usePairwise(): UsePairwiseReturn {
  const auth = useAuth();
  const [comparisons, setComparisons] = useState<PairwiseComparison[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);

  // Hydrate from localStorage on mount. Same listener pattern as useRatings —
  // a storage event from another tab (or our own writes) re-reads.
  useEffect(() => {
    setComparisons(loadComparisons());

    function handle(): void {
      setComparisons(loadComparisons());
    }
    window.addEventListener(COMPARISONS_BROADCAST, handle);
    return () => window.removeEventListener(COMPARISONS_BROADCAST, handle);
  }, []);

  // When auth flips to signed-in we don't have a server-side pairwise
  // path yet; close any open prompt so the user isn't left staring at a
  // sheet that won't persist.
  useEffect(() => {
    if (auth.status === 'signed-in') {
      setPendingPrompt(null);
    }
  }, [auth.status]);

  const broadcast = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new Event(COMPARISONS_BROADCAST));
    } catch {
      // Older Safari etc. — non-fatal; storage will re-read on next mount.
    }
  }, []);

  const requestPrompt = useCallback(
    (justRatedBarId: string, tier: Rating) => {
      if (auth.status === 'signed-in') return;
      if (tier !== 'loved' && tier !== 'liked') return;

      const ratings = loadRatings();
      const peer = pickComparisonTarget(
        ratings,
        comparisons,
        justRatedBarId,
        tier,
      );
      if (!peer) return;

      setPendingPrompt({ justRatedBarId, peerBarId: peer, tier });
    },
    [auth.status, comparisons],
  );

  const addComparison = useCallback(
    (winnerBarId: string, loserBarId: string) => {
      if (auth.status === 'signed-in') return;
      if (winnerBarId === loserBarId) return;

      const newComparison: PairwiseComparison = {
        winnerBarId,
        loserBarId,
        comparedAt: new Date().toISOString(),
      };

      // Recompute against the CURRENT state of ratings (which may have
      // changed since mount via useRatings) — fall back to in-memory copy
      // if localStorage is unavailable.
      const currentRatings = loadRatings();
      const updatedRatings = applyComparison(
        currentRatings,
        comparisons,
        newComparison,
      );

      const updatedComparisons = appendComparison(newComparison);

      writeRatings(updatedRatings);
      setComparisons(updatedComparisons);
      setPendingPrompt(null);
      broadcast();
    },
    [auth.status, broadcast, comparisons],
  );

  const dismissPrompt = useCallback(() => {
    setPendingPrompt(null);
  }, []);

  return {
    comparisons,
    pendingPrompt,
    requestPrompt,
    addComparison,
    dismissPrompt,
  };
}
