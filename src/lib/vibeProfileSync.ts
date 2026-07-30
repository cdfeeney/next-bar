import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadProfile,
  readProfileOwner,
  writeProfile,
  writeProfileOwner,
  type StoredProfile,
} from '@/lib/storedProfile';
import {
  fetchServerVibeProfile,
  upsertServerVibeProfile,
} from '@/lib/vibeProfile.server';

/**
 * Vibe profile sign-in synchronization (G1).
 *
 * The bug this fixes: the quiz result lived ONLY in localStorage, so it
 * vanished on device switch, storage clear, the Safari↔PWA boundary, and
 * account switch. Ratings and pairwise both already sync; the profile did not.
 *
 * SHAPE: the profile stays a synchronous localStorage read for every consumer
 * (settings, WhereNextFlow, useSuggestions) — this module is a WRITE-THROUGH
 * sync layer, exactly like useRatings. Nothing downstream becomes async.
 *
 * THE CONFLICT RULE (total, deterministic — no case falls through):
 *   - server absent, local present  → upload local
 *   - local absent, server present  → hydrate server        (second device)
 *   - both present, local newer     → upload local           (offline retake)
 *   - both present, server newer    → hydrate server
 *   - both present, TIE             → server wins
 *   - both absent                   → no-op
 * Ties losing matches the 0033 `vibe_profiles_lww` trigger, which skips any
 * UPDATE whose saved_at is not STRICTLY newer. Client and server therefore
 * agree, rather than the client believing it wrote something the DB dropped.
 *
 * ORDERING (each step exists to close a specific hole):
 *   1. caller runs guardAgainstForeignCache BEFORE this — a foreign cache must
 *      be wiped before anything here can read it as "local data"
 *   2. fetch the server row, THEN read local (a quiz finished during the fetch
 *      must not be reconciled against a pre-await snapshot)
 *   3. latch ownership on the successful FETCH, before any write can fail —
 *      an unmarked cache is what the residual/foreign guards treat as
 *      anonymous data and would hand to the next account to sign in
 *   4. decide by the rule above
 *   5. after an upload, RE-READ: a no-error upsert may have been silently
 *      skipped by the LWW trigger, so adopt whatever the server actually holds
 *   6. every cache write is gated on the epoch, so a sign-out landing
 *      mid-flight cannot re-pollute a just-wiped cache
 * Retry is driven by the conflict rule, not by the marker: an unsynced local
 * profile is still newer than the server row, so the next sync uploads it.
 */

export type SyncOutcome =
  | 'uploaded'
  | 'hydrated'
  | 'in-sync'
  | 'nothing-to-sync'
  | 'upload-failed'
  | 'fetch-failed'
  | 'aborted';

export type SyncDeps = {
  supabase: SupabaseClient;
  userId: string;
  /**
   * Returns false once a sign-out (cache wipe) has landed since this run
   * began. Every cache write is gated on it: React's `cancelled` cleanup
   * flips at commit, which can be AFTER an in-flight fetch resolves, so it
   * cannot by itself stop a just-wiped cache from being re-polluted.
   */
  stillCurrent: () => boolean;
};

/** Strictly-newer comparison on the ISO savedAt. Ties are NOT newer. */
function isStrictlyNewer(candidate: StoredProfile, than: StoredProfile): boolean {
  return Date.parse(candidate.savedAt) > Date.parse(than.savedAt);
}

/**
 * Content equality, ignoring savedAt. Used to decide whether a confirmation
 * read actually disagrees with what we tried to write — two rows can share a
 * savedAt and still hold different tags, neighborhoods, or archetype.
 * Order-insensitive on the arrays: the same taste recorded in a different
 * order is the same profile, and treating it as a difference would cause an
 * endless hydrate/upload churn between two devices.
 */
function isSameProfile(a: StoredProfile, b: StoredProfile): boolean {
  const sameSet = (x: readonly string[], y: readonly string[]) =>
    x.length === y.length && [...x].sort().join('|') === [...y].sort().join('|');
  return (
    a.archetype === b.archetype &&
    sameSet(a.tags, b.tags) &&
    sameSet(a.preferredNeighborhoods, b.preferredNeighborhoods)
  );
}

/**
 * Reconcile the local and server vibe profile for a signed-in user.
 *
 * Callers must have already run `guardAgainstForeignCache(userId)`.
 */
export async function syncVibeProfile({
  supabase,
  userId,
  stillCurrent,
}: SyncDeps): Promise<SyncOutcome> {
  const server = await fetchServerVibeProfile(supabase);

  // null = the fetch FAILED (transport/RLS), which is not "no profile".
  // Uploading now could clobber a newer server row we simply could not read,
  // so do nothing and leave the marker unlatched: this retries next sign-in.
  if (server === null) return 'fetch-failed';

  if (!stillCurrent()) return 'aborted';

  // Read local AFTER the await, not before. A quiz completed while the fetch
  // was in flight sits in the write-through cache with a newer savedAt than a
  // pre-await snapshot would have had; reconciling against the stale snapshot
  // could hydrate an older server row straight over that fresh result.
  const local = loadProfile();

  // OWNERSHIP is established by a SUCCESSFUL FETCH, not by a successful write.
  // Latch it here, before any write can fail. Rationale: an UNMARKED cache is
  // what clearResidualAccountCache and guardAgainstForeignCache classify as
  // "genuine anonymous data" and preserve for a first-sign-in merge. If a
  // failed upload left the cache unmarked, this account's profile could later
  // be merged into a DIFFERENT account that signs in on the same browser.
  // useRatings.ts:298 latches on the same basis for exactly this reason.
  //
  // This does NOT falsely mark the data synchronized: nothing reads this
  // marker as a sync receipt. Retry is driven by the conflict rule below
  // (local newer than server => upload again), so an unsynced local profile
  // is still retried on the next sign-in.
  writeProfileOwner(userId);

  // --- server absent -------------------------------------------------------
  if (server === 'absent') {
    if (!local) return 'nothing-to-sync';
    return uploadAndReconcile(supabase, userId, local, stillCurrent);
  }

  // --- local absent --------------------------------------------------------
  if (!local) {
    writeProfile(server);
    return 'hydrated';
  }

  // --- both present --------------------------------------------------------
  if (isStrictlyNewer(local, server)) {
    return uploadAndReconcile(supabase, userId, local, stillCurrent);
  }

  // Server strictly newer, OR a tie. Both hydrate the server copy.
  //
  // The tie MUST write, not just return: local and server can share a savedAt
  // and still differ in content (two devices deriving different archetypes
  // within the same millisecond, or a restored backup). Latching ownership and
  // leaving the local payload in place would leave this device displaying its
  // own variant forever while every other device shows the server's — silent,
  // permanent divergence reported as "in sync". Ties resolve to the server so
  // that the client agrees with the 0033 LWW trigger, which rejects any
  // non-strictly-newer UPDATE.
  writeProfile(server);
  return isStrictlyNewer(server, local) ? 'hydrated' : 'in-sync';
}

/**
 * Upload a local profile, then confirm what the server actually holds.
 *
 * A no-error upsert means "the server ACCEPTED the request", not "the server
 * stored this row": the 0033 LWW trigger silently skips an UPDATE whose
 * saved_at is not strictly newer. If another device wrote a newer row between
 * our fetch and our upsert, our write was dropped and reporting 'uploaded'
 * would leave this device on stale local data believing it had synced. So
 * re-read and hydrate whatever is authoritative.
 */
async function uploadAndReconcile(
  supabase: SupabaseClient,
  userId: string,
  local: StoredProfile,
  stillCurrent: () => boolean,
): Promise<SyncOutcome> {
  const written = await upsertServerVibeProfile(supabase, userId, local);
  if (written === null) return 'upload-failed';
  if (!stillCurrent()) return 'aborted';

  const confirmed = await fetchServerVibeProfile(supabase);
  if (!stillCurrent()) return 'aborted';
  // A failed confirmation read does not invalidate the write; keep local as-is
  // and let the next sync reconcile rather than guessing.
  if (confirmed === null || confirmed === 'absent') return 'uploaded';

  // Our write lost to a strictly newer concurrent row — adopt the winner.
  if (isStrictlyNewer(confirmed, local)) {
    writeProfile(confirmed);
    return 'hydrated';
  }

  // THE LOSING TIE. Two devices upserting different content with the SAME
  // savedAt: the first lands as an INSERT (the LWW trigger only guards UPDATE)
  // and the second is silently skipped with no error. The loser's confirmation
  // read then returns the winner's content at an EQUAL savedAt, so a
  // strictly-newer gate alone would report 'uploaded' and leave this device
  // displaying content the server does not hold. All four review lanes found
  // this; the equal-timestamp qualifier is load-bearing.
  //
  // Do NOT generalise this to "any content difference": a confirmation read
  // that returns an OLDER row (replica lag) must never overwrite newer local
  // data. Two tests in this file pin exactly that.
  if (
    Date.parse(confirmed.savedAt) === Date.parse(local.savedAt) &&
    !isSameProfile(confirmed, local)
  ) {
    writeProfile(confirmed);
    return 'in-sync';
  }
  return 'uploaded';
}

/**
 * Push a just-saved profile to the server, if signed in.
 *
 * Used at quiz completion. The local save already happened and is
 * authoritative for the UI; this is best-effort.
 *
 * `stillCurrent` is REQUIRED, not optional. Without it, an account switch
 * landing while the upsert is in flight would latch the ownership marker for
 * the account that has just been signed OUT — stamping the wrong owner onto a
 * cache that now holds the new account's data, which then trips the foreign
 * guard and wipes the new user's ratings, pairwise and profile for no reason.
 * Every other cache write in this feature is epoch-gated; so is this one.
 */
export async function pushVibeProfile(
  supabase: SupabaseClient,
  userId: string,
  profile: StoredProfile,
  stillCurrent: () => boolean,
): Promise<boolean> {
  const written = await upsertServerVibeProfile(supabase, userId, profile);
  if (written === null) return false;
  if (!stillCurrent()) return false;
  writeProfileOwner(userId);
  return true;
}

/** Exposed for tests that need the exact comparison semantics. */
export const __testables = { isStrictlyNewer };
