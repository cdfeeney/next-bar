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

const ALL_KEYS = [
  RATINGS_KEY,
  RATINGS_MERGED_KEY,
  PAIRWISE_KEY,
  PAIRWISE_MERGED_KEY,
] as const;

export function clearAccountCache(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of ALL_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Private mode / quota — non-fatal; the sign-in guard is the backstop.
  }
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
      window.localStorage.getItem(PAIRWISE_MERGED_KEY) !== null;
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
