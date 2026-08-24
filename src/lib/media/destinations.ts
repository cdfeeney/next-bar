import type { SupabaseClient } from '@supabase/supabase-js';

import { mediaFailure, mediaUnavailable, type MediaResult } from './types';

/**
 * The two deletion verbs (V8-R-CMP-012, V8-R-CMP-015, V8-R-CMP-016).
 *
 * D-C-33 settles the model: one media object may carry several destination
 * references, "remove from this destination" takes only the named one, "delete
 * everywhere" takes them all, and PHYSICAL BYTES GO ONLY WHEN NO DESTINATION
 * AND NO SAVED NIGHTS OUT ARCHIVE REFERENCES THEM.
 *
 * The reference count is NOT computed here. It is computed inside 0066's
 * definer functions, in the same transaction as the removal and behind a row
 * lock, because a count read separately from the removal is a count that can be
 * stale by the time it is acted on. This module carries out what those
 * functions decided; it never second-guesses them, and it never reclaims bytes
 * on its own initiative.
 *
 * The byte removal itself is additionally guarded, in depth, by 0066's storage
 * DELETE policy: an object with any live reference cannot be deleted even if a
 * caller here asked for it. That guard is the one that also protects callers
 * outside this module.
 */

/**
 * How much one sweep tick takes on.
 *
 * Bounded because a sweep runs inside a request: an unbounded batch turns a
 * routine delete into a multi-minute storage call. Whatever is left is still
 * there for the next tick, which is the property that makes a small batch safe.
 */
export const SWEEP_BATCH = 25;

export type DestinationRemoval = {
  mediaId: string;
  storagePath: string;
  /** True when THIS removal took the last live reference. */
  reclaimable: boolean;
};

type RemoveRow = {
  media_id: string;
  bucket_id: string;
  storage_path: string;
  reclaimable: boolean;
};

type DeleteEverywhereRow = {
  bucket_id: string;
  storage_path: string;
  reclaimable: boolean;
  remaining_references: number;
};

function firstRow<T>(data: unknown): T | null {
  const rows = (Array.isArray(data) ? data : [data]).filter(Boolean) as T[];
  return rows.length > 0 ? rows[0] : null;
}

/**
 * "Remove from this destination" — V8-R-CMP-015.
 *
 * Zero rows back from the RPC means nothing was removed (not the author, or
 * already removed). That is reported as a failure: "a failed removal must not
 * report success and must not orphan the bytes."
 */
export async function removeDestination(
  client: SupabaseClient | null,
  destinationId: string,
): Promise<MediaResult<DestinationRemoval>> {
  if (client === null) return mediaUnavailable();

  try {
    const { data, error } = await client.rpc('remove_media_destination', {
      p_destination_id: destinationId,
    });

    if (error) {
      return mediaFailure('failed', 'That destination could not be removed.');
    }

    const row = firstRow<RemoveRow>(data);
    if (row === null) {
      return mediaFailure('denied', 'That post is not yours to change.');
    }

    return {
      ok: true,
      value: {
        mediaId: row.media_id,
        storagePath: row.storage_path,
        reclaimable: row.reclaimable === true,
      },
    };
  } catch {
    return mediaUnavailable();
  }
}

/** One object the database has committed to removing. */
export type MediaClaim = {
  mediaId: string;
  storagePath: string;
};

type ClaimRow = {
  media_id: string;
  bucket_id: string;
  storage_path: string;
};

function claimRows(data: unknown): MediaClaim[] {
  return (Array.isArray(data) ? (data as ClaimRow[]) : [])
    .filter((row) => typeof row?.media_id === 'string' && typeof row?.storage_path === 'string')
    .map((row) => ({ mediaId: row.media_id, storagePath: row.storage_path }));
}

/**
 * CLAIM the bytes, don't ask whether they look free.
 *
 * The old shape here was `pathHasLiveReference` — a question asked immediately
 * before a service-role delete. It read as a careful last-moment re-check and it
 * was a race: the answer was already in the past by the time the delete went
 * out, and a `publish_story` committing in that gap lost its photo silently.
 *
 * `claim_media_for_removal` recounts under the same `media_objects` row lock
 * that 0066's `publish_story` takes, and stamps `bytes_removed_at` in that same
 * transaction. An empty result means the database declined — a reference
 * survived, someone else already claimed it, or the object is not the caller's.
 * There is no "probably safe" answer any more, only a claim or nothing.
 *
 * FAILS CLOSED: an error or a throw yields no claims, so nothing is deleted.
 */
export async function claimMediaForRemoval(
  client: SupabaseClient | null,
  mediaId: string | null,
  limit?: number,
): Promise<MediaClaim[]> {
  if (client === null) return [];
  try {
    const { data, error } = await client.rpc('claim_media_for_removal', {
      p_media_id: mediaId,
      p_limit: limit ?? SWEEP_BATCH,
    });
    if (error) return [];
    return claimRows(data);
  } catch {
    return [];
  }
}

/**
 * Hand a claim back when the removal did not happen.
 *
 * Without this an orphan stays stamped, which tells every future sweep the bytes
 * are gone while they sit in the bucket. Releasing is the only thing that puts
 * the object back in front of the sweep, so a failure here is logged loudly
 * rather than swallowed.
 *
 * PASS THE ADMIN CLIENT. 0066 grants `release_media_claim` to no application
 * role: while a removal is in flight the stamp is the only thing keeping
 * `publish_story` off those bytes, so an owner who could un-stamp it would
 * publish a story into the gap and lose its photo to the delete already on its
 * way. Only the sweep gives a claim back, and the sweep is the service role.
 */
export async function releaseMediaClaim(
  client: SupabaseClient | null,
  mediaId: string,
): Promise<boolean> {
  if (client === null) return false;
  try {
    const { error } = await client.rpc('release_media_claim', { p_media_id: mediaId });
    return !error;
  } catch {
    return false;
  }
}

/**
 * CLAIM the storage objects the registry cannot account for.
 *
 * Everything uploaded before this boundary existed has no `media_objects` row —
 * that is every story photo in the product today — and so does an object a
 * crashed removal left stamped-but-present.
 *
 * This used to return PATHS, and that was the same check-then-delete race the
 * claim above exists to close, reopened for exactly the population that has no
 * row to lock: the sweep listed a path, `publish_story` had nothing to take
 * `for update` on, and the service-role removal that followed bypassed the
 * storage DELETE policy's live-reference re-check. `claim_orphan_paths` adopts
 * the object into the registry and stamps it in one transaction, so what comes
 * back is a CLAIM with the same guarantees as any other, and both halves of the
 * sweep are now one mechanism.
 *
 * FAILS CLOSED: an error or a throw yields no claims, so nothing is deleted.
 */
export async function claimOrphanPaths(
  client: SupabaseClient | null,
  limit?: number,
): Promise<MediaClaim[]> {
  if (client === null) return [];
  try {
    const { data, error } = await client.rpc('claim_orphan_paths', {
      p_limit: limit ?? SWEEP_BATCH,
    });
    if (error) return [];
    return claimRows(data);
  } catch {
    return [];
  }
}

export type EverywhereDeletion = {
  storagePath: string;
  reclaimable: boolean;
  /**
   * References still standing after the delete. Non-zero means an archive hold
   * survives and the bytes stay — reported so the caller can say so rather than
   * calling a partial delete complete.
   */
  remainingReferences: number;
};

/**
 * "Delete everywhere" — V8-R-CMP-016.
 *
 * Clears every destination. The bytes are reclaimable only if no Saved Nights
 * Out archive still references them, which 0066 decides by leaving
 * `kind = 'archive'` rows standing and counting them.
 */
export async function deleteEverywhere(
  client: SupabaseClient | null,
  mediaId: string,
): Promise<MediaResult<EverywhereDeletion>> {
  if (client === null) return mediaUnavailable();

  try {
    const { data, error } = await client.rpc('delete_media_everywhere', {
      p_media_id: mediaId,
    });

    if (error) {
      return mediaFailure('failed', 'That post could not be deleted.');
    }

    const row = firstRow<DeleteEverywhereRow>(data);
    if (row === null) {
      return mediaFailure('denied', 'That post is not yours to delete.');
    }

    return {
      ok: true,
      value: {
        storagePath: row.storage_path,
        reclaimable: row.reclaimable === true,
        remainingReferences: Number(row.remaining_references ?? 0),
      },
    };
  } catch {
    return mediaUnavailable();
  }
}

/** What one removal attempt actually established. See `reclaimBytes`. */
export type ReclaimAttempt = {
  /** The remove call completed, so an omitted path is Storage's decision. */
  conclusive: boolean;
  /** Paths Storage did not report as removed. */
  notRemoved: string[];
};

/**
 * Remove the physical bytes, but ONLY when the caller was told they are
 * reclaimable.
 *
 * The guard is restated here rather than assumed: this function is the one that
 * destroys data, and "reference count says zero" is the entire licence for it.
 *
 * SERVICE ROLE, and the reason is worth writing down because the obvious
 * alternative is wrong in a way that reads as safer. Running the removal as the
 * CALLER looks like defence in depth — 0066's storage DELETE policy would
 * re-check the reference count — but that policy REFUSES by omitting the object
 * from the returned list with `error` null, which is indistinguishable from a
 * successful delete unless the list itself is inspected. A caller-scoped removal
 * would therefore let the route stamp `bytes_removed_at` on an object still
 * sitting in the bucket. The re-check that actually catches the race is the
 * caller-scoped one the route makes BEFORE calling this.
 *
 * AND IT GETS STRICTLY MORE NECESSARY AFTER WP2's 0071. An earlier version of
 * this comment justified service role by claiming "0066 also revokes every
 * `story-media` SELECT policy". That is FALSE today: under EC-01 this lane's
 * migration is additive and those SELECT policies still stand until 0071
 * withdraws them, after WP2's consumer transition. Once 0071 lands, a caller
 * genuinely cannot SEE the object and the removal would match nothing at all —
 * so service role is required both before and after, for two different reasons.
 * The reasoning is recorded in both halves rather than resting on a claim that
 * was not yet true.
 *
 * WHAT CAME BACK IS CHECKED, not just whether an error came back. `remove`
 * resolves with the list of objects it actually deleted; anything it skipped is
 * reported by ABSENCE from that list, with `error` null. Inspecting only `error`
 * therefore reads a silent skip as a complete success — the exact shape that
 * would let the registry record bytes as gone while they remain.
 *
 * A path that comes back unmatched is reported as an orphan rather than retried:
 * a skip is a decision, not a hiccup, and the same call will make it again. If
 * the API ever reported names in some other form, the effect is an
 * over-reported orphan — no stamp, bytes kept, a line in the log. That is the
 * safe direction to be wrong in.
 *
 * Returns whether the attempt was CONCLUSIVE, and which paths were not removed.
 * Conclusive means the remove call completed and Storage decided; inconclusive means
 * both attempts failed client-side and NOTHING may be inferred about the server. A
 * caller may clear a claim only on a conclusive result — see removeClaims.
 */
export async function reclaimBytes(
  admin: SupabaseClient,
  bucket: string,
  paths: readonly string[],
): Promise<ReclaimAttempt> {
  if (paths.length === 0) return { conclusive: true, notRemoved: [] };
  const wanted = [...paths];

  // ONE bounded retry, and only for a thrown/errored call. A single retry
  // covers the common transient failure; retrying further just races the same
  // failing remove.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await admin.storage.from(bucket).remove(wanted);
      if (error) continue;

      const removed = new Set(
        (Array.isArray(data) ? data : [])
          .map((object) => String((object as { name?: unknown })?.name ?? ''))
          .filter(Boolean),
      );
      // The call COMPLETED, so an omission is a decision Storage made rather than an
      // unknown. That distinction is the whole point: it is what lets the caller
      // decide whether a claim may be released.
      return { conclusive: true, notRemoved: wanted.filter((path) => !removed.has(path)) };
    } catch {
      // fall through to the retry, then to the INCONCLUSIVE report
    }
  }
  // BOTH ATTEMPTS FAILED CLIENT-SIDE, which says nothing about what the server did.
  // A timed-out DELETE can still be applied moments later, so treating this as "not
  // removed" and releasing the claim would clear the stamp on bytes that are about to
  // disappear — and publish_story would then publish straight onto them.
  return { conclusive: false, notRemoved: [...wanted] };
}
