'use client';

import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  clearResidualAccountCache,
  guardAgainstForeignCache,
  sealAccountCacheOnSignOut,
} from '@/lib/accountCache';

export type AuthState =
  | { status: 'loading'; user: null; session: null }
  | { status: 'signed-out'; user: null; session: null }
  | { status: 'signed-in'; user: User; session: Session }
  | { status: 'unavailable'; user: null; session: null };

const LOADING: AuthState = { status: 'loading', user: null, session: null };
const SIGNED_OUT: AuthState = { status: 'signed-out', user: null, session: null };
const UNAVAILABLE: AuthState = { status: 'unavailable', user: null, session: null };

export function useAuth(): AuthState & { signOut: () => Promise<void> } {
  const [state, setState] = useState<AuthState>(LOADING);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setState(UNAVAILABLE);
      return;
    }

    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const session = data.session;
      if (session) {
        // The foreign-cache guard belongs to the sign-in LIFECYCLE, not to
        // whichever data hook happens to mount first (V8-2 final panel,
        // Codex): useRatings runs it too, but a page without useRatings —
        // a deep-linked first mount after sign-in — rendered the previous
        // account's personal FOREIGN_ONLY_KEYS unguarded. Idempotent; the
        // hooks' own calls remain as defense in depth.
        guardAgainstForeignCache(session.user.id);
        setState({ status: 'signed-in', user: session.user, session });
      } else {
        // A session that ended while the app was closed (expiry/revocation)
        // never went through signOut() — clear its cache residue so one
        // account's data can't render as "anonymous" data on a shared
        // device. No-op for genuinely anonymous browsers (flag-gated).
        clearResidualAccountCache();
        setState(SIGNED_OUT);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (session) {
        // Same lifecycle guard as getSession above — a sign-in completing in
        // THIS tab must wipe a foreign cache before any surface renders it.
        guardAgainstForeignCache(session.user.id);
        setState({ status: 'signed-in', user: session.user, session });
      } else {
        // Non-button sign-outs (expiry, revocation, another tab's SDK
        // sign-out) land here — same residue rule as above.
        clearResidualAccountCache();
        setState(SIGNED_OUT);
      }
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    await supabase.auth.signOut();
    // SEAL, don't destroy (V8-2 round-3): synced data is cleared, unsynced
    // rows are kept under the still-latched owner, and the owner marker
    // survives so a different account signing in later still triggers the
    // foreign wipe of the personal keys. See lib/accountCache.ts.
    sealAccountCacheOnSignOut();
  };

  return { ...state, signOut };
}
