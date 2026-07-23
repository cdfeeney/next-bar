'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BarRating, Rating } from '@/types/ratings';
import {
  clearRating as clearRatingLib,
  loadRatings,
  setRating as setRatingLib,
  writeRatings,
} from '@/lib/ratings';
import {
  deleteServerRating,
  fetchServerRatings,
  mergeLocalRatingsToServer,
  upsertServerRating,
} from '@/lib/ratings.server';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { isSeededDemoRating } from '@/lib/demo/seed';
import { guardAgainstForeignCache } from '@/lib/accountCache';

/**
 * Hydrate-race repair: prefer whichever entry is fresher per bar. A rating
 * tapped while the sign-in fetch was in flight lives in the write-through
 * cache with a newer ratedAt than the (pre-tap) server snapshot — a blind
 * setRatings(server) would revert it in state AND cache until next fetch.
 */
function mergeFreshest(
  server: BarRating[],
  local: BarRating[],
): BarRating[] {
  const byId = new Map(server.map((r) => [r.barId, r]));
  for (const l of local) {
    const s = byId.get(l.barId);
    if (!s || Date.parse(l.ratedAt) > Date.parse(s.ratedAt)) {
      byId.set(l.barId, l);
    }
  }
  return [...byId.values()];
}

const KEY = 'next-bar:ratings:v1';
const MERGED_KEY = 'next-bar:ratings:merged-for:v1';

/**
 * Custom DOM event used to broadcast server-mode rating writes to every
 * mounted `useRatings` consumer on the same page. localStorage's `storage`
 * event would do the job in local mode, but in server mode we don't touch
 * localStorage on writes — so we synthesize an in-tab broadcast instead.
 */
const SERVER_BROADCAST = 'next-bar:ratings:server-update';

/**
 * Payload carried on the SERVER_BROADCAST CustomEvent. The mutation itself
 * rides along so listeners can apply it to their state directly — re-fetching
 * from Supabase here would race the fire-and-forget write and read back the
 * pre-mutation rows.
 */
type ServerBroadcastDetail =
  | { kind: 'set'; entry: BarRating }
  | { kind: 'clear'; barId: string };

function broadcastServerUpdate(detail: ServerBroadcastDetail): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent<ServerBroadcastDetail>(SERVER_BROADCAST, { detail }),
    );
  } catch {
    // Older Safari etc. — non-fatal; the next server fetch re-syncs.
  }
}

/**
 * Publish a server-mode rating entry to every mounted useRatings instance.
 * Exported for usePairwise (B0.4), which writes transcript-derived scores
 * outside this hook but must keep in-tab rankings state coherent.
 */
export function broadcastServerRatingSet(entry: BarRating): void {
  broadcastServerUpdate({ kind: 'set', entry });
}

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
  // Mirror of `ratings` for event-handler reads: cross-instance broadcasts
  // update React state but not localStorage, so state (not the cache) is the
  // authoritative prev-value source inside callbacks.
  const ratingsRef = useRef<BarRating[]>([]);
  ratingsRef.current = ratings;

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
    // Server-mode counterpart of the storage listener: writes never touch
    // localStorage, so mutations broadcast a CustomEvent instead and every
    // mounted instance applies the payload to its own state.
    function handleServerBroadcast(event: Event): void {
      if (modeRef.current !== 'server') return;
      const detail = (event as CustomEvent<ServerBroadcastDetail>).detail;
      if (!detail) return;
      setRatings((prev) =>
        detail.kind === 'set'
          ? [...prev.filter((r) => r.barId !== detail.entry.barId), detail.entry]
          : prev.filter((r) => r.barId !== detail.barId),
      );
    }

    window.addEventListener('storage', handleStorage);
    window.addEventListener(SERVER_BROADCAST, handleServerBroadcast);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(SERVER_BROADCAST, handleServerBroadcast);
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
    // Cross-account guard: if the cache's merged-for flags name a DIFFERENT
    // user, this is another account's residue (e.g. session expired without
    // our sign-out) — wipe it BEFORE any merge can read it.
    guardAgainstForeignCache(userId);
    // Demo pollution guard: the sample-night seeder writes through the same
    // localStorage lib as genuine ratings, so filter seeded entries out here —
    // demo data must never merge into a real account.
    const mergeableRatings = loadRatings().filter(
      (r) => !isSeededDemoRating(r),
    );
    const alreadyMergedFor = readMergedFlag();

    let cancelled = false;
    void (async () => {
      // First-sign-in merge: only re-runs if this browser hasn't merged
      // for this user yet. Idempotent on the server side via insert-only.
      if (mergeableRatings.length > 0 && alreadyMergedFor !== userId) {
        const merged = await mergeLocalRatingsToServer(
          supabase,
          userId,
          mergeableRatings,
        );
        // Only latch the flag on a run that actually completed — a failed
        // merge (null) must retry next sign-in, not be marked done.
        if (merged !== null) writeMergedFlag(userId);
      }
      const server = await fetchServerRatings(supabase);
      // null = fetch FAILED (not "no ratings") — keep whatever we have
      // rather than blanking state / wiping the localStorage cache (B0.3).
      if (!cancelled && server !== null) {
        // Keep any rating tapped while this fetch was in flight (it sits in
        // the write-through cache with a newer ratedAt than the snapshot).
        const merged = mergeFreshest(server, loadRatings());
        setRatings(merged);
        // Hydrate the localStorage cache with the authoritative rows
        // (including rows written on other devices) so usePairwise and the
        // sign-out fallback read current data.
        writeRatings(merged);
      }
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
          // Tier semantics for the derived score (B0.4): a same-tier re-tap
          // preserves pairwise refinement; a tier CHANGE invalidates it (the
          // old score was interpolated inside the old tier's band). Read prev
          // from state (via ref) — broadcasts from other instances land in
          // state but not in the localStorage cache.
          const prevEntry = ratingsRef.current.find((r) => r.barId === barId);
          const tierChanged =
            prevEntry !== undefined && prevEntry.rating !== rating;
          const keptScore =
            !tierChanged && typeof prevEntry?.score === 'number'
              ? prevEntry.score
              : undefined;
          const entry: BarRating =
            keptScore === undefined ? nextEntry : { ...nextEntry, score: keptScore };

          // Optimistic UI update.
          setRatings((prev) => {
            const filtered = prev.filter((r) => r.barId !== barId);
            return [...filtered, entry];
          });
          // Write-through localStorage cache so usePairwise + sign-out
          // fallback stay coherent with server-mode writes (B0.3).
          setRatingLib(barId, rating);
          void upsertServerRating(
            supabase,
            auth.user.id,
            barId,
            rating,
            tierChanged ? null : undefined,
          );
          // Notify every OTHER mounted useRatings instance (self-receipt is
          // an idempotent re-apply of the optimistic update above).
          broadcastServerUpdate({ kind: 'set', entry });
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
          // Write-through cache (B0.3) — see setRating.
          clearRatingLib(barId);
          void deleteServerRating(supabase, auth.user.id, barId);
          broadcastServerUpdate({ kind: 'clear', barId });
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
