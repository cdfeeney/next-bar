'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_FOLLOWS } from '@/lib/demo/friends';

const KEY = 'next-bar:follows:v1';

/**
 * Who the user follows, by handle. Demo behavior: on a fresh device (nothing
 * stored) the user already follows a couple of curators so the Friends feed
 * and consensus are populated immediately — but not everyone, so there's
 * still a live "Follow" button to demonstrate. Follow/unfollow persists.
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

export type UseFollowsReturn = {
  follows: string[];
  isFollowing: (handle: string) => boolean;
  toggleFollow: (handle: string) => void;
  /** True until the first client read resolves, to avoid a hydration flash. */
  loading: boolean;
};

export function useFollows(): UseFollowsReturn {
  const [follows, setFollows] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setFollows(loadFollows());
    setLoading(false);

    function handleStorage(event: StorageEvent): void {
      if (event.key === KEY || event.key === null) {
        setFollows(loadFollows());
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const isFollowing = useCallback(
    (handle: string) => follows.includes(handle),
    [follows],
  );

  const toggleFollow = useCallback((handle: string) => {
    setFollows((prev) => {
      const next = prev.includes(handle)
        ? prev.filter((h) => h !== handle)
        : [...prev, handle];
      writeFollows(next);
      return next;
    });
  }, []);

  return { follows, isFollowing, toggleFollow, loading };
}
