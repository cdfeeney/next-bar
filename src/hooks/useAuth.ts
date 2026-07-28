'use client';

import { useSyncExternalStore } from 'react';
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

/**
 * ONE session subscription per page, shared by every consumer.
 *
 * This used to be per-component: each `useAuth()` call ran its own effect
 * issuing `getSession()` AND registering its own `onAuthStateChange`. Both
 * take the exclusive `lock:sb-<ref>-auth-token` Web Lock that supabase-js
 * wraps session access in, so the cost scaled with the number of mounted
 * consumers.
 *
 * That is fine at ten consumers and fatal at a thousand. `BarPicker` renders
 * a `RatingBadge` per catalog row (975 rows today), each badge calls
 * `useRatings`, and each `useRatings` called `useAuth` — roughly 1,950 lock
 * acquisitions in one tick. On WebKit the queue never drains: measured
 * 1 lock held and 1,317 still pending, permanently. Every later authenticated
 * call then hangs forever, which is how opening "Suggest a bar" on iOS wedged
 * `suggest_bar` and left the button stuck disabled
 * (e2e/suggestions.spec.ts:203 and :345).
 *
 * Started lazily on first subscribe and deliberately never torn down: the
 * mount/unmount churn of a large list would otherwise re-acquire the same
 * locks repeatedly, which is the behavior we are removing.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let sharedState: AuthState = LOADING;
let started = false;

function setSharedState(next: AuthState): void {
  sharedState = next;
  for (const notify of listeners) notify();
}

function applySession(session: Session | null): void {
  if (session) {
    setSharedState({ status: 'signed-in', user: session.user, session });
    return;
  }
  // A session that ended while the app was closed (expiry/revocation) never
  // went through signOut() — clear its cache residue so one account's data
  // can't render as "anonymous" data on a shared device. No-op for genuinely
  // anonymous browsers (flag-gated).
  clearResidualAccountCache();
  setSharedState(SIGNED_OUT);
}

let authSubscription: { unsubscribe: () => void } | null = null;

function startAuthWatch(): void {
  if (started) return;
  started = true;

  const supabase = getBrowserSupabase();
  if (!supabase) {
    setSharedState(UNAVAILABLE);
    return;
  }

  void supabase.auth.getSession().then(({ data }) => {
    applySession(data.session);
  });

  // Non-button sign-outs (expiry, revocation, another tab's SDK sign-out)
  // land here — same residue rule as above.
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    applySession(session);
  });
  authSubscription = data.subscription;
}


function subscribe(onStoreChange: Listener): () => void {
  startAuthWatch();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot(): AuthState {
  return sharedState;
}

/** SSR has no session; every consumer renders the loading branch. */
function getServerSnapshot(): AuthState {
  return LOADING;
}

async function signOut(): Promise<void> {
  const supabase = getBrowserSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
  // The write-through cache holds THIS account's server data — it must not
  // survive into the next session on a shared browser (cross-account
  // contamination; see lib/accountCache.ts).
  clearAccountCache();
}

export function useAuth(): AuthState & { signOut: () => Promise<void> } {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...state, signOut };
}

/**
 * Test-only reset of the shared subscription. Module state would otherwise
 * leak the first test's auth across every later test in the same file.
 */
export function __resetAuthWatchForTests(): void {
  // Drop the REAL supabase listener too. Clearing only the module locals left
  // the previous onAuthStateChange subscription alive, so each reset stacked
  // another permanent listener and one auth event applied N times.
  authSubscription?.unsubscribe();
  authSubscription = null;
  listeners.clear();
  sharedState = LOADING;
  started = false;
}
