'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  acceptFollowRequest,
  declineFollowRequest,
  fetchFollowRequests,
  type FollowRequest,
} from '@/lib/follows.server';
import { getCacheEpoch } from '@/lib/accountCache';

/**
 * Incoming follow requests — the target-side inbox (B3b). Server mode only:
 * requests only exist for signed-in private accounts, so there is no local/
 * demo counterpart and no localStorage key (nothing to register in
 * accountCache ALL_KEYS; sign-out clears the in-memory state below).
 *
 * Accept/decline are optimistic with rollback (useFollows pattern): the row
 * leaves the inbox immediately; a server refusal puts it back. Accepting
 * creates the follower's edge on THEIR side — the caller's own circle is
 * untouched, so no useFollows refresh is needed.
 */
export type UseFollowRequestsReturn = {
  /** Incoming requests, newest first. [] when signed out. */
  requests: FollowRequest[];
  accept: (requesterId: string) => void;
  decline: (requesterId: string) => void;
  /** True until the first fetch resolves (signed-in only). */
  loading: boolean;
};

export function useFollowRequests(): UseFollowRequestsReturn {
  const auth = useAuth();
  const [requests, setRequests] = useState<FollowRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const requestsRef = useRef<FollowRequest[]>([]);
  requestsRef.current = requests;

  useEffect(() => {
    if (auth.status === 'loading') return;

    const supabase =
      auth.status === 'signed-in' ? getBrowserSupabase() : null;

    if (auth.status !== 'signed-in' || !supabase) {
      // Sign-out: clear so an inbox can't linger into the next identity.
      setRequests([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;
    const epoch = getCacheEpoch();
    void (async () => {
      const inbox = await fetchFollowRequests(supabase);
      if (cancelled || getCacheEpoch() !== epoch) return;
      // null = fetch failed (or pre-0008 RPC missing) — keep prior state.
      if (inbox !== null) setRequests(inbox);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.status, auth.status === 'signed-in' ? auth.user.id : null]);

  const resolve = useCallback(
    (requesterId: string, action: 'accept' | 'decline') => {
      const supabase = getBrowserSupabase();
      if (!supabase) return;
      const entry = requestsRef.current.find((r) => r.id === requesterId);
      if (!entry) return;

      const epoch = getCacheEpoch();
      // Optimistic removal; a server refusal restores the row.
      setRequests((prev) => prev.filter((r) => r.id !== requesterId));
      const call =
        action === 'accept'
          ? acceptFollowRequest(supabase, requesterId)
          : declineFollowRequest(supabase, requesterId);
      void call.then((ok) => {
        if (ok || getCacheEpoch() !== epoch) return;
        // Rollback re-sorts by requestedAt so a restored row lands where it
        // was, preserving the inbox's newest-first invariant (Opus review).
        setRequests((prev) =>
          prev.some((r) => r.id === requesterId)
            ? prev
            : [entry, ...prev].sort((a, b) =>
                b.requestedAt.localeCompare(a.requestedAt),
              ),
        );
      });
    },
    [],
  );

  const accept = useCallback(
    (requesterId: string) => resolve(requesterId, 'accept'),
    [resolve],
  );
  const decline = useCallback(
    (requesterId: string) => resolve(requesterId, 'decline'),
    [resolve],
  );

  return { requests, accept, decline, loading };
}
