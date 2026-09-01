'use client';

import { useEffect, useState } from 'react';
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
 */
export function useOwnProfile(): OwnProfile {
  const auth = useAuth();
  const [handle, setHandle] = useState<string | null>(null);
  const [known, setKnown] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState<boolean | null>(null);
  const [consentLive, setConsentLive] = useState(false);

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
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let cancelled = false;
    const epoch = getCacheEpoch();
    void fetchOwnProfile(supabase).then((profile) => {
      if (cancelled || getCacheEpoch() !== epoch || profile === null) return;
      setHandle(profile.handle);
      setKnown(true);
      setDisplayName(profile.displayName);
      setIsPrivate(profile.isPrivate);
    });
    void fetchOutgoingRequests(supabase).then((outgoing) => {
      if (cancelled || getCacheEpoch() !== epoch) return;
      setConsentLive(outgoing !== null);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  return {
    handle,
    displayName,
    isPrivate,
    known,
    consentLive,
    setHandle,
    setDisplayName,
    setIsPrivate,
  };
}
