'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_FOLLOWS } from '@/lib/demo/friends';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  fetchFollows,
  followByHandle,
  unfollowByHandle,
  unfollowById,
  type PublicProfile,
} from '@/lib/follows.server';
import { getCacheEpoch } from '@/lib/accountCache';

const KEY = 'next-bar:follows:v1';

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
  mode: FollowsMode;
  isFollowing: (handle: string) => boolean;
  toggleFollow: (handle: string) => void;
  /** True until the first read (local or server fetch) resolves. */
  loading: boolean;
};

export function useFollows(): UseFollowsReturn {
  const auth = useAuth();
  const [localFollows, setLocalFollows] = useState<string[]>([]);
  const [circle, setCircle] = useState<PublicProfile[]>([]);
  const [mode, setMode] = useState<FollowsMode>('pending');
  const [loading, setLoading] = useState(true);
  const modeRef = useRef<FollowsMode>('pending');
  // Mirror for event-handler reads (the toggle callback must see the
  // current circle without re-binding on every change).
  const circleRef = useRef<PublicProfile[]>([]);
  circleRef.current = circle;

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
      // Clear the server circle so it can't linger across a sign-out and
      // feed a stale optimistic toggle for the NEXT identity (DeepSeek
      // review — transient UI only, but the ref must never cross users).
      setCircle([]);
      setLocalFollows(loadFollows());
      setLoading(false);
      return;
    }

    modeRef.current = 'server';
    setMode('server');
    setLoading(true);

    let cancelled = false;
    // Epoch guard (accountCache): a sign-out wipe while this fetch is in
    // flight must abandon the hydrate — `cancelled` alone flips too late
    // (at React commit) to prevent repopulating post-wipe state.
    const epoch = getCacheEpoch();
    void (async () => {
      const server = await fetchFollows(supabase);
      if (cancelled || getCacheEpoch() !== epoch) return;
      // null = fetch FAILED (not "zero friends") — keep prior state rather
      // than blanking a circle on a transient failure. Never fall back to
      // the demo seed here: demo handles aren't real accounts.
      if (server !== null) setCircle(server);
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
        // Optimistic remove; restore on server refusal. Unfollow by the id
        // the circle entry already carries — the by-handle variant burned a
        // unit of the shared 500/day search cap per unfollow (Opus review).
        // Placeholder entries (id still resolving) fall back to by-handle.
        setCircle((prev) =>
          prev.filter((p) => p.handle.toLowerCase() !== target),
        );
        const unfollow = existing.id
          ? unfollowById(supabase, existing.id)
          : unfollowByHandle(supabase, existing.handle);
        void unfollow.then((removed) => {
          if (removed || getCacheEpoch() !== epoch) return;
          setCircle((prev) =>
            prev.some((p) => p.handle.toLowerCase() === target)
              ? prev
              : [...prev, existing],
          );
        });
        return;
      }

      // Optimistic add with a placeholder entry (id unknown until the
      // handle resolves); the resolved profile replaces it, a null result
      // rolls it back.
      const placeholder: PublicProfile = {
        id: '',
        handle: handle.trim().replace(/^@/, ''),
        displayName: null,
      };
      setCircle((prev) => [...prev, placeholder]);
      void followByHandle(supabase, handle).then((profile) => {
        if (getCacheEpoch() !== epoch) return;
        setCircle((prev) => {
          const without = prev.filter(
            (p) => p.handle.toLowerCase() !== target,
          );
          return profile ? [...without, profile] : without;
        });
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

  return {
    follows: mode === 'server' ? circle.map((p) => p.handle) : localFollows,
    circle: mode === 'server' ? circle : [],
    mode,
    isFollowing,
    toggleFollow,
    loading,
  };
}
