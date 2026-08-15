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
import {
  ackRatingDirty,
  clearRatingsDirty,
  clearResidualAccountCache,
  getCacheEpoch,
  getDirtyRatingEntries,
  guardAgainstForeignCache,
  markRatingDirty,
  readCacheOwner,
  writeCacheOwner,
} from '@/lib/accountCache';
import { loadComparisons } from '@/lib/pairwise.local';
import { mergeLocalComparisonsToServer } from '@/lib/pairwise.server';

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
// The pairwise UI was deliberately unwired in the U2 batch (rank-on-rankings
// replaced it), which orphaned usePairwise's one-time V7 transcript import —
// it never ran in production (V8-2 round-3, Codex). The import lives HERE now,
// on the sign-in path that actually executes.
const PAIRWISE_MERGED_KEY = 'next-bar:pairwise:merged-for:v1';

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
  setRating: (barId: string, rating: Rating, score?: number) => void;
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
  // Per-bar serialization of server writes (round-4 panel, Codex): a rate
  // followed by a fast clear are independent fetches and can arrive out of
  // order — the late upsert then re-creates the row the delete removed
  // (deletes leave no tombstone for the LWW trigger). Chaining per bar makes
  // this client emit same-bar mutations in order; cross-device ordering
  // remains LWW's job.
  const writeChainsRef = useRef<Map<string, Promise<unknown>>>(new Map());

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

    let cancelled = false;
    // Epoch guard: if a cache wipe (sign-out) lands while this async block
    // is in flight, every later write here must be abandoned — `cancelled`
    // alone flips too late (at React commit) to prevent re-polluting a
    // just-wiped cache (routed review finding).
    const epoch = getCacheEpoch();
    void (async () => {
      // Mid-flight ownership guard (V8-2 round-3, DeepSeek critical): the
      // synchronous foreign guard above ran at effect start, but ownership
      // can change while this block is in flight (another tab's sign-in, a
      // seal racing this mount). Never upload under a mismatched owner — a
      // stale closure here is how one account's rows land in another's.
      const cacheOwner = readCacheOwner();
      if (cacheOwner !== null && cacheOwner !== userId) return;

      // Round-2 uploaded EVERYTHING on every sign-in (fixing loss), which
      // round-3 correctly flagged as resurrection: a row deleted on another
      // device is "local-only" again and re-inserts forever. The dirty
      // journal resolves the tension — the one-time V7/anonymous import runs
      // when the latch mismatches, and journaled (unacked) writes retry on
      // EVERY pass, import included (round-4 panel: the import's server-wins
      // skip must not strip a skipped-but-newer row's protection). Untouched
      // rows never re-upload, so deletions made elsewhere stay deleted.
      const alreadyImported =
        window.localStorage.getItem(MERGED_KEY) === userId;
      if (!alreadyImported) {
        if (mergeableRatings.length > 0) {
          const inserted = await mergeLocalRatingsToServer(
            supabase,
            userId,
            mergeableRatings,
          );
          // Only latch the flag on a run that actually completed — a failed
          // merge (null) must retry next sign-in, not be marked done.
          if (inserted !== null && getCacheEpoch() === epoch) {
            writeMergedFlag(userId);
            // Ack journal entries ONLY for rows the merge actually INSERTED
            // (round-4, Claude + Codex corroborated), and per-row WITH the
            // stamp of the snapshot row that was uploaded (round-5, Claude):
            // a barId-only clear violated the stamp invariant — a tap landing
            // while the merge was in flight replaces the entry with a newer
            // stamp, and that newer write's protection must survive this ack.
            for (const barId of inserted) {
              const uploaded = mergeableRatings.find((r) => r.barId === barId);
              if (uploaded) ackRatingDirty(barId, uploaded.ratedAt);
            }
          }
        } else if (getCacheEpoch() === epoch) {
          // Nothing to import: the one-time import is vacuously complete.
          // Latch it, or the pending check reports a pending import forever
          // for every account that first signed in on an empty device, and
          // the residual wipe never fires for them again (V8-2 round-2).
          writeMergedFlag(userId);
        }
      }
      {
        // Journaled-write retry — runs on EVERY sign-in pass, whether or not
        // the import just ran.
        const dirtyEntries = getDirtyRatingEntries();
        if (dirtyEntries.length > 0) {
          // Ownership re-check directly before uploading (round-4, Codex
          // critical): a stale tab's write can land between the guard at
          // effect start and here.
          if (readCacheOwner() !== null && readCacheOwner() !== userId) return;
          const local = loadRatings().filter((r) => !isSeededDemoRating(r));
          for (const entry of dirtyEntries) {
            const row = local.find((r) => r.barId === entry.barId);
            if (entry.op === 'd') {
              // A journaled signed-in DELETE. The stamp guards it: the
              // server only removes a row not newer than the delete, so a
              // rating re-created on another device survives (round-4,
              // Codex).
              const ok = await deleteServerRating(
                supabase,
                userId,
                entry.barId,
                entry.stamp,
              );
              if (ok) ackRatingDirty(entry.barId, entry.stamp);
            } else if (row) {
              // Upsert intent with a live row — retry with the row's own
              // ratedAt so a genuinely newer write elsewhere wins LWW.
              const ok = await upsertServerRating(
                supabase,
                userId,
                entry.barId,
                row.rating,
                typeof row.score === 'number' ? row.score : undefined,
                row.ratedAt,
              );
              if (ok) ackRatingDirty(entry.barId, entry.stamp);
            } else {
              // Upsert intent with no local row: the row was since removed
              // locally (local-mode clear withdraws intent). Never replay a
              // delete that was not made signed-in (round-4, Claude:
              // anonymous clears must not erase the account's server data).
              // Ack by THIS entry's stamp (round-5, Claude): a tap re-rating
              // the bar mid-loop creates a newer entry that must survive.
              ackRatingDirty(entry.barId, entry.stamp);
            }
          }
        }
      }

      // V7 pairwise transcript continuity. One-time per (browser, user):
      // append-only rows deduped server-side by exact tuple, so latch-gating
      // cannot strand data (nothing writes the local transcript anymore) and
      // re-running cannot resurrect anything.
      if (window.localStorage.getItem(PAIRWISE_MERGED_KEY) !== userId) {
        const transcript = loadComparisons();
        if (transcript.length > 0) {
          const pwMerged = await mergeLocalComparisonsToServer(
            supabase,
            userId,
            transcript,
            null,
          );
          if (pwMerged !== null && getCacheEpoch() === epoch) {
            writePairwiseMergedFlag(userId);
          }
        } else if (getCacheEpoch() === epoch) {
          writePairwiseMergedFlag(userId);
        }
      }

      // Journal snapshot BEFORE the fetch (round-4 panel, Codex): a write
      // acked while the fetch is in flight vanishes from the live journal,
      // and hydrating from the pre-write snapshot then reverted it. The
      // union of before/after snapshots keeps any row that was journaled at
      // ANY point during the flight. A write created AND acked entirely
      // inside the flight escapes both snapshots (cycle-2 panel, Codex) —
      // `fetchStartedAt` catches it: any local row stamped after the fetch
      // began is newer than the snapshot by construction and is retained.
      // Remaining accepted transient: a DELETE created+acked entirely
      // in-flight can re-render for one fetch cycle; the next hydrate heals
      // it and no data is lost (documented in V8-DATA-CONTINUITY).
      const dirtyAtFetchStart = getDirtyRatingEntries();
      const fetchStartedAt = Date.now();
      const server = await fetchServerRatings(supabase);
      // null = fetch FAILED (not "no ratings") — keep whatever we have
      // rather than blanking state / wiping the localStorage cache (B0.3).
      if (!cancelled && server !== null && getCacheEpoch() === epoch) {
        // Ownership re-check before committing the hydrate (round-4, Codex
        // critical): a stale tab on the previous account can write between
        // the effect-start guard and here; committing would adopt its rows
        // into THIS account's state and cache.
        if (readCacheOwner() !== null && readCacheOwner() !== userId) return;
        // Local rows worth keeping over the server snapshot (V8-2 round-3):
        //   - before the import latched (or its merge just failed): ALL local
        //     rows — they may exist nowhere else yet.
        //   - after: ONLY journaled upsert rows (a tap during this fetch
        //     marks dirty, so the tap-in-flight race is covered). Keeping
        //     every absent-from-server row here is what resurrected
        //     deletions made on another device.
        // Seeded demo entries are excluded either way — hydrating them into
        // signed-in state re-created the pollution migration 0003 cleaned up.
        const importedNow =
          window.localStorage.getItem(MERGED_KEY) === userId;
        const dirtyUnion = new Map(
          [...dirtyAtFetchStart, ...getDirtyRatingEntries()].map((e) => [
            e.barId,
            e.op,
          ]),
        );
        const localRows = loadRatings().filter((r) => !isSeededDemoRating(r));
        const keepLocal = importedNow
          ? localRows.filter(
              (r) =>
                dirtyUnion.get(r.barId) === 'u' ||
                Date.parse(r.ratedAt) >= fetchStartedAt,
            )
          : localRows;
        const merged = mergeFreshest(server, keepLocal).filter(
          // A journaled signed-in DELETE whose server delete hasn't acked
          // yet: drop the server row from state instead of resurrecting the
          // bar the user just cleared.
          (r) => !importedNow || dirtyUnion.get(r.barId) !== 'd',
        );
        setRatings(merged);
        // Ownership gets its OWN key (V8-2 review). The cache now holds THIS
        // account's data and must never look anonymous, or the foreign and
        // residual guards would let a later account merge it. That signal
        // used to be the merged-for latch — which also meant "import done",
        // so one failed import was never retried and, when the session later
        // expired, clearResidualAccountCache wiped the rows that had never
        // reached the server. Ownership here, import bookkeeping above.
        //
        // BEFORE the data write (V8-2 round-2, Codex + DeepSeek): if the tab
        // dies or storage fills between the two, account data with no owner
        // key reads as anonymous and the next account merges it.
        writeCacheOwner(userId);
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
    (barId: string, rating: Rating, score?: number): void => {
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
            typeof score === 'number'
              ? score
              : !tierChanged && typeof prevEntry?.score === 'number'
                ? prevEntry.score
                : undefined;
          const entry: BarRating =
            keptScore === undefined ? nextEntry : { ...nextEntry, score: keptScore };

          // Optimistic UI update.
          setRatings((prev) => {
            const filtered = prev.filter((r) => r.barId !== barId);
            return [...filtered, entry];
          });
          // Mark ownership on the WRITE, not only after a successful hydrate
          // (V8-2 round-3 review): a signed-in session whose every hydrate
          // fetch fails still writes account data here, and without an owner
          // key that data looks anonymous — clearResidualAccountCache would
          // not fire on expiry and the next account would merge it in.
          //
          // BEFORE the data write (V8-2 round-1, DeepSeek): if storage is
          // failing, an owner with no data is harmless, data with no owner is
          // the cross-account leak.
          writeCacheOwner(auth.user.id);
          // Journal BEFORE the fire-and-forget write (V8-2 round-3): until
          // the server acks, this row exists nowhere else — the journal is
          // what blocks the residual/sign-out wipe and drives the sign-in
          // retry when the ack never comes. Stamped with this write's own
          // ratedAt so only ITS ack clears it (round-4).
          markRatingDirty(barId, entry.ratedAt, 'u');
          // Write-through localStorage cache so the sign-out fallback stays
          // coherent with server-mode writes (B0.3).
          setRatingLib(barId, rating, score);
          const userId = auth.user.id;
          const chainPrev =
            writeChainsRef.current.get(barId) ?? Promise.resolve();
          const chainTask = () =>
            upsertServerRating(
              supabase,
              userId,
              barId,
              rating,
              typeof score === 'number' ? score : tierChanged ? null : undefined,
              entry.ratedAt,
            ).then((ok) => {
              if (ok) {
                ackRatingDirty(barId, entry.ratedAt);
                // If the session ended while this write was in flight, the
                // seal deliberately kept the row for its pending ack; the
                // ack just landed, so run the residual clear now instead of
                // leaving synced account data visible until the next launch
                // (round-4, Codex).
                if (modeRef.current !== 'server') clearResidualAccountCache();
              }
            });
          writeChainsRef.current.set(barId, chainPrev.then(chainTask, chainTask));
          // Notify every OTHER mounted useRatings instance (self-receipt is
          // an idempotent re-apply of the optimistic update above).
          broadcastServerUpdate({ kind: 'set', entry });
          return;
        }
      }

      // Local mode (or server fell through). Journal here too: a row rated
      // while signed OUT on a device an account owns (post-seal) must survive
      // the residual wipe and upload on the owner's next sign-in.
      markRatingDirty(barId, nextEntry.ratedAt, 'u');
      setRatingLib(barId, rating, score);
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
          // Owner before data — see setRating.
          writeCacheOwner(auth.user.id);
          // Journal the signed-in delete with its own stamp: the retry is
          // LWW-guarded server-side (deleteServerRating's `at`), so it can
          // never erase a rating re-created later on another device
          // (round-4, Codex).
          const stamp = new Date().toISOString();
          markRatingDirty(barId, stamp, 'd');
          // Write-through cache (B0.3) — see setRating.
          clearRatingLib(barId);
          const userId = auth.user.id;
          const chainPrev =
            writeChainsRef.current.get(barId) ?? Promise.resolve();
          const chainTask = () =>
            deleteServerRating(supabase, userId, barId, stamp).then((ok) => {
              if (ok) {
                ackRatingDirty(barId, stamp);
                if (modeRef.current !== 'server') clearResidualAccountCache();
              }
            });
          writeChainsRef.current.set(barId, chainPrev.then(chainTask, chainTask));
          broadcastServerUpdate({ kind: 'clear', barId });
          return;
        }
      }

      // Local-mode clear WITHDRAWS any pending upsert intent instead of
      // journaling a delete (round-4, Claude): an anonymous device's local
      // clear has no server meaning, and replaying it after a later sign-in
      // deleted the account's real rating made on another device.
      clearRatingsDirty([barId]);
      clearRatingLib(barId);
      setRatings(loadRatings());
    },
    [auth],
  );

  return { ratings, getRating, setRating, clearRating };
}

function writeMergedFlag(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MERGED_KEY, userId);
  } catch {
    // Quota / private mode — non-fatal; merge will just re-run next sign-in.
  }
}

function writePairwiseMergedFlag(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PAIRWISE_MERGED_KEY, userId);
  } catch {
    // Non-fatal — the transcript import re-runs next sign-in.
  }
}
