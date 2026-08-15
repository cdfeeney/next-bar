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

/**
 * Which account this device cache belongs to.
 *
 * Split out from the `:merged-for:` latches (V8-2 review): those meant BOTH
 * "the cache belongs to X" and "X's one-time import finished", so latching
 * ownership after a successful hydrate also marked the import done. A single
 * failed import was therefore never retried, and once the session later
 * expired `clearResidualAccountCache` wiped the never-uploaded rows for good.
 *
 * Now the meanings are separate: this key is ownership, and a `:merged-for:`
 * key means only that the import completed. The sign-in guard below still
 * honours old latches, so a V7/early-V8 cache cannot merge into a different
 * account; signed-out cleanup requires the explicit owner key so an upgrade
 * does not erase the user's V7 data before they sign back in.
 */
const OWNER_KEY = 'next-bar:account:owner:v1';

const ALL_KEYS = [
  RATINGS_KEY,
  RATINGS_MERGED_KEY,
  PAIRWISE_KEY,
  PAIRWISE_MERGED_KEY,
  FOLLOWS_KEY,
  OWNER_KEY,
] as const;

/**
 * Record that this cache holds `userId`'s data. Safe to call repeatedly.
 *
 * Callers write this BEFORE the data it describes. If storage is failing
 * (quota, private mode) that ordering leaves a stale owner rather than
 * ownerless account data — a stale owner is caught by
 * guardAgainstForeignCache(), ownerless data is not.
 */
export function writeCacheOwner(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OWNER_KEY, userId);
  } catch {
    // Private mode / quota — the merged-for latches remain as a fallback
    // owner signal, so the guards below still fire.
  }
}

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
}

/**
 * True when the cache still holds account data whose one-time import never
 * completed for `owner` — the `:merged-for:` latch is written only by a merge
 * that actually finished, so data present without a matching latch exists
 * NOWHERE ELSE yet.
 *
 * Load-bearing (V8-2 round-1, Codex + Claude independently): the ownership
 * split moved the residue wipe onto the owner key, but the hooks write the
 * owner key after a successful FETCH even when that session's UPLOAD failed.
 * A user who then never opened the app signed-in again before the session
 * expired lost those rows permanently on the next launch — the exact loss
 * class this whole goal gates on.
 */
function hasPendingImport(owner: string): boolean {
  const pairs = [
    [RATINGS_KEY, RATINGS_MERGED_KEY],
    [PAIRWISE_KEY, PAIRWISE_MERGED_KEY],
  ] as const;
  return pairs.some(([dataKey, mergedKey]) => {
    if (!hasRows(dataKey)) return false;
    return window.localStorage.getItem(mergedKey) !== owner;
  });
}

/**
 * Does this key hold at least one row? Parsed, not string-matched: a
 * pretty-printed or whitespace-padded `[ ]` is still empty, and a corrupt
 * payload has no rows worth blocking a wipe for. Sentinel string comparison
 * missed both and could jam the wipe permanently (DeepSeek, V8-2 round-2).
 */
function hasRows(dataKey: string): boolean {
  const raw = window.localStorage.getItem(dataKey);
  if (raw === null) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

/**
 * Wipe residue left by a signed-in session that ended WITHOUT our sign-out
 * button (refresh-token expiry, revocation, SDK sign-out in another tab).
 * Gated on the explicit owner key. Legacy merged-for keys are import
 * sentinels, not proof that a signed-out cache is disposable: treating them
 * as ownership erased V7 data during an install-over before the user signed
 * back in. They remain a fallback in guardAgainstForeignCache(), where a
 * current account id makes the ownership decision unambiguous.
 *
 * Never wipes over a pending import (see above). The owner key is deliberately
 * LEFT IN PLACE in that case, so guardAgainstForeignCache() still wipes this
 * cache the moment a different account signs in — deferring the wipe trades no
 * cross-account protection away, only the signed-out visibility of the owner's
 * own un-uploaded rows on their own device.
 *
 * Returns true when residue was cleared.
 */
export function clearResidualAccountCache(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const owner = window.localStorage.getItem(OWNER_KEY);
    if (owner === null) return false;
    if (hasPendingImport(owner)) return false;
    clearAccountCache();
    return true;
  } catch {
    return false;
  }
}

/**
 * Local-only keys that are nevertheless PERSONAL: one user's named lists,
 * Want to Go, vibe profile, night history, night vibe, tonight intent, and
 * saved bars. They are deliberately NOT in ALL_KEYS, because an ordinary
 * sign-out must not delete the device owner's own data — that is the
 * continuity rule this goal exists to protect.
 *
 * A FOREIGN sign-in is different, and only that path wipes these: the owner
 * signal already names a different account, so the device has demonstrably
 * changed hands and leaving the previous user's lists and night history on
 * screen is a privacy leak, not continuity (GLM, V8-2 round-2).
 */
const FOREIGN_ONLY_KEYS = [
  'next-bar:lists:v1',
  'next-bar:list:want-to-go:v1',
  'next-bar:profile:v1',
  'next-bar:night-log:v1',
  'next-bar:night-vibe:v1',
  'next-bar:intent:v1',
  'next-bar:saved:v1',
] as const;

/**
 * Wipe the cache if it demonstrably belongs to a different account.
 * Returns true when a foreign cache was cleared.
 *
 * A cache with NO ownership signal at all is genuine anonymous data
 * (pre-first-sign-in) and is left alone — merging that into the signing-in
 * account is the intended first-sign-in behavior. Soundness rests on the hooks
 * writing the dedicated owner key (`writeCacheOwner`) on every successful
 * hydrate AND on every server-mode write-through, before the data it
 * describes, so a signed-in account cannot leave ownerless data behind. The
 * `:merged-for:` latches are read here only as a legacy fallback, for a device
 * upgrading from V7/early-V8 that has them but no owner key.
 */
export function guardAgainstForeignCache(currentUserId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const owners = [
      window.localStorage.getItem(OWNER_KEY),
      window.localStorage.getItem(RATINGS_MERGED_KEY),
      window.localStorage.getItem(PAIRWISE_MERGED_KEY),
    ];
    const isForeign = owners.some(
      (owner) => owner !== null && owner !== currentUserId,
    );
    if (isForeign) {
      clearAccountCache();
      for (const key of FOREIGN_ONLY_KEYS) {
        window.localStorage.removeItem(key);
      }
    }
    return isForeign;
  } catch {
    return false;
  }
}
