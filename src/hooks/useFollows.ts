'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_FOLLOWS } from '@/lib/demo/friends';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  cancelFollowRequest,
  deriveMutuals,
  fetchFollowers,
  fetchFollows,
  fetchOutgoingRequests,
  followByHandle,
  unfollowById,
  type PublicProfile,
} from '@/lib/follows.server';
import { getCacheEpoch } from '@/lib/accountCache';

const KEY = 'next-bar:follows:v1';

/** Cross-tab "the circle moved" ping. The value only has to CHANGE. */
const DIRTY_KEY = 'next-bar:follows:dirty';

/**
 * Is the circle snapshot we are holding still current?
 *
 * Two module-level facts answer that, and both are module-level on purpose: a
 * navigation unmounts the hook, so per-instance state cannot see across it.
 *
 *   - `pendingCircleWrites` — writes the server has not answered yet. Keyed by
 *     a unique OPERATION id, never by handle: two overlapping writes for the
 *     same handle would alias, and the first to settle would release readiness
 *     for both (round-4 panel, Claude).
 *   - `circleGeneration` — bumped whenever a write SETTLES, here or in another
 *     tab. Readiness is pinned to the generation its fetch started at, so a
 *     settled write invalidates an older snapshot in the same render rather
 *     than merely emptying the pending set — which released readiness over a
 *     snapshot taken before the write committed (round-4 panel, BOTH lanes).
 *
 * The rule this encodes: a snapshot is ready when the server answered it AND
 * nothing has happened since. Clearing "in flight" was never the same thing.
 */
const pendingCircleWrites = new Set<number>();
const circleListeners = new Set<() => void>();
let nextCircleWriteId = 0;
let circleGeneration = 0;

function notifyCircleListeners(): void {
  for (const listener of circleListeners) listener();
}

/** Another tab settled a write — our snapshot is stale too. */
function invalidateCircle(): void {
  circleGeneration += 1;
  notifyCircleListeners();
}

/**
 * Open a circle write. The returned finisher is idempotent and MUST run on
 * every exit path — a stranded marker pins `circleReady` false for the rest of
 * the session, which is why the callers below use `finally` and not `then`
 * (round-4 panel, Codex: a rejected promise stranded it).
 */
function beginCircleWrite(): () => void {
  nextCircleWriteId += 1;
  const id = nextCircleWriteId;
  pendingCircleWrites.add(id);
  notifyCircleListeners();
  return () => {
    if (!pendingCircleWrites.delete(id)) return;
    invalidateCircle();
    try {
      // Tell the other tabs. Theirs is the same snapshot, equally stale.
      window.localStorage.setItem(DIRTY_KEY, `${Date.now()}:${nextCircleWriteId}`);
    } catch {
      // Quota/private mode — this tab still reconciles; the others just won't.
    }
  };
}

/**
 * Dual-mode follows (B3), cloned from the useRatings pattern:
 *
 *   - signed-out  → localStorage demo circle (handles of seeded curators;
 *                   fresh devices start following DEFAULT_FOLLOWS).
 *   - signed-in   → the REAL social graph via migration-0007 RPCs. The demo
 *                   seed is IGNORED entirely — demo handles aren't real
 *                   accounts, so unlike ratings there is NO merge-once step
 *                   and no merged-for flag; server truth is the whole circle.
 *   - unavailable → localStorage (Supabase env missing).
 *
 * Server-mode writes are optimistic with rollback (a follow that the server
 * declines — rate cap, unknown handle — must not linger in the circle).
 * Server mode never touches the localStorage key; the key is still
 * registered in accountCache ALL_KEYS (blueprint rule: every server-synced
 * surface joins the cross-account guard) so sign-out wipes it.
 */
function loadFollows(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return [...DEFAULT_FOLLOWS];
    const parsed = JSON.parse(raw) as unknown;
    // A syntactically-valid but non-array value (e.g. `null`, `{}`) is corrupt storage — recover the
    // seeded default circle rather than silently emptying it (matches the catch branch).
    if (!Array.isArray(parsed)) return [...DEFAULT_FOLLOWS];
    return parsed.filter((h): h is string => typeof h === 'string');
  } catch {
    return [...DEFAULT_FOLLOWS];
  }
}

function writeFollows(handles: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(handles));
    // NOTE: do NOT dispatch a synthetic 'storage' event here. It was fired from inside the setFollows
    // updater, which synchronously re-entered setFollows during React's update phase and dropped the
    // toggle in the browser (caught by friends-flow e2e). Real cross-tab writes already fire 'storage'
    // in OTHER tabs; there is a single useFollows instance per page, so no same-tab sync is needed.
  } catch {
    // non-fatal
  }
}

function normalize(handle: string): string {
  return handle.trim().replace(/^@/, '').toLowerCase();
}

export type FollowsMode = 'pending' | 'local' | 'server';

export type UseFollowsReturn = {
  /** Followed handles (display casing in server mode, demo handles locally). */
  follows: string[];
  /** Server mode only: the handle-resolved circle. [] in local mode. */
  circle: PublicProfile[];
  /**
   * Server mode only: outgoing follow requests still awaiting the private
   * target's consent (B3b). [] in local mode — demo profiles are public.
   */
  requested: PublicProfile[];
  /** Server mode only: who follows YOU (0010). [] in local mode. */
  followers: PublicProfile[];
  /** Server mode only: mutual follows — the FRIENDS list (B3c). */
  mutuals: PublicProfile[];
  mode: FollowsMode;
  isFollowing: (handle: string) => boolean;
  /** True when a request to this handle is pending ("Requested" button). */
  isRequested: (handle: string) => boolean;
  toggleFollow: (handle: string) => void;
  /** True until the first read (local or server fetch) resolves. */
  loading: boolean;
  /**
   * Server mode: the last completed hydrate FAILED (the RPC returned null).
   * Distinct from `!circleReady`, which is also false while a write is merely
   * unsettled — telling the user "couldn't load your circle" in that case is a
   * lie, and the advice that follows it ("reload") discards their write
   * (round-5 panel, Claude). Always false in local mode.
   */
  circleFailed: boolean;
  /**
   * Server mode: TRUE only once `circle` actually reflects the server's answer
   * AND no circle write is still in flight.
   *
   * A failed fetch resolves `loading` but leaves `circle` empty, and an empty
   * circle is indistinguishable from "no friends" — which is how a night out
   * could still be started with nobody invited even after the loading guard
   * (round-2 panel, Codex, HIGH). A follow the user requested a moment ago on
   * another page is the same lie told the other way round: the snapshot is
   * genuine, and already out of date (round-3 panel, Codex, HIGH).
   *
   * Always true in local mode: there is no fetch to fail. Callers deriving an
   * invitee list must require this, not `!loading`.
   */
  circleReady: boolean;
};

export function useFollows(): UseFollowsReturn {
  const auth = useAuth();
  const [localFollows, setLocalFollows] = useState<string[]>([]);
  const [circle, setCircle] = useState<PublicProfile[]>([]);
  const [requested, setRequested] = useState<PublicProfile[]>([]);
  const [followers, setFollowers] = useState<PublicProfile[]>([]);
  const [mode, setMode] = useState<FollowsMode>('pending');
  const [loading, setLoading] = useState(true);
  // The generation the current `circle` was fetched at, or null if we have no
  // server answer. A number, not a boolean: readiness has to be able to go
  // stale, and a boolean can only say "we finished a fetch once".
  const [readyGeneration, setReadyGeneration] = useState<number | null>(null);
  // Mirror for the effect, which must know whether this is a FIRST read or a
  // background revalidation without taking readyGeneration as a dependency.
  const readyGenerationRef = useRef<number | null>(null);
  readyGenerationRef.current = readyGeneration;
  const [fetchFailed, setFetchFailed] = useState(false);
  // Writes THIS instance has open. `readyGeneration === null` does not mean
  // "this mount has not written" — a mount can follow someone while its very
  // first hydrate is still in the air, and that hydrate would then erase the
  // placeholder and flip the button back to Follow (round-8 panel, Codex).
  const instanceWritesRef = useRef(0);
  const [circleState, setCircleState] = useState(() => ({
    generation: circleGeneration,
    pending: pendingCircleWrites.size,
  }));
  const modeRef = useRef<FollowsMode>('pending');
  // Mirrors for event-handler reads (the toggle callback must see the
  // current circle/requested without re-binding on every change).
  const circleRef = useRef<PublicProfile[]>([]);
  circleRef.current = circle;
  const requestedRef = useRef<PublicProfile[]>([]);
  requestedRef.current = requested;

  // Re-render when a circle write starts or settles anywhere in the app — that
  // state lives outside React, so it needs its own subscription.
  useEffect(() => {
    const listener = (): void =>
      setCircleState({
        generation: circleGeneration,
        pending: pendingCircleWrites.size,
      });
    circleListeners.add(listener);
    listener();
    return () => {
      circleListeners.delete(listener);
    };
  }, []);

  // Storage listener — cross-tab propagation for local mode only (server
  // mode never writes the key, so there is nothing to hear).
  useEffect(() => {
    function handleStorage(event: StorageEvent): void {
      // The cross-tab ping matters in SERVER mode especially, so it is handled
      // before the local-mode guard below (round-4 panel, Codex): another tab
      // following someone leaves this tab's snapshot stale.
      if (event.key === DIRTY_KEY) {
        invalidateCircle();
        return;
      }
      if (modeRef.current === 'server') return;
      if (event.key === KEY || event.key === null) {
        setLocalFollows(loadFollows());
      }
    }
    // The cross-tab ping is best-effort — a quota or private-mode failure
    // swallows it (round-5 panel, Codex). Re-checking when the tab comes back
    // costs one hydrate and does not depend on the other tab having succeeded.
    function handleVisible(): void {
      if (document.visibilityState === 'visible') invalidateCircle();
    }
    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, []);

  // Auth-driven mode switch (useRatings pattern, minus the merge step —
  // demo follows must never merge into a real account).
  useEffect(() => {
    if (auth.status === 'loading') return;

    const supabase =
      auth.status === 'signed-in' ? getBrowserSupabase() : null;

    if (auth.status !== 'signed-in' || !supabase) {
      modeRef.current = 'local';
      setMode('local');
      // Clear the server circle + pending requests so they can't linger
      // across a sign-out and feed a stale optimistic toggle for the NEXT
      // identity (DeepSeek review — transient UI only, but the refs must
      // never cross users).
      setCircle([]);
      setRequested([]);
      setFollowers([]);
      setLocalFollows(loadFollows());
      setReadyGeneration(null); // local mode reports ready without this
      setLoading(false);
      return;
    }

    modeRef.current = 'server';
    setMode('server');

    // A REVALIDATION is not a load. Re-running this effect on every settled
    // write used to flip `loading` back to true, and /friends/following and
    // /friends/followers replace their whole list with a "Loading…" placeholder
    // while it is (round-5 panel, Claude, HIGH). `loading` means "we have never
    // read"; staleness is `circleReady`'s job, and it goes false on its own
    // because readyGeneration no longer equals the current generation.
    const isRevalidation = readyGenerationRef.current !== null;
    if (!isRevalidation) {
      setLoading(true);
      setReadyGeneration(null);
    }

    // The generation this fetch answers FOR. Anything that settles while it is
    // in flight bumps the module counter, so the result lands stale and the
    // effect below re-runs on the new generation rather than being trusted.
    const fetchGeneration = circleGeneration;
    let cancelled = false;
    // Epoch guard (accountCache): a sign-out wipe while this fetch is in
    // flight must abandon the hydrate — `cancelled` alone flips too late
    // (at React commit) to prevent repopulating post-wipe state.
    const epoch = getCacheEpoch();
    void (async () => {
      const [server, outgoing, followerList] = await Promise.all([
        fetchFollows(supabase),
        fetchOutgoingRequests(supabase),
        fetchFollowers(supabase),
      ]);
      if (cancelled || getCacheEpoch() !== epoch) return;

      // SUPERSEDED: something changed while this was in the air. Applying it
      // would overwrite newer optimistic state with an older snapshot and erase
      // the placeholder the double-tap guard depends on (round-5 panel, both
      // lanes). Whatever moved the generation also queues the next fetch, and a
      // draining pending set bumps it too, so dropping this answer loses
      // nothing.
      if (circleGeneration !== fetchGeneration || pendingCircleWrites.size > 0) {
        // One exception, and it is the FIRST answer this mount has had
        // (round-7 panel, Claude). Discarding it outright while clearing
        // `loading` told the user an empty circle was settled fact, and
        // /friends/following renders "Not following anyone yet" from exactly
        // that — to someone who has friends. Holding `loading` instead just
        // trades the lie for a spinner.
        //
        // A first mount has no optimistic state to clobber — placeholders are
        // per-instance and this instance has made no write — so the reason to
        // drop a superseded answer does not apply to DISPLAYING it. It is still
        // not marked ready: it predates whatever is in flight, and the next
        // fetch (already queued) is what earns that.
        if (
          readyGenerationRef.current === null
          && instanceWritesRef.current === 0
          && server !== null
        ) {
          setCircle(server);
          if (outgoing !== null) setRequested(outgoing);
          if (followerList !== null) setFollowers(followerList);
          setFetchFailed(false);
          setLoading(false);
        }
        return;
      }

      setLoading(false);
      setFetchFailed(server === null);

      // null = fetch FAILED (not "zero friends") — keep prior state rather
      // than blanking a circle on a transient failure. Never fall back to
      // the demo seed here: demo handles aren't real accounts.
      if (server !== null) {
        setCircle(server);
        setReadyGeneration(fetchGeneration);
      }
      // Pre-0008 the outgoing RPC doesn't exist yet → null → keep [] (no
      // requests can exist before the migration lands either).
      if (outgoing !== null) setRequested(outgoing);
      // Same rule pre-0010 for followers.
      if (followerList !== null) setFollowers(followerList);
    })();

    return () => {
      cancelled = true;
    };
    // circleState.generation is a dependency, not an afterthought: a settled
    // write anywhere — this page, another page, another tab — must re-hydrate
    // rather than merely release the pending flag over the old snapshot.
  }, [
    auth.status,
    auth.status === 'signed-in' ? auth.user.id : null,
    circleState.generation,
  ]);

  const isFollowing = useCallback(
    (handle: string) => {
      const target = normalize(handle);
      return mode === 'server'
        ? circle.some((p) => p.handle.toLowerCase() === target)
        : localFollows.some((h) => h.toLowerCase() === target);
    },
    [mode, circle, localFollows],
  );

  const isRequested = useCallback(
    (handle: string) => {
      if (mode !== 'server') return false;
      const target = normalize(handle);
      return requested.some((p) => p.handle.toLowerCase() === target);
    },
    [mode, requested],
  );

  /** Count an open write against THIS instance for as long as it runs. */
  const trackInstanceWrite = useCallback((finish: () => void) => {
    instanceWritesRef.current += 1;
    let done = false;
    return (): void => {
      if (!done) {
        done = true;
        instanceWritesRef.current -= 1;
      }
      finish();
    };
  }, []);

  const toggleFollow = useCallback((handle: string) => {
    if (modeRef.current === 'server') {
      const supabase = getBrowserSupabase();
      if (!supabase) return;
      const target = normalize(handle);
      const epoch = getCacheEpoch();
      const existing = circleRef.current.find(
        (p) => p.handle.toLowerCase() === target,
      );

      if (existing) {
        // A placeholder (id still resolving) means a follow is IN FLIGHT —
        // ignore the tap. Treating it as an unfollowable edge let a quick
        // double-tap on a private target race the resolve: unfollowByHandle
        // found no edge (only a request row), returned false, and restored
        // a phantom "Following" alongside the settled "Requested" entry
        // (Opus B3b review). The resolve callback below owns the entry's
        // final home; the user can act again once it settles.
        if (!existing.id) return;

        // Optimistic remove; restore on server refusal. Unfollow by the id
        // the circle entry already carries — the by-handle variant burned a
        // unit of the shared 500/day search cap per unfollow (Opus review).
        setCircle((prev) =>
          prev.filter((p) => p.handle.toLowerCase() !== target),
        );
        const finishUnfollow = trackInstanceWrite(beginCircleWrite());
        const restore = (): void =>
          setCircle((prev) =>
            prev.some((p) => p.handle.toLowerCase() === target)
              ? prev
              : [...prev, existing],
          );
        void unfollowById(supabase, existing.id)
          .then((removed) => {
            if (removed || getCacheEpoch() !== epoch) return;
            restore();
          })
          // A thrown RPC is a refusal too — the old code only rolled back on an
          // explicit false, so a network error left the row gone locally and
          // present on the server.
          .catch(() => {
            if (getCacheEpoch() !== epoch) return;
            restore();
          })
          // `finally`, never `then`: an early return or a rejection past this
          // would strand the marker and pin circleReady false for the rest of
          // the session (round-4 panel, Codex).
          .finally(finishUnfollow);
        return;
      }

      // Pending request → the toggle withdraws it (B3b). Optimistic remove;
      // restore on server refusal. A placeholder entry (id still resolving)
      // has no request row yet — nothing to cancel, just drop it.
      const pending = requestedRef.current.find(
        (p) => p.handle.toLowerCase() === target,
      );
      if (pending) {
        setRequested((prev) =>
          prev.filter((p) => p.handle.toLowerCase() !== target),
        );
        if (!pending.id) return;
        // Wrapped like the other two writes (round-6 panel, BOTH lanes). It is
        // the only optimistic write that was not, and `requested` is re-read by
        // the same hydrate: a revalidation in the air across a withdrawal put
        // "Requested" back after the server had already cancelled it. That is
        // reachable only because THIS candidate added the revalidation path —
        // at the base commit the hydrate ran on auth change alone.
        const finishCancel = trackInstanceWrite(beginCircleWrite());
        const restoreRequest = (): void =>
          setRequested((prev) =>
            prev.some((p) => p.handle.toLowerCase() === target)
              ? prev
              : [...prev, pending],
          );
        void cancelFollowRequest(supabase, pending.id)
          .then((removed) => {
            if (removed || getCacheEpoch() !== epoch) return;
            restoreRequest();
          })
          .catch(() => {
            if (getCacheEpoch() !== epoch) return;
            restoreRequest();
          })
          .finally(finishCancel);
        return;
      }

      // Optimistic add with a placeholder entry (id unknown until the
      // handle resolves); the resolved profile replaces it — in the circle
      // when the server followed, in `requested` when the target is private
      // and the server filed a request instead (B3b). A null rolls it back.
      const placeholder: PublicProfile = {
        id: '',
        handle: handle.trim().replace(/^@/, ''),
        displayName: null,
      };
      setCircle((prev) => [...prev, placeholder]);
      const finishFollow = trackInstanceWrite(beginCircleWrite());
      const dropPlaceholder = (): void =>
        setCircle((prev) =>
          prev.filter((p) => p.handle.toLowerCase() !== target),
        );
      void followByHandle(supabase, handle)
        .then((outcome) => {
          if (getCacheEpoch() !== epoch) return;
          setCircle((prev) => {
            const without = prev.filter(
              (p) => p.handle.toLowerCase() !== target,
            );
            return outcome?.status === 'followed'
              ? [...without, outcome.profile]
              : without;
          });
          if (outcome?.status === 'requested') {
            setRequested((prev) =>
              prev.some((p) => p.handle.toLowerCase() === target)
                ? prev
                : [...prev, outcome.profile],
            );
          }
        })
        // A thrown RPC rolls the optimistic placeholder back, same as a null.
        .catch(() => {
          if (getCacheEpoch() !== epoch) return;
          dropPlaceholder();
        })
        .finally(finishFollow); // see the unfollow path
      return;
    }

    // Local (demo) mode — unchanged v0.4 behavior.
    setLocalFollows((prev) => {
      const next = prev.includes(handle)
        ? prev.filter((h) => h !== handle)
        : [...prev, handle];
      writeFollows(next);
      return next;
    });
  }, []);

  // Friends = mutuals (B3c). Cheap derivation; only meaningful in server
  // mode.
  const mutuals = useMemo(
    () => (mode === 'server' ? deriveMutuals(circle, followers) : []),
    [mode, circle, followers],
  );

  return {
    follows: mode === 'server' ? circle.map((p) => p.handle) : localFollows,
    circle: mode === 'server' ? circle : [],
    requested: mode === 'server' ? requested : [],
    followers: mode === 'server' ? followers : [],
    mutuals,
    mode,
    isFollowing,
    isRequested,
    toggleFollow,
    loading,
    circleFailed: mode === 'server' ? fetchFailed : false,
    circleReady:
      mode === 'server'
        ? readyGeneration !== null
          && readyGeneration === circleState.generation
          && circleState.pending === 0
        : true,
  };
}
