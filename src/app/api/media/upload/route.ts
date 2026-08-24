import { NextResponse } from 'next/server';

import { reEncodeImage, MAX_UPLOAD_BYTES } from '@/lib/media/reEncode';
import {
  adminClient,
  bearerToken,
  readMediaEnv,
  verifiedUserId,
} from '@/lib/media/serverClients';
import { isDestinationKind, MEDIA_BUCKET } from '@/lib/media/types';

/**
 * POST /api/media/upload — the ONLY way bytes reach the media bucket
 * (V8-R-STO-014).
 *
 * The requirement's trust boundary line is the design: "SERVER. A client-side
 * strip is bypassable by definition and cannot satisfy this requirement." The
 * social candidate uploaded client -> Storage directly, so the EXIF strip lived
 * in the browser and a modified client simply skipped it. Here the bytes are
 * posted to a server, decoded, and written out fresh; the ORIGINAL BYTES ARE
 * NEVER PERSISTED — they exist only in this request's memory.
 *
 * Fails closed: "a failed re-encode rejects the upload; it never falls back to
 * storing the original."
 *
 * Node runtime, not edge: `sharp` is a native decoder.
 */
export const runtime = 'nodejs';

/** A rejected upload says why in a fixed vocabulary; details stay server-side. */
type UploadError =
  | 'unavailable'
  | 'unauthorized'
  | 'bad_request'
  | 'too_large'
  | 'rejected'
  | 'server_error';

function fail(error: UploadError, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const env = readMediaEnv();
  if (env === null) return fail('unavailable', 503);

  const token = bearerToken(request);
  if (token === null) return fail('unauthorized', 401);

  const admin = adminClient(env);
  const userId = await verifiedUserId(admin, token);
  if (userId === null) return fail('unauthorized', 401);

  // BEFORE the body is read, and a DECLARED LENGTH IS REQUIRED.
  //
  // `Content-Length` is a client claim and is not the authority on size — the
  // check after decoding still is — but it is the only thing available before
  // `formData()` buffers the whole body into this process. Letting a request
  // through when the header is absent or unparseable defeated the check
  // completely: a chunked body carries no length, `Number(null)` is NaN, and an
  // arbitrarily large upload was buffered in full before any size test ran.
  // Next.js route handlers impose no cap of their own, so that was a
  // memory-exhaustion path behind a comment claiming the opposite.
  //
  // Refusing an undeclared length costs nothing real: a browser sending
  // multipart FormData always sets Content-Length.
  // The HEADER is tested before the number is. `Number(null)` is 0, not NaN, so
  // coercing first silently turns "no length declared" into "declares zero
  // bytes" — which passes every bound and reads the body anyway. That is the
  // precise shape of the hole this check exists to close, so the absent case is
  // handled on its own rather than folded into the numeric test.
  const lengthHeader = request.headers.get('content-length');
  if (lengthHeader === null || !/^\d+$/.test(lengthHeader.trim())) {
    return fail('bad_request', 411);
  }
  if (Number(lengthHeader) > MAX_UPLOAD_BYTES) {
    return fail('too_large', 413);
  }

  let file: File;
  let destinationKind: string | null;
  let destinationRef: string | null;
  try {
    const form = await request.formData();
    const candidate = form.get('file');
    if (!(candidate instanceof File)) return fail('bad_request', 400);
    file = candidate;
    const kind = form.get('destinationKind');
    const ref = form.get('destinationRef');
    destinationKind = typeof kind === 'string' ? kind : null;
    destinationRef = typeof ref === 'string' ? ref : null;
  } catch {
    return fail('bad_request', 400);
  }

  // The authority on size: the decoded body, not the header above.
  if (file.size > MAX_UPLOAD_BYTES) return fail('too_large', 413);

  // A destination may be named at upload time, but only a WELL-FORMED one. An
  // unrecognised kind is a request error rather than something to drop
  // silently: dropping it would register media with no reference at all, which
  // is an orphan the reference count would happily reclaim.
  if (destinationKind !== null && !isDestinationKind(destinationKind)) {
    return fail('bad_request', 400);
  }
  if (destinationKind !== null && (destinationRef ?? '').trim().length === 0) {
    return fail('bad_request', 400);
  }

  // WHAT A CLIENT MAY NAME, and why it is only this.
  //
  // The insert below runs with SERVICE ROLE, so `media_destinations` gets no RLS
  // opinion on it and `ref_id` has no foreign key. Whatever the request says is
  // simply believed — which made two things possible that the spine's own rules
  // forbid:
  //
  //   * `archive` — a Saved Nights Out RETENTION HOLD, the one kind
  //     `delete_media_everywhere` deliberately never clears. A client could mint
  //     itself an undeletable hold on its own bytes. Archive rows are written by
  //     the archive surface, never by an uploader, so the kind is refused here.
  //
  //   * another user's ref — `destinationKind=story` with a victim's story id
  //     attached the caller's media to that story for every consumer that reads
  //     the spine by (kind, ref_id).
  //
  // `story` is therefore the only kind accepted, and only after the story is
  // confirmed to exist and to be authored by the VERIFIED caller. `feed` and
  // `group` have no table to check ownership against yet; accepting them would
  // be accepting an unverifiable claim, so they wait for the surface that owns
  // them.
  if (destinationKind !== null && destinationKind !== 'story') {
    return fail('bad_request', 400);
  }
  if (destinationKind === 'story') {
    const { data: story, error: storyError } = await admin
      .from('stories')
      .select('id')
      .eq('id', destinationRef)
      .eq('author_id', userId)
      .is('deleted_at', null)
      .maybeSingle();

    if (storyError) {
      console.error('[media/upload] destination check failed:', storyError.message);
      return fail('server_error', 500);
    }
    // Not yours, or not there. Refused rather than attached: a destination the
    // caller does not own is not a reference this spine should hold.
    if (!story) return fail('bad_request', 400);
  }

  let original: Uint8Array;
  try {
    original = new Uint8Array(await file.arrayBuffer());
  } catch {
    return fail('bad_request', 400);
  }

  // THE BOUNDARY. Content type comes from the decoder, EXIF and GPS have no
  // carrier in the output, and a failure here returns before anything is
  // stored.
  const reEncoded = await reEncodeImage(original);
  if (!reEncoded.ok) {
    return fail(reEncoded.reason === 'rejected' ? 'rejected' : 'server_error', 400);
  }

  // The key's first segment is the owner, which is what 0065's prefix-scoped
  // bucket policies authorize against — and it is the VERIFIED user id, never
  // a value from the request.
  const mediaId = crypto.randomUUID();
  const storagePath = `${userId}/${mediaId}`;

  try {
    const { error: uploadError } = await admin.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, reEncoded.value.bytes, {
        contentType: reEncoded.value.contentType,
        upsert: false,
      });

    if (uploadError) {
      console.error('[media/upload] storage write failed:', uploadError.message);
      return fail('server_error', 500);
    }

    // Register the object. `server_verified` is true only because THIS request
    // decoded and re-encoded the bytes it is describing.
    const { data: inserted, error: insertError } = await admin
      .from('media_objects')
      .insert({
        id: mediaId,
        owner_id: userId,
        bucket_id: MEDIA_BUCKET,
        storage_path: storagePath,
        content_type: reEncoded.value.contentType,
        byte_size: reEncoded.value.bytes.byteLength,
        server_verified: true,
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      // The registry row is what makes these bytes findable and reference
      // counted. Without it the object is already an orphan, so it is removed
      // now rather than left in the bucket with nothing pointing at it.
      const { error: cleanupError } = await admin.storage
        .from(MEDIA_BUCKET)
        .remove([storagePath]);
      if (cleanupError) {
        // Reported, not swallowed: the same contract as reportOrphans in
        // stories.server.ts. An orphan nobody logged is an orphan nobody
        // reclaims.
        console.error(
          '[media/upload] ORPHAN — registry insert failed and cleanup failed:',
          storagePath,
          cleanupError.message,
        );
      }
      console.error('[media/upload] registry insert failed:', insertError?.message);
      return fail('server_error', 500);
    }

    if (destinationKind !== null && destinationRef !== null) {
      const { error: destError } = await admin.from('media_destinations').insert({
        media_id: mediaId,
        kind: destinationKind,
        ref_id: destinationRef,
      });
      if (destError) {
        console.error('[media/upload] destination insert failed:', destError.message);
        // The media exists and is registered; the caller can attach a
        // destination separately. Reported as a failure rather than a success
        // with a missing reference.
        return fail('server_error', 500);
      }
    }

    return NextResponse.json({
      ok: true,
      mediaId,
      storagePath,
      contentType: reEncoded.value.contentType,
      width: reEncoded.value.width,
      height: reEncoded.value.height,
    });
  } catch (error) {
    console.error(
      '[media/upload] unexpected failure:',
      error instanceof Error ? error.message : 'unknown',
    );
    return fail('server_error', 500);
  }
}
