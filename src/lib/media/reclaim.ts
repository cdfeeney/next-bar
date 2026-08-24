import type { SupabaseClient } from '@supabase/supabase-js';

import {
  claimMediaForRemoval,
  claimOrphanPaths,
  reclaimBytes,
  releaseMediaClaim,
  SWEEP_BATCH,
  type MediaClaim,
} from './destinations';
import { MEDIA_BUCKET } from './types';

/**
 * Reclamation, as something that actually RUNS (V8-R-CMP-012, V8-R-STO-016).
 *
 * 0066 can decide which bytes are reclaimable; it cannot delete them, because
 * Storage is not the database. Three review rounds reported the same defect in
 * three different disguises — expired stories never reclaimed, abandoned uploads
 * never reclaimed, silently-orphaned bytes never reclaimed — and every one of
 * them is the same missing half: eligibility with no caller. A rule nothing
 * invokes is not a mechanism.
 *
 * This module is that caller. Two populations, one pass:
 *
 *   REGISTERED — an object with a `media_objects` row. The claim is atomic
 *   against publication (0066 section 5a), so the removal happens against bytes
 *   nothing may attach to any more. A removal that does not land RELEASES the
 *   claim, so the object comes back on the next tick instead of being filed as
 *   gone.
 *
 *   UNREGISTERED — everything written before this boundary existed, which today
 *   is every story photo in the product, plus anything a crashed removal left
 *   stamped-but-present. `claim_orphan_paths` ADOPTS these into the registry and
 *   claims them in one transaction, so they arrive here as ordinary claims. The
 *   earlier shape returned bare paths and was the same check-then-delete race in
 *   the one population that had no row for `publish_story` to lock against.
 *
 * The pass is BOUNDED and IDEMPOTENT: whatever it does not reach this tick is
 * still there for the next one, and running it twice over the same object is a
 * no-op. That is what makes it safe to hang off an ordinary request.
 *
 * WHO CALLS IT. The delete route calls it after its own work, so a user
 * deleting anything also clears their own expired and abandoned media, and
 * `POST /api/media/reclaim` calls it directly — as the caller for their own
 * bytes, or with the service role for everyone's. A scheduled invocation of
 * that route is the last piece and it is deployment configuration, not code;
 * until it exists, reclamation is driven by real users touching real media.
 */

export type SweepResult = {
  /** Paths whose bytes are now actually gone. */
  reclaimed: string[];
  /**
   * Paths that survived the removal. The bytes are still there and the registry
   * still says so, which is the only safe direction to be wrong in.
   */
  orphaned: string[];
};

const EMPTY: SweepResult = { reclaimed: [], orphaned: [] };

function merge(a: SweepResult, b: SweepResult): SweepResult {
  return {
    reclaimed: [...a.reclaimed, ...b.reclaimed],
    orphaned: [...a.orphaned, ...b.orphaned],
  };
}

/**
 * Claim registered objects, then remove their bytes.
 *
 * `mediaId` targets one object — the shape the delete route uses right after a
 * deletion verb reported the last reference gone. `null` sweeps a bounded batch
 * of whatever else the caller owns.
 *
 * Nothing is deleted that the database did not first claim, and every claim the
 * removal failed is handed straight back.
 */
export async function claimAndRemove(
  caller: SupabaseClient | null,
  admin: SupabaseClient,
  mediaId: string | null,
  limit: number = SWEEP_BATCH,
): Promise<SweepResult> {
  return removeClaims(admin, await claimMediaForRemoval(caller, mediaId, limit));
}

/**
 * Remove the bytes of claims the database has already committed to, and hand
 * back every claim whose removal did not land.
 *
 * One function for both populations, because after `claim_orphan_paths` adopts
 * the unregistered ones there is only one population: a claim is a claim, and
 * the difference between them lives entirely in how it was obtained.
 *
 * The release goes through the ADMIN client. 0066 grants `release_media_claim`
 * to no application role — an owner able to un-stamp an object mid-removal
 * could publish a story into the gap and lose its photo to a delete already in
 * flight — so the sweep, which runs as the service role, is the only thing that
 * gives a claim back.
 */
/**
 * Which of these paths are STILL in the bucket.
 *
 * Storage reports a skipped removal and a nonexistent object identically - by leaving
 * the name out of the removed list - so the only way to tell "refused" from "already
 * gone" is to look. Failure to list is treated as "still present", which keeps the
 * claim released and the object in front of the next sweep: the safe direction.
 */
async function presentPaths(
  admin: SupabaseClient,
  paths: readonly string[],
): Promise<string[]> {
  const present: string[] = [];
  for (const path of paths) {
    const slash = path.lastIndexOf('/');
    const folder = slash === -1 ? '' : path.slice(0, slash);
    const name = path.slice(slash + 1);
    try {
      const { data, error } = await admin.storage
        .from(MEDIA_BUCKET)
        .list(folder, { search: name, limit: 1 });
      if (error) { present.push(path); continue; }
      const found = (data ?? []).some(
        (entry) => String((entry as { name?: unknown })?.name ?? '') === name,
      );
      if (found) present.push(path);
    } catch {
      present.push(path);
    }
  }
  return present;
}

async function removeClaims(
  admin: SupabaseClient,
  claims: MediaClaim[],
): Promise<SweepResult> {
  if (claims.length === 0) return EMPTY;

  const failed = new Set(
    await reclaimBytes(
      admin,
      MEDIA_BUCKET,
      claims.map((claim) => claim.storagePath),
    ),
  );

  // AN OBJECT THAT WAS ALREADY GONE IS NOT A FAILED REMOVAL.
  //
  // `reclaimBytes` reports "not removed" by ABSENCE from the returned list, and
  // Storage omits an object it refused AND an object that was never there. Treating
  // both as failures meant a claim whose bytes are genuinely gone got its stamp
  // RELEASED - so the next sweep re-claimed the same row, got the same empty result,
  // released again, forever, and `bytes_removed_at` was never recorded for bytes that
  // no longer exist. Re-checking existence is what separates the two, and it is one
  // request per orphan on a path that is already the slow one.
  const stillPresent = new Set(await presentPaths(admin, [...failed]));

  for (const claim of claims) {
    if (!failed.has(claim.storagePath)) continue;
    if (!stillPresent.has(claim.storagePath)) {
      // Gone. The stamp already says so; leave it standing.
      continue;
    }
    console.error('[media/reclaim] ORPHAN — bytes survived removal:', claim.storagePath);
    if (!(await releaseMediaClaim(admin, claim.mediaId))) {
      // The stamp is still in place and the bytes are still there, so the
      // registry now disagrees with the bucket. `claim_orphan_paths` covers
      // exactly this case on a later tick, which is why it looks at storage
      // rather than trusting the stamp.
      console.error('[media/reclaim] could not release claim:', claim.mediaId);
    }
  }

  return {
    // Removed by us, or already absent - both mean the bytes are gone, which is the
    // only thing the caller reports on.
    reclaimed: claims
      .map((claim) => claim.storagePath)
      .filter((path) => !stillPresent.has(path)),
    orphaned: [...failed].filter((path) => stillPresent.has(path)),
  };
}

/**
 * One full tick: registered claims first, then the unregistered remainder.
 *
 * Registered first on purpose — those are the objects that already carry a row,
 * so they are the cheap half. The storage scan is the fallback for everything
 * the registry never saw, and it adopts what it finds before claiming it.
 */
export async function sweepReclaimable(
  caller: SupabaseClient | null,
  admin: SupabaseClient,
  limit: number = SWEEP_BATCH,
): Promise<SweepResult> {
  const claimed = await claimAndRemove(caller, admin, null, limit);
  const orphans = await removeClaims(admin, await claimOrphanPaths(caller, limit));
  return merge(claimed, orphans);
}
