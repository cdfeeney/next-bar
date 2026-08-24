import type { SupabaseClient } from '@supabase/supabase-js';

import {
  claimMediaForRemoval,
  listOrphanPaths,
  reclaimBytes,
  releaseMediaClaim,
  SWEEP_BATCH,
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
 *   stamped-but-present. There is no row to claim; the removal is the whole of
 *   it, and 0066 only offers paths no live story accounts for and that are past
 *   the grace window.
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
  const claims = await claimMediaForRemoval(caller, mediaId, limit);
  if (claims.length === 0) return EMPTY;

  const failed = new Set(
    await reclaimBytes(
      admin,
      MEDIA_BUCKET,
      claims.map((claim) => claim.storagePath),
    ),
  );

  for (const claim of claims) {
    if (!failed.has(claim.storagePath)) continue;
    console.error('[media/reclaim] ORPHAN — bytes survived removal:', claim.storagePath);
    if (!(await releaseMediaClaim(caller, claim.mediaId))) {
      // The stamp is still in place and the bytes are still there, so the
      // registry now disagrees with the bucket. `unreferenced_orphan_paths`
      // covers exactly this case on a later tick, which is why it looks at
      // storage rather than trusting the stamp.
      console.error('[media/reclaim] could not release claim:', claim.mediaId);
    }
  }

  return {
    reclaimed: claims
      .map((claim) => claim.storagePath)
      .filter((path) => !failed.has(path)),
    orphaned: [...failed],
  };
}

/** Remove bytes the registry cannot account for at all. */
async function removeOrphanPaths(
  caller: SupabaseClient | null,
  admin: SupabaseClient,
  limit: number,
): Promise<SweepResult> {
  const paths = await listOrphanPaths(caller, limit);
  if (paths.length === 0) return EMPTY;

  const failed = await reclaimBytes(admin, MEDIA_BUCKET, paths);
  if (failed.length > 0) {
    console.error('[media/reclaim] orphan paths survived removal:', failed.join(', '));
  }
  return {
    reclaimed: paths.filter((path) => !failed.includes(path)),
    orphaned: failed,
  };
}

/**
 * One full tick: registered claims first, then the unregistered remainder.
 *
 * Registered first on purpose — those are the objects with a lock and a
 * tombstone, so they are the cheap, exactly-decided half. The path scan is the
 * fallback for everything the registry never saw.
 */
export async function sweepReclaimable(
  caller: SupabaseClient | null,
  admin: SupabaseClient,
  limit: number = SWEEP_BATCH,
): Promise<SweepResult> {
  const claimed = await claimAndRemove(caller, admin, null, limit);
  const orphans = await removeOrphanPaths(caller, admin, limit);
  return merge(claimed, orphans);
}
