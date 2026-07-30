'use client';

import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch, guardAgainstForeignCache } from '@/lib/accountCache';
import { syncVibeProfile } from '@/lib/vibeProfileSync';

/**
 * Vibe profile sign-in synchronization (G1). Mounted once in the root layout,
 * following the CatalogRefresh / ServiceWorkerRegister pattern.
 *
 * Anonymous users do no network work at all — the effect returns before
 * touching Supabase, so the local-only path is completely unchanged.
 *
 * The reconciliation itself lives in lib/vibeProfileSync so every branch is
 * unit-testable without React; this component only supplies the auth trigger
 * and the epoch guard.
 */
export default function VibeProfileSync(): null {
  const auth = useAuth();

  useEffect(() => {
    if (auth.status !== 'signed-in') return;

    const supabase = getBrowserSupabase();
    if (!supabase) return;

    const userId = auth.user.id;
    // Wipe a foreign cache BEFORE the sync can read it as "local data".
    // This is what stops account B from uploading account A's profile.
    guardAgainstForeignCache(userId);

    let cancelled = false;
    // Captured BEFORE any await: a sign-out landing mid-flight bumps the
    // epoch, and every cache write in the sync is gated on this comparison.
    const epoch = getCacheEpoch();

    void syncVibeProfile({
      supabase,
      userId,
      stillCurrent: () => !cancelled && getCacheEpoch() === epoch,
    });

    return () => {
      cancelled = true;
    };
    // auth.user is only read when status is 'signed-in'; keying on the id
    // keeps this to one run per account rather than one per auth object.
  }, [auth.status, auth.status === 'signed-in' ? auth.user.id : null]);

  return null;
}
