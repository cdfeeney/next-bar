'use client';

import { useSyncExternalStore } from 'react';
import {
  isAuthApiError,
  isAuthRetryableFetchError,
  type Session,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
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

/**
 * Network validation of a CACHED session (cross-device stale-session fix,
 * staging 2026-08-01). getSession() trusts the local JWT, and Supabase does
 * not invalidate issued access tokens when the auth user is deleted — so a
 * second browser kept rendering signed-in UI for a deleted account until
 * expiry. One shared getUser() round-trip per lifecycle point is the
 * authoritative "does this user still exist" check.
 *
 * Bounded by design (the WebKit Web Lock incident above is why this must
 * never become per-consumer): single-flight, one call at store start, one on
 * tab-visible at most every REVALIDATE_MIN_INTERVAL_MS, and at most one 30s
 * retry after a transport failure. Fail-open: only a definitive auth
 * rejection signs out — a dead network never erases a valid session (JWT
 * expiry is the backstop).
 */
const REVALIDATE_MIN_INTERVAL_MS = 5 * 60_000;
const VALIDATION_RETRY_DELAY_MS = 30_000;

let lastValidationAt = 0;
let validationInFlight: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityWatcherAdded = false;

/**
 * Definitive = GoTrue looked at the token and rejected it (deleted user,
 * revoked session, invalid claim). 401/403 by status, plus the two codes
 * that mean it regardless of status (GLM/DeepSeek review reconciliation:
 * status-only was one GoTrue version bump away from missing user_not_found
 * behind a different status; all-4xx would have eaten 429s). Retryable
 * transport errors are checked FIRST so a 5xx can never look definitive.
 */
function isDefinitiveAuthRejection(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return false;
  if (!isAuthApiError(error)) return false;
  if (error.status === 401 || error.status === 403) return true;
  return error.code === 'user_not_found' || error.code === 'session_not_found';
}

/**
 * Executes an INVALID verdict that belongs to exactly one token. Every
 * irreversible step re-checks that the store still holds that session (santa
 * round-1, Claude+Codex convergent): the awaited signOut spans an async gap,
 * and a sign-in landing inside it must not be clobbered by an unconditional
 * applySession(null) issued for the OLD session's verdict. Invariant for
 * future edits: no awaits between a stillTargetSession() check and the
 * irreversible call it guards.
 */
async function invalidateSession(
  supabase: SupabaseClient,
  tokenAtStart: string,
): Promise<void> {
  const stillTargetSession = (): boolean =>
    sharedState.status === 'signed-in' &&
    sharedState.session.access_token === tokenAtStart;

  if (!stillTargetSession()) return;
  // Unconditional wipe, not the flag-gated residual clear (Codex review):
  // data written before the first server hydrate carries no ownership marker,
  // and the gated clear inside applySession(null) would preserve it for the
  // NEXT account to merge. Safe: this branch only runs for a session that is
  // provably signed in at this synchronous point. MUST run BEFORE the await
  // below (santa round-3, Claude lane, verified against GoTrueClient.js):
  // the SDK awaits its own SIGNED_OUT listeners before signOut() resolves,
  // so our own onAuthStateChange flips the store mid-await and a post-await
  // ownership check no longer sees the condemned session — a wipe placed
  // there silently no-ops on the happy path.
  clearAccountCache();
  try {
    // Local scope: the server already handled the other devices (revocation
    // rides the deletion route); this browser only clears its own storage.
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Best-effort — the explicit applySession(null) below is the guarantee.
  }
  // Don't rely on the SIGNED_OUT event alone to flip the store (GLM review):
  // apply directly; both paths are idempotent. But only while the store still
  // shows the condemned session — normally the SDK's own SIGNED_OUT event has
  // already flipped it (making this a no-op), and if a NEWER session arrived
  // during the await, its own auth events drive the store instead.
  if (stillTargetSession()) applySession(null);
}

function validateCachedSession(
  supabase: SupabaseClient,
  { isRetry = false }: { isRetry?: boolean } = {},
): Promise<void> {
  if (validationInFlight) return validationInFlight;
  if (sharedState.status !== 'signed-in') return Promise.resolve();

  // Token STRING EQUALITY is the session-identity CAS primitive of every
  // guard below (Kimi review): it works because GoTrue rotates the access
  // token on refresh, so same-token ⇒ same session lineage. Do not swap in
  // any identity source that can reuse token values.
  const tokenAtStart = sharedState.session.access_token;
  // Stamped at ATTEMPT time, deliberately (Kimi review, keep as policy): a
  // failed validation still resets the 5-minute visibility throttle, trading
  // a slightly longer stale window for never thrashing getUser on a flapping
  // network. The 30s bounded retry below is the compensation.
  lastValidationAt = Date.now();
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  // let + null init rather than const: the finally below closes over `run`,
  // and TS cannot see that the first await guarantees assignment happens
  // before the closure ever reads it.
  let run: Promise<void> | null = null;
  run = (async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (!error && data?.user) return; // confirmed live — nothing to do

      if (error && isDefinitiveAuthRejection(error)) {
        // The verdict belongs to tokenAtStart; invalidateSession re-checks
        // ownership before every irreversible step.
        await invalidateSession(supabase, tokenAtStart);
        return;
      }

      // Transport failure / unknown shape: KEEP the session (fail-open) and
      // schedule at most ONE retry so a blip during startup doesn't leave a
      // deleted account signed in until the next visibility change.
      if (!isRetry) scheduleValidationRetry(supabase, tokenAtStart);
    } catch {
      // getUser threw outright (unexpected transport path) — same fail-open
      // rule as a retryable error result.
      if (!isRetry) scheduleValidationRetry(supabase, tokenAtStart);
    } finally {
      // Only release the slot this run still owns — a validation orphaned by
      // a test reset must not clear a newer run's in-flight marker (Codex
      // review) and thereby permit two concurrent validations.
      if (validationInFlight === run) validationInFlight = null;
    }
  })();
  validationInFlight = run;
  return run;
}

function scheduleValidationRetry(
  supabase: SupabaseClient,
  tokenAtStart: string,
): void {
  if (retryTimer !== null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (sharedState.status !== 'signed-in') return;
    if (sharedState.session.access_token !== tokenAtStart) return;
    void validateCachedSession(supabase, { isRetry: true });
  }, VALIDATION_RETRY_DELAY_MS);
}

function onVisibilityChange(): void {
  if (document.visibilityState !== 'visible') return;
  if (sharedState.status !== 'signed-in') return;
  if (Date.now() - lastValidationAt < REVALIDATE_MIN_INTERVAL_MS) return;
  const supabase = getBrowserSupabase();
  if (!supabase) return;
  void validateCachedSession(supabase);
}

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
    // The cached session rendered optimistically above; now verify it against
    // the server once. Deliberately AFTER applySession — flashing a loading
    // state over a session that is valid 99.9% of the time would punish
    // everyone for the deleted-account edge case.
    if (data.session) void validateCachedSession(supabase);
  });

  // Non-button sign-outs (expiry, revocation, another tab's SDK sign-out)
  // land here — same residue rule as above.
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    applySession(session);
  });
  authSubscription = data.subscription;

  // Returning to a long-backgrounded tab is the other moment a session may
  // have died server-side. One module-level listener, interval-gated above.
  if (typeof document !== 'undefined' && !visibilityWatcherAdded) {
    visibilityWatcherAdded = true;
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
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
  try {
    await supabase.auth.signOut();
  } finally {
    // The write-through cache holds THIS account's server data — it must not
    // survive into the next session on a shared browser (cross-account
    // contamination; see lib/accountCache.ts). finally: a signOut throw must
    // not be able to skip the wipe (the caller still sees the rejection).
    clearAccountCache();
  }
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
  // Validation machinery is module state too — a leaked retry timer or a
  // still-registered visibility listener would replay one test's auth into
  // the next.
  // KNOWN LIMIT, accepted (Codex review): an async continuation already in
  // flight at reset time (getSession/getUser/signOut) is not cancelled and
  // may still touch the fresh store. Tests own this risk by awaiting their
  // flows before reset; a generation-epoch mechanism in production code to
  // protect a test-only helper is not worth the complexity.
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  validationInFlight = null;
  lastValidationAt = 0;
  if (visibilityWatcherAdded && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  visibilityWatcherAdded = false;
}
