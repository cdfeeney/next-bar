'use client';

import { useCallback, useEffect, useState } from 'react';
import { shouldAutoRetry } from '@/components/states/useOperationalLoad';
import { useAuth } from '@/hooks/useAuth';
import { getCacheEpoch } from '@/lib/accountCache';
import { fetchOwnProfile } from '@/lib/profile.server';
import { fetchOutgoingRequests } from '@/lib/follows.server';
import { getBrowserSupabase } from '@/lib/supabase/client';

export type OwnProfile = {
  /** null = no handle claimed yet; only meaningful once `known` is true. */
  handle: string | null;
  displayName: string | null;
  /** null until the fetch lands — no flash of a wrong default. */
  isPrivate: boolean | null;
  /** True once the profile fetch has resolved. */
  known: boolean;
  /**
   * The read did not work and the silent retry budget is spent, so the next
   * attempt is the user's to ask for. `known` and `failed` are never both
   * true; both false means still trying.
   */
  failed: boolean;
  /** Ask again. Resets the silent budget. */
  retry: () => void;
  /**
   * Consent enforcement (migration 0008) is live. Until it is, showing the
   * private-account switch would DISPLAY a promise the backend cannot honour,
   * so the probe failing hides the control — fail-closed is correct here.
   */
  consentLive: boolean;
  setHandle: (handle: string) => void;
  setDisplayName: (name: string | null) => void;
  setIsPrivate: (value: boolean) => void;
};

/**
 * The signed-in user's own profile row, shared by the Account root and the
 * Settings stack. Extracted from the pre-V8 Settings page unchanged, epoch
 * guards included: a sign-out wipe mid-fetch must abandon the hydrate rather
 * than repopulate the next identity.
 *
 * A FAILED READ USED TO BE A PERMANENT "LOADING…". `known` went true only on
 * success, so one failed fetch left the Account root showing an ellipsis and
 * Edit profile showing "Loading…" for the life of the mount, with no retry and
 * nothing said. That is the exact state V8-R-OPS-001 and V8-R-OPS-007 exist to
 * forbid: a surface that has given up is not allowed to keep claiming it is
 * working.
 *
 * THE POLICY COMES FROM THE SHARED MODULE, not a second copy of it —
 * `shouldAutoRetry` is the same predicate `useOperationalLoad` applies, so the
 * cap has one definition. The hook ITSELF is not used here for one reason
 * worth stating: it has no "not applicable" state, and signed-out is not a
 * failure. Modelling `auth.status !== 'signed-in'` as a null load would spend
 * the retry budget on every signed-out render.
 *
 * `fetchOwnProfile` returns null for a read error AND for a signed-in account
 * with no row, and cannot tell them apart from here (`src/lib` is another
 * lane's). Both are reported the same way — "we couldn't load it, try again" —
 * which is true of either, and is the honest reading either way.
 */
export function useOwnProfile(): OwnProfile {
  const auth = useAuth();
  const [handle, setHandle] = useState<string | null>(null);
  const [known, setKnown] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState<boolean | null>(null);
  const [consentLive, setConsentLive] = useState(false);
  /** Consecutive failed reads since the last success. */
  const [failures, setFailures] = useState(0);
  /** Bumped to ask again — silently by the budget below, or by `retry`. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (auth.status !== 'signed-in') {
      /**
       * IDENTITY BELONGS TO THE SESSION. Returning early without clearing left
       * the previous owner's display name and @handle in React state, and the
       * Settings list happily kept rendering them on a signed-out page — the
       * one surface where showing somebody else's name is unambiguously wrong.
       * The epoch guards below stop a stale FETCH landing; nothing was undoing
       * a fetch that had already landed.
       *
       * Every non-signed-in status resets, not just `signed-out`: `useAuth`
       * only ever leaves `loading` (it never returns to it), so on mount this
       * is a no-op over values that are already null, and `unavailable` has no
       * identity to show either.
       */
      setHandle(null);
      setKnown(false);
      setDisplayName(null);
      setIsPrivate(null);
      setConsentLive(false);
      setFailures(0);
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let cancelled = false;
    const epoch = getCacheEpoch();
    void fetchOwnProfile(supabase).then(
      (profile) => {
        if (cancelled || getCacheEpoch() !== epoch) return;
        if (profile === null) {
          setFailures((count) => count + 1);
          return;
        }
        setFailures(0);
        setHandle(profile.handle);
        setKnown(true);
        setDisplayName(profile.displayName);
        setIsPrivate(profile.isPrivate);
      },
      () => {
        // A THROW IS A FAILURE TOO. Without this branch a rejected read left
        // the surface in "loading" forever — the same dead end as before, just
        // reached by the rarer path.
        if (cancelled || getCacheEpoch() !== epoch) return;
        setFailures((count) => count + 1);
      },
    );
    void fetchOutgoingRequests(supabase).then((outgoing) => {
      if (cancelled || getCacheEpoch() !== epoch) return;
      setConsentLive(outgoing !== null);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status, attempt]);

  /**
   * Spend the silent budget. Its own effect, deliberately: an updater that
   * also schedules work runs twice under React's development double-invoke and
   * would burn two attempts for one failure — the trap `useOperationalLoad`
   * documents and this hook would otherwise re-introduce.
   */
  useEffect(() => {
    if (failures > 0 && shouldAutoRetry(failures - 1)) {
      setAttempt((n) => n + 1);
    }
  }, [failures]);

  const retry = useCallback(() => {
    setFailures(0);
    setAttempt((n) => n + 1);
  }, []);

  return {
    handle,
    displayName,
    isPrivate,
    known,
    // Never both: a read that eventually lands clears `failures`, and a
    // surface that has data is not a surface that failed.
    failed: !known && failures > 0 && !shouldAutoRetry(failures - 1),
    retry,
    consentLive,
    setHandle,
    setDisplayName,
    setIsPrivate,
  };
}
