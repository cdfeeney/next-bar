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
 *   1. `sealAccountCacheOnSignOut()` — explicit sign-out clears synced data,
 *      keeps anything unsynced, and always keeps the owner marker.
 *   2. `guardAgainstForeignCache(userId)` — called when a user signs IN; if
 *      any ownership signal names a DIFFERENT user, the cache is someone
 *      else's residue (e.g. session expired without our sign-out button) and
 *      is wiped — account data AND personal keys — before any merge can
 *      read it.
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

/**
 * Unacked-write journal (V8-2 round-3, Codex + DeepSeek): the `:merged-for:`
 * latch only proves the ONE-TIME import finished — it says nothing about a
 * later fire-and-forget write-through whose server upsert failed. Those rows
 * exist nowhere else, yet the latch made them look disposable. Every local
 * write records its bar here; a confirmed server ack clears it. A non-empty
 * journal blocks the residual/sign-out wipe exactly like a pending import,
 * and sign-in retries exactly these rows (no blind re-merge, so deletions
 * made on another device stay deleted).
 *
 * Shape: JSON `Record<barId, {s: stamp, op: 'u'|'d'}>` — the STAMP of the
 * latest local write (its ratedAt / delete time) and whether the pending
 * intent is an upsert or a delete. Stamps, not counts (V8-2 round-4 panel,
 * Codex): localStorage read-modify-write is not atomic across tabs, so two
 * racing writes could collapse one count and the older ack then erased the
 * newer write's protection. With stamps, an ack clears the entry only when
 * it matches the exact write it acknowledges; a newer write's entry (later
 * stamp, last-writer-wins on the single key) survives an older ack.
 * `op: 'd'` entries are created ONLY by signed-in deletes — an anonymous
 * device's local clear must never replay as a server delete against an
 * account's real data (round-4 panel, Claude).
 */
const DIRTY_KEY = 'next-bar:dirty:v1';

export type DirtyEntry = { barId: string; stamp: string; op: 'u' | 'd' };

const ALL_KEYS = [
  RATINGS_KEY,
  RATINGS_MERGED_KEY,
  PAIRWISE_KEY,
  PAIRWISE_MERGED_KEY,
  FOLLOWS_KEY,
  DIRTY_KEY,
  OWNER_KEY,
] as const;

/**
 * Account-data keys — everything wiped by a seal/residual clear. OWNER_KEY is
 * deliberately NOT here: the seal keeps ownership latched so a later foreign
 * sign-in still wipes the personal FOREIGN_ONLY_KEYS (V8-2 round-3: removing
 * the owner at sign-out made the next account inherit the previous user's
 * lists, profile, and night history).
 */
const DATA_KEYS = ALL_KEYS.filter((key) => key !== OWNER_KEY);

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
  // A session claiming ownership supersedes any deferred sign-out cleanup —
  // the pending rows now belong to a live session again.
  sealDeferredPendingAcks = false;
  try {
    window.localStorage.setItem(OWNER_KEY, userId);
  } catch {
    // Private mode / quota — the merged-for latches remain as a fallback
    // owner signal, so the guards below still fire.
  }
}

/**
 * The current cache owner, or null for an anonymous device. Exported for the
 * hooks' async sign-in blocks: the synchronous foreign-cache guard runs at
 * effect start, but ownership can change while a merge/fetch is in flight —
 * re-checking against this before any upload closes the mid-flight
 * cross-account race (V8-2 round-3, DeepSeek critical).
 */
export function readCacheOwner(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

type JournalValue = { s: string; op: 'u' | 'd' };

function readDirtyJournal(): Record<string, JournalValue> {
  try {
    // getItem itself is inside the try (round-4 panel, Codex): with storage
    // access disabled it THROWS, and an uncaught throw here aborted the
    // caller's write path after its optimistic state update.
    const raw = window.localStorage.getItem(DIRTY_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, JournalValue> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        v !== null &&
        typeof v === 'object' &&
        typeof (v as JournalValue).s === 'string' &&
        ((v as JournalValue).op === 'u' || (v as JournalValue).op === 'd')
      ) {
        out[k] = v as JournalValue;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeDirtyJournal(journal: Record<string, JournalValue>): void {
  try {
    if (Object.keys(journal).length === 0) {
      window.localStorage.removeItem(DIRTY_KEY);
    } else {
      window.localStorage.setItem(DIRTY_KEY, JSON.stringify(journal));
    }
  } catch {
    // Quota / private mode — non-fatal. An unrecorded dirty mark degrades to
    // the pre-journal behavior (the row is protected only until the latch
    // matches), never to a new loss class.
  }
}

/**
 * A local write whose server ack has not landed yet. Call BEFORE the write,
 * with the write's own stamp (the row's ratedAt, or the delete time).
 * Last-writer-wins per bar: a newer write overwrites the entry, so an older
 * in-flight ack (stamp mismatch) cannot clear the newer write's protection.
 */
export function markRatingDirty(
  barId: string,
  stamp: string,
  op: 'u' | 'd' = 'u',
): void {
  if (typeof window === 'undefined') return;
  const journal = readDirtyJournal();
  journal[barId] = { s: stamp, op };
  writeDirtyJournal(journal);
}

/**
 * A confirmed server ack for one specific write. Clears the entry ONLY when
 * the stamp still matches that write — a newer local write has replaced the
 * entry and must keep its protection (round-4 panel, Codex ×2).
 */
export function ackRatingDirty(barId: string, stamp: string): void {
  if (typeof window === 'undefined') return;
  const journal = readDirtyJournal();
  const entry = journal[barId];
  if (entry === undefined || entry.s !== stamp) return;
  delete journal[barId];
  writeDirtyJournal(journal);
}

/** Drop entries outright (local delete withdrew the intent; stale no-row entries). */
export function clearRatingsDirty(barIds: readonly string[]): void {
  if (typeof window === 'undefined') return;
  const journal = readDirtyJournal();
  for (const id of barIds) delete journal[id];
  writeDirtyJournal(journal);
}

export function getDirtyRatingEntries(): DirtyEntry[] {
  if (typeof window === 'undefined') return [];
  return Object.entries(readDirtyJournal()).map(([barId, v]) => ({
    barId,
    stamp: v.s,
    op: v.op,
  }));
}

export function getDirtyRatingIds(): string[] {
  if (typeof window === 'undefined') return [];
  return Object.keys(readDirtyJournal());
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

/**
 * Abandon every in-flight sync loop without touching stored data (cycle-5
 * panel, Claude + Codex converged on the drain gap): Settings "Clear ALL
 * bar ratings" bumps the epoch FIRST, so a concurrently running sign-in
 * retry loop (which checks the epoch per entry) stops enqueueing before the
 * drain snapshots the chains — otherwise its stale upserts landed after the
 * server delete and restored cleared rows.
 */
export function abandonInFlightSyncs(): void {
  cacheEpoch += 1;
}

export function clearAccountCache(): void {
  if (typeof window === 'undefined') return;
  cacheEpoch += 1;
  sealDeferredPendingAcks = false;
  try {
    for (const key of ALL_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Private mode / quota — non-fatal; the sign-in guard is the backstop.
  }
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
    // Ownerless caches have nothing deferred — the flag stays untouched.
    if (owner === null) return false;
    // Granular, per-surface (round-4 panel, Codex): one pending ratings row
    // must not keep the whole otherwise-synced cache visible. Each surface
    // clears independently; only a surface with data that exists nowhere
    // else survives.
    const ratingsPending =
      (hasRows(RATINGS_KEY) &&
        window.localStorage.getItem(RATINGS_MERGED_KEY) !== owner) ||
      Object.keys(readDirtyJournal()).length > 0;
    const pairwisePending =
      hasRows(PAIRWISE_KEY) &&
      window.localStorage.getItem(PAIRWISE_MERGED_KEY) !== owner;
    cacheEpoch += 1;
    if (!ratingsPending) {
      for (const key of [RATINGS_KEY, RATINGS_MERGED_KEY, DIRTY_KEY]) {
        window.localStorage.removeItem(key);
      }
    }
    if (!pairwisePending) {
      for (const key of [PAIRWISE_KEY, PAIRWISE_MERGED_KEY]) {
        window.localStorage.removeItem(key);
      }
    }
    // Follows are server-authoritative demo state — never pending.
    window.localStorage.removeItem(FOLLOWS_KEY);
    // The owner marker ALWAYS survives (V8-2 round-3). Ownership is what
    // lets guardAgainstForeignCache() wipe the personal FOREIGN_ONLY_KEYS
    // when a DIFFERENT account signs in next — removing it here made
    // post-sign-out devices look anonymous and handed the previous user's
    // lists/profile/night history to the next account.
    const fullyCleared = !ratingsPending && !pairwisePending;
    // The deferred flag is managed HERE, not only in the sign-out button's
    // seal (cycle-3 closing panel, Claude + Codex converged on this): a
    // cross-tab or expiry sign-out reaches this function directly, and
    // leaving the flag unset re-opened the exact ack-vs-auth-transition gap
    // the flag exists to close. Every sign-out flavor that must KEEP
    // pending data now defers, whatever path led here.
    sealDeferredPendingAcks = !fullyCleared;
    return fullyCleared;
  } catch {
    return false;
  }
}

/**
 * Explicit sign-out: SEAL the cache, never destroy it (V8-2 round-3 — all
 * four reviewers converged here). Unconditional `clearAccountCache()` had two
 * defects:
 *
 *   1. It ignored pending imports/unacked writes, permanently destroying
 *      rows that had never reached the server.
 *   2. It removed the owner marker, so the personal FOREIGN_ONLY_KEYS were
 *      inherited by whoever signed in next (they were never in ALL_KEYS, and
 *      the foreign guard had no owner signal left to fire on).
 *
 * Semantics now: synced data is cleared (same signed-out UX as before),
 * anything unsynced is kept under the still-latched owner, and the owner
 * marker ALWAYS survives. The next sign-in resolves it: same account → its
 * pending rows retry-upload; different account → the foreign guard wipes
 * account data AND the personal keys.
 */
/**
 * True between a seal that had to KEEP pending data and the moment the cache
 * is fully cleared or re-owned. An in-flight write's ack callback consults
 * this instead of React state (cycle-3 panel, Codex): the auth change
 * propagates to hook refs one render late, so an ack landing in that
 * microtask gap used to skip the deferred cleanup and synced data lingered
 * until the next launch — contradicting the documented contract.
 */
let sealDeferredPendingAcks = false;

export function isSealDeferred(): boolean {
  return sealDeferredPendingAcks;
}

export function sealAccountCacheOnSignOut(): void {
  if (typeof window === 'undefined') return;
  // Always bump: any in-flight hydrate belongs to the session that just
  // ended and must abandon its writes, wipe or no wipe. The deferred flag
  // is managed inside clearResidualAccountCache so every sign-out flavor
  // (button, expiry, cross-tab) gets identical semantics.
  cacheEpoch += 1;
  clearResidualAccountCache();
}

/**
 * Account DELETION — the one flow that hard-destroys everything, personal
 * keys included (round-4 panel, Claude + Codex): the deleted owner can never
 * return, so sealing would preserve data forever, and `clearAccountCache`
 * alone removed the ownership signal while LEAVING the personal
 * FOREIGN_ONLY_KEYS — the next account then passed the foreign guard and
 * inherited the deleted user's lists, night history, and vibe profile. The
 * strongest erase action must leave the least residue.
 */
export function destroyAccountDataOnDeletion(): void {
  if (typeof window === 'undefined') return;
  clearAccountCache();
  try {
    for (const key of FOREIGN_ONLY_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Private mode / quota — the account-cache wipe above already ran.
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
