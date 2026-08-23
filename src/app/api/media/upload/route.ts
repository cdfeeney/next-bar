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

  // Checked before the body is read into memory as well as after decoding, so
  // an oversized upload is refused without buffering all of it.
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
