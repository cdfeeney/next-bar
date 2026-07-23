'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PairwiseComparison, Rating } from '@/types/ratings';
import { loadRatings, writeRatings } from '@/lib/ratings';
import {
  appendComparison,
  loadComparisons,
} from '@/lib/pairwise.local';
import {
  fetchServerComparisons,
  insertServerComparison,
  mergeLocalComparisonsToServer,
} from '@/lib/pairwise.server';
import { upsertServerRatingScores } from '@/lib/ratings.server';
import {
  applyComparison,
  pickComparisonTarget,
} from '@/lib/pairwise';
import { useAuth } from '@/hooks/useAuth';
import { broadcastServerRatingSet } from '@/hooks/useRatings';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { guardAgainstForeignCache } from '@/lib/accountCache';

const COMPARISONS_BROADCAST = 'next-bar:pairwise:local-update';
const MERGED_KEY = 'next-bar:pairwise:merged-for:v1';

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
   */
  requestPrompt: (justRatedBarId: string, tier: Rating) => void;
  /**
   * Record a comparison the user just answered. Persists the row (local
   * storage signed-out, `pairwise_comparisons` signed-in), recomputes
   * scores via `applyComparison`, commits the new BarRating[], and
   * dismisses the prompt.
   */
  addComparison: (winnerBarId: string, loserBarId: string) => void;
  /** Dismiss the prompt without recording a pick (Skip / Escape / backdrop). */
  dismissPrompt: () => void;
};

/**
 * Pairwise comparison state, dual-mode like useRatings (B0.4):
 *
 *   signed-out / unavailable → localStorage transcript + writeRatings.
 *   signed-in → `pairwise_comparisons` rows (append-only, session-tagged)
 *     with a one-time local→server transcript merge per (browser, user).
 *     Scores recompute client-side from the full transcript and bulk-upsert
 *     to `ratings.score`; in-tab useRatings instances hear about it via
 *     broadcastServerRatingSet.
 *
 * The localStorage ratings cache is write-through in server mode (see
 * useRatings B0.3), so loadRatings() is current in BOTH modes and the
 * score pipeline is mode-agnostic.
 */
export function usePairwise(): UsePairwiseReturn {
  const auth = useAuth();
  const [comparisons, setComparisons] = useState<PairwiseComparison[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);
  const modeRef = useRef<'local' | 'server' | 'pending'>('pending');
  // One session id per mounted app instance — tags this device's inserts
  // (migration 0005) so a future reconcile flow can detect interleaved
  // multi-device ranking sessions.
  const sessionIdRef = useRef<string | null>(null);
  if (sessionIdRef.current === null) {
    sessionIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : null;
  }

  // Hydrate from localStorage on mount. Same listener pattern as useRatings —
  // a broadcast from another instance (or our own writes) re-reads.
  useEffect(() => {
    setComparisons(loadComparisons());

    function handle(): void {
      if (modeRef.current === 'server') return;
      setComparisons(loadComparisons());
    }
    window.addEventListener(COMPARISONS_BROADCAST, handle);
    return () => window.removeEventListener(COMPARISONS_BROADCAST, handle);
  }, []);

  // Auth-driven mode switch, mirroring useRatings: merge the local
  // transcript once per (browser, user), then fetch the server transcript.
  useEffect(() => {
    if (auth.status === 'loading') return;

    if (auth.status !== 'signed-in') {
      modeRef.current = 'local';
      setComparisons(loadComparisons());
      return;
    }

    const supabase = getBrowserSupabase();
    if (!supabase) {
      modeRef.current = 'local';
      setComparisons(loadComparisons());
      return;
    }

    modeRef.current = 'server';
    const userId = auth.user.id;
    // Cross-account guard (see lib/accountCache.ts): another account's
    // cached transcript must be wiped, never merged into this one.
    guardAgainstForeignCache(userId);
    const local = loadComparisons();
    const alreadyMergedFor = readMergedFlag();

    let cancelled = false;
    void (async () => {
      if (local.length > 0 && alreadyMergedFor !== userId) {
        const merged = await mergeLocalComparisonsToServer(
          supabase,
          userId,
          local,
          sessionIdRef.current,
        );
        // Latch only on a completed run — a failed merge must retry.
        if (merged !== null) writeMergedFlag(userId);
      }
      const server = await fetchServerComparisons(supabase);
      // null = fetch failed — keep the local transcript rather than
      // pretending the user has never compared anything.
      if (!cancelled && server !== null) setComparisons(server);
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.status, auth.status === 'signed-in' ? auth.user.id : null]);

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
    [comparisons],
  );

  const addComparison = useCallback(
    (winnerBarId: string, loserBarId: string) => {
      if (winnerBarId === loserBarId) return;

      const newComparison: PairwiseComparison = {
        winnerBarId,
        loserBarId,
        comparedAt: new Date().toISOString(),
      };

      // Recompute against the CURRENT ratings (write-through cache keeps
      // this fresh in server mode too).
      const currentRatings = loadRatings();
      const updatedRatings = applyComparison(
        currentRatings,
        comparisons,
        newComparison,
      );

      if (modeRef.current === 'server' && auth.status === 'signed-in') {
        const supabase = getBrowserSupabase();
        if (supabase) {
          const userId = auth.user.id;
          // Optimistic transcript append (server assigns no fields we need).
          setComparisons((prev) => [...prev, newComparison]);
          void insertServerComparison(
            supabase,
            userId,
            newComparison,
            sessionIdRef.current,
          );

          // Persist only the rows whose score actually changed, then let
          // every mounted useRatings instance know.
          const changed = updatedRatings.filter((r) => {
            const before = currentRatings.find((c) => c.barId === r.barId);
            return before === undefined || before.score !== r.score;
          });
          void upsertServerRatingScores(supabase, userId, changed);
          writeRatings(updatedRatings); // keep the write-through cache coherent
          for (const entry of changed) broadcastServerRatingSet(entry);

          setPendingPrompt(null);
          return;
        }
      }

      const updatedComparisons = appendComparison(newComparison);

      writeRatings(updatedRatings);
      setComparisons(updatedComparisons);
      setPendingPrompt(null);
      broadcast();
    },
    [auth, broadcast, comparisons],
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

function readMergedFlag(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(MERGED_KEY);
  } catch {
    return null;
  }
}

function writeMergedFlag(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MERGED_KEY, userId);
  } catch {
    // Quota / private mode — non-fatal; merge will just re-run next sign-in.
  }
}
