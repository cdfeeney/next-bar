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

/**
 * Circle writes the server has not confirmed yet, keyed by normalized handle.
 *
 * MODULE scope on purpose: a navigation unmounts the hook, and the next page's
 * fresh mount would otherwise fetch a snapshot that predates a follow the user
 * has already requested — then report `circleReady` over it and let a night out
 * go out without that person (round-3 panel, Codex, HIGH). Per-instance state
 * cannot see across that unmount; this can. Unfollows are tracked the same way:
 * a snapshot taken mid-unfollow can still carry someone you just dropped.
 */
const pendingCircleWrites = new Set<string>();
const pendingListeners = new Set<() => void>();

function markCircleWrite(handle: string, pending: boolean): void {
  if (pending) pendingCircleWrites.add(handle);
  else pendingCircleWrites.delete(handle);
  for (const listener of pendingListeners) listener();
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
  const [circleReady, setCircleReady] = useState(false);
  const [pendingWrites, setPendingWrites] = useState(pendingCircleWrites.size);
  const modeRef = useRef<FollowsMode>('pending');
  // Mirrors for event-handler reads (the toggle callback must see the
  // current circle/requested without re-binding on every change).
  const circleRef = useRef<PublicProfile[]>([]);
  circleRef.current = circle;
  const requestedRef = useRef<PublicProfile[]>([]);
  requestedRef.current = requested;

  // Re-render when a circle write settles anywhere in the app — the pending set
  // lives outside React, so it needs its own subscription to move `circleReady`.
  useEffect(() => {
    const listener = (): void => setPendingWrites(pendingCircleWrites.size);
    pendingListeners.add(listener);
    listener();
    return () => {
      pendingListeners.delete(listener);
    };
  }, []);

  // Storage listener — cross-tab propagation for local mode only (server
  // mode never writes the key, so there is nothing to hear).
  useEffect(() => {
    function handleStorage(event: StorageEvent): void {
      if (modeRef.current === 'server') return;
      if (event.key === KEY || event.key === null) {
        setLocalFollows(loadFollows());
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
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
      setCircleReady(true); // local mode: no fetch, nothing to fail
      setLoading(false);
      return;
    }

    modeRef.current = 'server';
    setMode('server');
    setLoading(true);
    setCircleReady(false);

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
      // null = fetch FAILED (not "zero friends") — keep prior state rather
      // than blanking a circle on a transient failure. Never fall back to
      // the demo seed here: demo handles aren't real accounts.
      if (server !== null) {
        setCircle(server);
        setCircleReady(true);
      }
      // Pre-0008 the outgoing RPC doesn't exist yet → null → keep [] (no
      // requests can exist before the migration lands either).
      if (outgoing !== null) setRequested(outgoing);
      // Same rule pre-0010 for followers.
      if (followerList !== null) setFollowers(followerList);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.status, auth.status === 'signed-in' ? auth.user.id : null]);

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
        markCircleWrite(target, true);
        void unfollowById(supabase, existing.id).then((removed) => {
          // Cleared FIRST, and unconditionally: an early return past this on a
          // sign-out epoch change would strand the handle and pin circleReady
          // false for the rest of the session.
          markCircleWrite(target, false);
          if (removed || getCacheEpoch() !== epoch) return;
          setCircle((prev) =>
            prev.some((p) => p.handle.toLowerCase() === target)
              ? prev
              : [...prev, existing],
          );
        });
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
        void cancelFollowRequest(supabase, pending.id).then((removed) => {
          if (removed || getCacheEpoch() !== epoch) return;
          setRequested((prev) =>
            prev.some((p) => p.handle.toLowerCase() === target)
              ? prev
              : [...prev, pending],
          );
        });
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
      markCircleWrite(target, true);
      void followByHandle(supabase, handle).then((outcome) => {
        markCircleWrite(target, false); // see the unfollow path: always cleared
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
      });
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
    circleReady: mode === 'server' ? circleReady && pendingWrites === 0 : true,
  };
}
