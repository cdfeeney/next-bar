import { NextResponse } from 'next/server';

import {
  deleteEverywhere,
  pathHasLiveReference,
  reclaimBytes,
  removeDestination,
} from '@/lib/media/destinations';
import {
  adminClient,
  bearerToken,
  callerClient,
  readMediaEnv,
  verifiedUserId,
} from '@/lib/media/serverClients';
import { MEDIA_BUCKET } from '@/lib/media/types';

/**
 * DELETE /api/media/:mediaId — the two deletion verbs (V8-R-CMP-015,
 * V8-R-CMP-016).
 *
 *   ?destination=<id>   "Remove from this destination" — that one only.
 *   ?scope=everywhere   "Delete everywhere" — every destination.
 *
 * They are separate parameters on purpose. A single `?all=true` flag would make
 * the destructive verb one typo away from the safe one, and D-C-33's whole
 * point is that the two are distinct and name their scope.
 *
 * BYTES ARE NEVER RECLAIMED BY THIS HANDLER'S OWN JUDGEMENT. The decision comes
 * back from 0066's definer functions, which count references under a row lock
 * in the same transaction as the removal.
 *
 * THE SECOND GUARD IS AN EXPLICIT RE-CHECK, not the storage policy. The RPC's
 * row lock is gone by the time the bytes go, so a reference created in that
 * window would otherwise be destroyed by a decision taken before it existed.
 * The obvious defence — remove as the CALLER so 0066's storage DELETE policy
 * re-checks — does not work here and fails in the worst possible direction:
 * 0066 revokes every `story-media` SELECT policy, Storage must see an object to
 * delete it, and a remove that matches nothing returns an EMPTY LIST WITH NO
 * ERROR. The route would then stamp `bytes_removed_at` on bytes that are still
 * in the bucket. So the removal runs with service role, and the reference count
 * is re-asked on the caller's client immediately before it.
 */
export const runtime = 'nodejs';

export async function DELETE(
  request: Request,
  { params }: { params: { mediaId: string } },
): Promise<NextResponse> {
  const env = readMediaEnv();
  if (env === null) {
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }

  const token = bearerToken(request);
  if (token === null) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const admin = adminClient(env);
  const userId = await verifiedUserId(admin, token);
  if (userId === null) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const destinationId = url.searchParams.get('destination');
  const everywhere = url.searchParams.get('scope') === 'everywhere';

  if (destinationId === null && !everywhere) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }
  if (destinationId !== null && everywhere) {
    // Ambiguous scope on a destructive call. Refused rather than guessed.
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  // Author-only enforcement lives inside the RPCs, which read auth.uid() — so
  // they are called with the CALLER'S client, never the admin one.
  const caller = callerClient(env, token);

  try {
    if (destinationId !== null) {
      const removed = await removeDestination(caller, destinationId);
      if (!removed.ok) {
        return NextResponse.json(
          { ok: false, error: removed.reason },
          { status: removed.reason === 'denied' ? 403 : 500 },
        );
      }

      const orphans = removed.value.reclaimable
        ? await reclaimIfUnreferenced(caller, admin, removed.value.storagePath)
        : [];

      if (removed.value.reclaimable) {
        // THE RPC'S media id, never the one in the URL. The RPC authorized and
        // removed a DESTINATION; which media that destination belonged to is
        // its answer to give, and `:mediaId` here is an unvalidated path
        // segment that the destination need not match. Stamping the path's id
        // would write `bytes_removed_at` on somebody else's live row with
        // service-role authority — a 404 for media whose bytes are still there
        // — while the row actually reclaimed stayed unstamped.
        await markBytesRemoved(admin, removed.value.mediaId, orphans);
      }

      return NextResponse.json({
        ok: true,
        scope: 'destination',
        // The remaining destinations are untouched, and saying so is the
        // difference between this verb and the other one.
        bytesReclaimed: removed.value.reclaimable && orphans.length === 0,
        orphanedPaths: orphans,
      });
    }

    const deleted = await deleteEverywhere(caller, params.mediaId);
    if (!deleted.ok) {
      return NextResponse.json(
        { ok: false, error: deleted.reason },
        { status: deleted.reason === 'denied' ? 403 : 500 },
      );
    }

    const orphans = deleted.value.reclaimable
      ? await reclaimIfUnreferenced(caller, admin, deleted.value.storagePath)
      : [];

    if (deleted.value.reclaimable) {
      await markBytesRemoved(admin, params.mediaId, orphans);
    }

    return NextResponse.json({
      ok: true,
      scope: 'everywhere',
      bytesReclaimed: deleted.value.reclaimable && orphans.length === 0,
      // Non-zero means a Saved Nights Out archive still holds the bytes. Stated,
      // because "a partial delete must be reported, never reported as complete".
      remainingReferences: deleted.value.remainingReferences,
      orphanedPaths: orphans,
    });
  } catch (error) {
    console.error(
      '[media/delete] unexpected failure:',
      error instanceof Error ? error.message : 'unknown',
    );
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}

/**
 * Re-ask the reference count, then remove — or keep the bytes and say so.
 *
 * The RPC answered "reclaimable" while holding a row lock it has since
 * released. This asks again, on the caller's client, at the last moment before
 * anything is destroyed. A reference that reappeared is reported through the
 * same orphan channel the caller already renders: the bytes survived, which is
 * exactly what an orphan means here.
 */
async function reclaimIfUnreferenced(
  caller: ReturnType<typeof callerClient>,
  admin: ReturnType<typeof adminClient>,
  storagePath: string,
): Promise<string[]> {
  if (await pathHasLiveReference(caller, MEDIA_BUCKET, storagePath)) {
    console.error(
      '[media/delete] reference reappeared before removal, bytes kept:',
      storagePath,
    );
    return [storagePath];
  }
  return reclaimBytes(admin, MEDIA_BUCKET, [storagePath]);
}

/**
 * Record that the bytes are gone — but only if they actually are.
 *
 * An orphan means the object survived the remove, so stamping
 * `bytes_removed_at` would file it as reclaimed and hide it from any future
 * sweep. The orphan is logged instead, the same contract as `reportOrphans` in
 * stories.server.ts.
 */
async function markBytesRemoved(
  admin: ReturnType<typeof adminClient>,
  mediaId: string,
  orphans: readonly string[],
): Promise<void> {
  if (orphans.length > 0) {
    console.error('[media/delete] ORPHAN — bytes survived removal:', orphans.join(', '));
    return;
  }
  const { error } = await admin
    .from('media_objects')
    .update({ bytes_removed_at: new Date().toISOString() })
    .eq('id', mediaId);
  if (error) {
    console.error('[media/delete] could not stamp bytes_removed_at:', error.message);
  }
}
