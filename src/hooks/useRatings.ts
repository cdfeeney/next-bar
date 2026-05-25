'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BarRating, Rating } from '@/types/ratings';
import {
  clearRating as clearRatingLib,
  loadRatings,
  setRating as setRatingLib,
} from '@/lib/ratings';
import {
  deleteServerRating,
  fetchServerRatings,
  mergeLocalRatingsToServer,
  upsertServerRating,
} from '@/lib/ratings.server';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';

const KEY = 'next-bar:ratings:v1';
const MERGED_KEY = 'next-bar:ratings:merged-for:v1';

/**
 * Custom DOM event used to broadcast server-mode rating writes to every
 * mounted `useRatings` consumer on the same page. localStorage's `storage`
 * event would do the job in local mode, but in server mode we don't touch
 * localStorage on writes — so we synthesize an in-tab broadcast instead.
 */
const SERVER_BROADCAST = 'next-bar:ratings:server-update';

export type UseRatingsReturn = {
  ratings: BarRating[];
  getRating: (barId: string) => Rating | null;
  setRating: (barId: string, rating: Rating) => void;
  clearRating: (barId: string) => void;
};

/**
 * Branches on auth state:
 *   - signed-in   → reads + writes Supabase. First-time per (browser, user)
 *                   merges any pre-existing localStorage ratings into the
 *                   account, then leaves localStorage in place as a sign-out
 *                   fallback.
 *   - signed-out  → localStorage only (current v0.4 behavior).
 *   - unavailable → localStorage only (Supabase env vars missing).
 *   - loading     → renders [] until auth resolves; UI sees no ratings briefly.
 *
 * All writes are fire-and-forget from the caller's perspective. Local state
 * updates optimistically so the UI feels instant; server writes happen in
 * the background. RLS errors are swallowed silently for v0.5.0 — telemetry
 * for sync failures can land in v0.5.x.
 */
export function useRatings(): UseRatingsReturn {
  const auth = useAuth();
  const [ratings, setRatings] = useState<BarRating[]>([]);
  const modeRef = useRef<'local' | 'server' | 'pending'>('pending');

  // Storage listener — always on, regardless of auth state. When in local
  // mode, this is how cross-instance updates propagate (one ResultCard's
  // setRating notifies every other useRatings consumer). When in server
  // mode, it's a no-op because notifyChange isn't called for server writes,
  // but registering it unconditionally avoids a render-race where a rating
  // tap that lands before auth resolves wouldn't propagate to other
  // instances. Hydration from localStorage on mount, before the auth
  // branch runs, keeps the UI populated for anonymous users without flash.
  useEffect(() => {
    setRatings(loadRatings());

    function handleStorage(event: StorageEvent): void {
      if (modeRef.current === 'server') return;
      if (event.key === KEY || event.key === null) {
        setRatings(loadRatings());
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Auth-driven mode switch — runs whenever auth resolves or the user
  // changes. Sets modeRef and (in server mode) merges + fetches.
  useEffect(() => {
    if (auth.status === 'loading') return;

    if (auth.status !== 'signed-in') {
      modeRef.current = 'local';
      setRatings(loadRatings());
      return;
    }

    const supabase = getBrowserSupabase();
    if (!supabase) {
      modeRef.current = 'local';
      setRatings(loadRatings());
      return;
    }

    modeRef.current = 'server';

    const userId = auth.user.id;
    const localRatings = loadRatings();
    const alreadyMergedFor = readMergedFlag();

    let cancelled = false;
    void (async () => {
      // First-sign-in merge: only re-runs if this browser hasn't merged
      // for this user yet. Idempotent on the server side via insert-only.
      if (localRatings.length > 0 && alreadyMergedFor !== userId) {
        await mergeLocalRatingsToServer(supabase, userId, localRatings);
        writeMergedFlag(userId);
      }
      const server = await fetchServerRatings(supabase);
      if (!cancelled) setRatings(server);
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.status, auth.status === 'signed-in' ? auth.user.id : null]);

  const getRating = useCallback(
    (barId: string): Rating | null => {
      const found = ratings.find((r) => r.barId === barId);
      return found ? found.rating : null;
    },
    [ratings],
  );

  const setRating = useCallback(
    (barId: string, rating: Rating): void => {
      const nextEntry: BarRating = {
        barId,
        rating,
        ratedAt: new Date().toISOString(),
      };

      if (modeRef.current === 'server' && auth.status === 'signed-in') {
        const supabase = getBrowserSupabase();
        if (supabase) {
          // Optimistic UI update.
          setRatings((prev) => {
            const filtered = prev.filter((r) => r.barId !== barId);
            return [...filtered, nextEntry];
          });
          void upsertServerRating(supabase, auth.user.id, barId, rating);
          return;
        }
      }

      // Local mode (or server fell through).
      setRatingLib(barId, rating);
      setRatings(loadRatings());
    },
    [auth],
  );

  const clearRating = useCallback(
    (barId: string): void => {
      if (modeRef.current === 'server' && auth.status === 'signed-in') {
        const supabase = getBrowserSupabase();
        if (supabase) {
          setRatings((prev) => prev.filter((r) => r.barId !== barId));
          void deleteServerRating(supabase, auth.user.id, barId);
          return;
        }
      }

      clearRatingLib(barId);
      setRatings(loadRatings());
    },
    [auth],
  );

  return { ratings, getRating, setRating, clearRating };
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
