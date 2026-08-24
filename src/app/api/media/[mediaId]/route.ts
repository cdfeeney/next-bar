import { NextResponse } from 'next/server';

import { deleteEverywhere, removeDestination } from '@/lib/media/destinations';
import { claimAndRemove, sweepReclaimable } from '@/lib/media/reclaim';
import {
  adminClient,
  bearerToken,
  callerClient,
  readMediaEnv,
  verifiedUserId,
} from '@/lib/media/serverClients';

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
 * BYTES ARE NEVER RECLAIMED BY THIS HANDLER'S OWN JUDGEMENT, and no longer by a
 * question asked just before deleting either. The handler asks the database to
 * CLAIM them: 0066 recounts under the same `media_objects` row lock
 * `publish_story` takes and stamps the tombstone in that transaction, so a story
 * published a microsecond later cannot land on bytes already committed to
 * removal. An empty claim means the database declined and nothing is deleted.
 *
 * The previous shape asked `media_path_has_live_reference` and then deleted with
 * service role. Two steps, no lock across them — it narrowed the race and could
 * not close it, and losing that race destroys a live story's photo silently.
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

      // THE RPC'S media id, never the one in the URL. The RPC authorized and
      // removed a DESTINATION; which media that destination belonged to is its
      // answer to give, and `:mediaId` here is an unvalidated path segment that
      // the destination need not match. Claiming the path's id would commit
      // somebody else's live row to removal with service-role authority, while
      // the object actually freed stayed behind.
      const swept = removed.value.reclaimable
        ? await claimAndRemove(caller, admin, removed.value.mediaId)
        : { reclaimed: [], orphaned: [] };

      return NextResponse.json({
        ok: true,
        scope: 'destination',
        // The remaining destinations are untouched, and saying so is the
        // difference between this verb and the other one.
        bytesReclaimed: swept.reclaimed.length > 0,
        orphanedPaths: swept.orphaned,
        ...(await sweepRest(caller, admin)),
      });
    }

    const deleted = await deleteEverywhere(caller, params.mediaId);
    if (!deleted.ok) {
      return NextResponse.json(
        { ok: false, error: deleted.reason },
        { status: deleted.reason === 'denied' ? 403 : 500 },
      );
    }

    const swept = deleted.value.reclaimable
      ? await claimAndRemove(caller, admin, params.mediaId)
      : { reclaimed: [], orphaned: [] };

    return NextResponse.json({
      ok: true,
      scope: 'everywhere',
      bytesReclaimed: swept.reclaimed.length > 0,
      // Non-zero means a Saved Nights Out archive still holds the bytes. Stated,
      // because "a partial delete must be reported, never reported as complete".
      remainingReferences: deleted.value.remainingReferences,
      orphanedPaths: swept.orphaned,
      ...(await sweepRest(caller, admin)),
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
 * The rest of this caller's reclaimable media, swept on the way out.
 *
 * Expired stories and abandoned uploads have no deletion event of their own —
 * nothing ever calls a verb on them — so without a tick like this they are
 * eligible for reclamation forever and reclaimed never. Hanging it off a
 * deletion is deliberate: someone deleting media is someone whose media is worth
 * looking at, and the batch is bounded so the request stays a request.
 *
 * It never affects the outcome of the deletion the caller asked for. A failure
 * in here is reported in the payload and nowhere else.
 */
async function sweepRest(
  caller: ReturnType<typeof callerClient>,
  admin: ReturnType<typeof adminClient>,
): Promise<{ alsoReclaimed: number }> {
  try {
    const swept = await sweepReclaimable(caller, admin);
    return { alsoReclaimed: swept.reclaimed.length };
  } catch (error) {
    console.error(
      '[media/delete] sweep failed:',
      error instanceof Error ? error.message : 'unknown',
    );
    return { alsoReclaimed: 0 };
  }
}
