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

/**
 * Does anything still reference these bytes RIGHT NOW?
 *
 * The deletion RPCs count references under a row lock and release it when they
 * commit, so between that answer and the removal a new reference can appear —
 * a second device publishing a story that names the same object, for instance.
 * This is the re-check that catches it, asked on the CALLER'S client because
 * 0066 grants the function to `authenticated` and the media is theirs.
 *
 * FAILS CLOSED: anything other than an explicit `false` means the bytes stay.
 * Deleting because a lookup broke is the one outcome that cannot be undone.
 *
 * It narrows the window rather than closing it — Storage removal is not in the
 * RPC's transaction and no lock spans both — and that residual is stated rather
 * than implied.
 */
export async function pathHasLiveReference(
  client: SupabaseClient | null,
  bucket: string,
  storagePath: string,
): Promise<boolean> {
  if (client === null) return true;
  try {
    const { data, error } = await client.rpc('media_path_has_live_reference', {
      p_bucket: bucket,
      p_name: storagePath,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
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
 * re-check the reference count — but 0066 also revokes every `story-media`
 * SELECT policy, and Storage has to see an object to delete it. As the caller
 * the remove matches nothing, and the API reports that by returning an EMPTY
 * REMOVED LIST rather than an error, so the route would stamp `bytes_removed_at`
 * on an object still sitting in the bucket. The re-check that actually catches
 * the race is the caller-scoped one the route makes BEFORE calling this.
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
 * Returns the paths that could NOT be removed, so an orphan is reported rather
 * than swallowed — the same contract as `reportOrphans` in stories.server.ts.
 */
export async function reclaimBytes(
  admin: SupabaseClient,
  bucket: string,
  paths: readonly string[],
): Promise<string[]> {
  if (paths.length === 0) return [];
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
      return wanted.filter((path) => !removed.has(path));
    } catch {
      // fall through to the retry, then to the orphan report
    }
  }
  return wanted;
}
