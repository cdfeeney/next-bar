import { NextResponse } from 'next/server';

import { reEncodeImage, MAX_UPLOAD_BYTES } from '@/lib/media/reEncode';
import { sweepReclaimable } from '@/lib/media/reclaim';
import {
  adminClient,
  bearerToken,
  callerClient,
  readMediaEnv,
  verifiedUserId,
} from '@/lib/media/serverClients';
import { MEDIA_BUCKET } from '@/lib/media/types';

/**
 * How many objects one upload may reclaim. Small on purpose: this runs inside a
 * user-facing upload, so it buys eventual cleanup without making a photo wait on
 * someone else's garbage. Several uploads drain a backlog across several ticks.
 */
const EVENT_SWEEP_LIMIT = 5;

/**
 * Reclamation has eligibility, a claim, and a route — and, until now, no caller
 * for the ABANDONED-UPLOAD population. DELETE already sweeps, so an account that
 * deletes something eventually cleans up after itself; an account that only ever
 * uploads and abandons never triggered a tick, and its bytes sat forever.
 *
 * Event-driven rather than scheduled, deliberately: this repository has no cron,
 * no vercel.json and no pg_cron, and inventing platform infrastructure to satisfy
 * a review finding would be a larger and less reversible decision than the finding
 * warrants. The approved contract states no wall-clock cleanup SLA, so "bounded
 * and eventual" is the honest guarantee and this is what delivers it.
 *
 * BEST EFFORT, ALWAYS. A sweep failure must never fail an upload that already
 * succeeded: the bytes are stored and registered, and the caller is entitled to
 * that answer regardless of what the sweep did.
 */
async function sweepAfterUpload(
  caller: ReturnType<typeof callerClient>,
  admin: ReturnType<typeof adminClient>,
): Promise<number> {
  try {
    const swept = await sweepReclaimable(caller, admin, EVENT_SWEEP_LIMIT);
    // This sweep rides along on someone's upload, so a failed one must NOT fail
    // their request — but it must not vanish either. The scheduled route answers
    // 500 for the same condition; here the only honest channel is the log.
    if (swept.unchecked.length > 0) {
      console.error(
        `[media/upload] post-upload sweep incomplete: ${swept.unchecked.join(', ')}`,
      );
    }
    return swept.reclaimed.length;
  } catch (error) {
    console.error(
      '[media/upload] post-upload sweep failed:',
      error instanceof Error ? error.message : 'unknown',
    );
    return 0;
  }
}
import { readUploadForm } from '@/lib/media/uploadBody';

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

/**
 * The only two things this route needs from the uploaded part.
 *
 * Deliberately NOT `instanceof File`. Class identity does not survive a realm
 * boundary, and this handler now parses the body itself, so the `File` the
 * multipart parser constructs and the `File` this module's global refers to can
 * be two different classes that behave identically — `instanceof` then rejects
 * a perfectly good upload, and it does so as a 400 that looks like a malformed
 * request. Checking for the shape actually used is both realm-proof and honest
 * about the dependency.
 */
type UploadedFile = { size: number; arrayBuffer: () => Promise<ArrayBuffer> };

function isUploadedFile(value: unknown): value is UploadedFile {
  return typeof value === 'object'
    && value !== null
    && typeof (value as UploadedFile).size === 'number'
    && typeof (value as UploadedFile).arrayBuffer === 'function';
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

  let file: UploadedFile;
  let destinationKind: string | null;
  let destinationRef: string | null;
  try {
    // THE BODY IS BOUNDED AS IT ARRIVES, not merely believed. The declared
    // length above is a claim and is only a cheap early refusal for callers
    // honest about it; `readUploadForm` applies the cap to the bytes themselves.
    const form = await readUploadForm(request, MAX_UPLOAD_BYTES);
    if (form === 'too_large') return fail('too_large', 413);
    if (form === 'bad_request') return fail('bad_request', 400);

    const candidate = form.get('file');
    if (!isUploadedFile(candidate)) return fail('bad_request', 400);
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

  // NO DESTINATION IS ATTACHABLE AT UPLOAD TIME, and 'story' least of all.
  //
  // The storage path is minted below as `${userId}/${mediaId}`. A story that
  // already exists — and it must, to pass any ownership check — cannot name a path
  // that did not exist when it was written. So a story destination created here is
  // a live spine reference to an object the story does not reference, BY
  // CONSTRUCTION, and it holds the bytes off reclamation until that story expires.
  // Both review lanes reported this independently on candidate ccf33438.
  //
  // The kind was previously validated and ownership-checked, which made the row
  // look earned. It never was: the check proved the caller owns the story, never
  // that the story references the object — and it cannot, because the object does
  // not exist yet. Validating a value that has no correct setting is worse than
  // refusing it, because it reads as a boundary.
  //
  // Attaching a destination is publish_story's job, once the object exists. Nothing
  // in production ever passed this parameter. Reference counting is unaffected:
  // 0066 counts a live story that references an object with NO spine row, exactly
  // because publish_story does not write the spine.
  if (destinationKind !== null || destinationRef !== null) {
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
    // A too-large OUTPUT is a bounded refusal, not a server fault: 413, the same
    // answer an over-sized input gets, so a client sees one consistent rule.
    if (reEncoded.reason === 'too_large') return fail('too_large', 413);
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

    return NextResponse.json({
      ok: true,
      mediaId,
      storagePath,
      contentType: reEncoded.value.contentType,
      width: reEncoded.value.width,
      height: reEncoded.value.height,
      // Reported for observability, exactly as the DELETE route reports its own
      // sweep. A zero here is ordinary, not an error.
      alsoReclaimed: await sweepAfterUpload(callerClient(env, token), admin),
    });
  } catch (error) {
    console.error(
      '[media/upload] unexpected failure:',
      error instanceof Error ? error.message : 'unknown',
    );
    return fail('server_error', 500);
  }
}
