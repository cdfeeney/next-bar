'use client';

import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  clearAccountCache,
  clearResidualAccountCache,
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
    // The write-through cache holds THIS account's server data — it must not
    // survive into the next session on a shared browser (cross-account
    // contamination; see lib/accountCache.ts).
    clearAccountCache();
  };

  return { ...state, signOut };
}
