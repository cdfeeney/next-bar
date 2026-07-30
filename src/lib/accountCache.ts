import { notifyProfileChanged } from '@/lib/storedProfile';

/**
 * Per-account localStorage cache guard (santa-loop round-1 fix).
 *
 * In server mode the ratings/pairwise hooks write-through to localStorage so
 * sign-out fallback and cross-hook reads stay coherent. That cache belongs to
 * ONE account. Both independent reviewers flagged the same critical bug: with
 * no sign-out wipe, a SECOND account signing in on the same browser saw the
 * first user's cached data as "local ratings" and silently merged them into
 * its own server account (cross-account contamination + privacy leak).
 *
 * Two layers of defense:
 *   1. `clearAccountCache()` — called on explicit sign-out.
 *   2. `guardAgainstForeignCache(userId)` — called when a user signs IN; if
 *      either merged-for flag names a DIFFERENT user, the cache is someone
 *      else's residue (e.g. session expired without our sign-out button) and
 *      is wiped before any merge can read it.
 */

const RATINGS_KEY = 'next-bar:ratings:v1';
const RATINGS_MERGED_KEY = 'next-bar:ratings:merged-for:v1';
const PAIRWISE_KEY = 'next-bar:pairwise:v1';
const PAIRWISE_MERGED_KEY = 'next-bar:pairwise:merged-for:v1';
// B3: follows became a server-synced surface — its localStorage key joins
// the guard (blueprint rule; the cross-account guard only protects
// registered keys). No merged-for flag: local demo follows are never merged
// into an account (demo handles aren't real profiles), so there's no
// ownership latch to track — a wipe just re-seeds the demo circle.
const FOLLOWS_KEY = 'next-bar:follows:v1';
// G1: the vibe profile became a server-synced surface (migration 0033), so
// its keys join the guard under the same B3 blueprint rule as follows above.
// Both are registered: the payload so it cannot outlive the account that
// owns it, and the marker so ownership is tracked like ratings/pairwise.
//
// CONSEQUENCE, accepted deliberately: signing out now DELETES the local
// profile, where previously it survived. That is the correct trade — after
// sign-out the browser is anonymous, and continuing to show the previous
// account's vibe profile is exactly the cross-account leak this module
// exists to prevent. Retaking the quiz is a 30-second cost; leaking one
// user's taste profile to the next person on a shared phone is not.
const PROFILE_KEY = 'next-bar:profile:v1';
const PROFILE_MERGED_KEY = 'next-bar:profile:merged-for:v1';

const ALL_KEYS = [
  RATINGS_KEY,
  RATINGS_MERGED_KEY,
  PAIRWISE_KEY,
  PAIRWISE_MERGED_KEY,
  FOLLOWS_KEY,
  PROFILE_KEY,
  PROFILE_MERGED_KEY,
] as const;

/**
 * Monotonic wipe counter. An async hydrate captures the epoch when it
 * starts and re-checks before writing: if a wipe happened in between, the
 * write is abandoned. Closes the sign-out-races-in-flight-fetch window —
 * React's `cancelled` cleanup only flips at commit, which can be AFTER the
 * fetch resolves but after the wipe already ran (routed review finding).
 */
let cacheEpoch = 0;

export function getCacheEpoch(): number {
  return cacheEpoch;
}

export function clearAccountCache(): void {
  if (typeof window === 'undefined') return;
  cacheEpoch += 1;
  try {
    for (const key of ALL_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Private mode / quota — non-fatal; the sign-in guard is the backstop.
  }
  // Same-document notification (G1). removeItem fires no `storage` event in the
  // document that wrote, so mounted consumers holding this account's data in
  // React state would keep RENDERING it after the wipe — on an account switch
  // that means account A's vibe tags showing to account B. The app already has
  // ten `storage` subscribers; dispatching the real event type reaches them all
  // and each simply re-reads its own key.
  notifyProfileChanged();
}

/**
 * Wipe residue left by a signed-in session that ended WITHOUT our sign-out
 * button (refresh-token expiry, revocation, SDK sign-out in another tab).
 * Gated on the merged-for flags: they exist only after a sign-in, so a
 * genuinely anonymous browser — which resolves to signed-out on every
 * mount — never has its local ratings wiped by this.
 * Returns true when residue was cleared.
 */
export function clearResidualAccountCache(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const hadOwner =
      window.localStorage.getItem(RATINGS_MERGED_KEY) !== null ||
      window.localStorage.getItem(PAIRWISE_MERGED_KEY) !== null ||
      // G1: a user who signed in and synced ONLY a vibe profile (took the
      // quiz, rated nothing) still left account residue. Without this the
      // profile marker was the one ownership signal the residual guard
      // could not see.
      window.localStorage.getItem(PROFILE_MERGED_KEY) !== null;
    if (hadOwner) clearAccountCache();
    return hadOwner;
  } catch {
    return false;
  }
}

/**
 * Wipe the cache if it demonstrably belongs to a different account.
 * Returns true when a foreign cache was cleared.
 *
 * A cache with NO merged-for flag is genuine anonymous data (pre-first-sign-in)
 * and is left alone — merging that into the signing-in account is the intended
 * first-sign-in behavior. This is sound because the hooks latch the flag as an
 * OWNERSHIP marker on every server hydrate (not only after a merge) — see the
 * santa round-3 fix in useRatings/usePairwise; a signed-in account can never
 * leave flag-less data in the cache.
 */
export function guardAgainstForeignCache(currentUserId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const owners = [
      window.localStorage.getItem(RATINGS_MERGED_KEY),
      window.localStorage.getItem(PAIRWISE_MERGED_KEY),
      // G1: a foreign profile marker wipes everything, exactly as a foreign
      // ratings or pairwise marker does. Keeping the wipe GLOBAL rather than
      // per-key is deliberate — one proven-foreign marker means this browser
      // holds someone else's residue, and narrowing the wipe to just the
      // key that happened to carry the marker would weaken a guard that
      // already prevented a real cross-account leak.
      window.localStorage.getItem(PROFILE_MERGED_KEY),
    ];
    const isForeign = owners.some(
      (owner) => owner !== null && owner !== currentUserId,
    );
    if (isForeign) clearAccountCache();
    return isForeign;
  } catch {
    return false;
  }
}
