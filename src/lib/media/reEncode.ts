import sharp from 'sharp';

import {
  isAcceptedImageType,
  sniffImageType,
  type AcceptedImageType,
} from './contentType';
import { mediaFailure, type MediaResult } from './types';

/**
 * SERVER-SIDE RE-ENCODE (V8-R-STO-014).
 *
 * `src/lib/stories.server.ts` records this as an obligation its layer does not
 * discharge: "Nothing here decodes and re-encodes the uploaded object, so
 * EXIF/GPS stripping depends on the capture pipeline having done it in the
 * browser... a MODIFIED client can still upload original bytes with their
 * metadata intact. Closing it needs an upload path that runs on a server."
 * This module is that path's core, and `src/app/api/media/upload` is the route
 * that makes it the ONLY way bytes reach the bucket.
 *
 * The strip is a consequence of the re-encode, not a step that could be
 * skipped: the pixels are decoded and a new file is written from them, so EXIF,
 * GPS, XMP and ICC simply have no carrier in the output. That is why the
 * requirement says re-encode rather than "remove the EXIF block" — a metadata
 * remover has to enumerate what it removes, and it is wrong about the one
 * container nobody thought of.
 *
 * FAILS CLOSED. "a failed re-encode rejects the upload; it never falls back to
 * storing the original."
 */

/**
 * Cap on accepted upload size. Rejected before any decode is attempted.
 *
 * NOT A FREE CHOICE — the platform bounds the request body before this route
 * ever runs. Measured against production on 2026-09-03: a 3.70 MB body returned
 * 200 and a 4.73 MB body returned 413 `FUNCTION_PAYLOAD_TOO_LARGE` from the
 * edge, so the real ceiling is ~4.5 MB. This constant was 12 MiB, which was
 * unreachable fiction: every value between ~4.5 MB and 12 MiB was refused by
 * the platform rather than by the check below, and the number here said
 * otherwise to anyone reading it.
 *
 * 4 MiB sits under the edge bound with room for multipart framing, so an
 * oversized upload is refused by OUR route — with our error shape — for as much
 * of the range as we can actually reach.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * The ceiling on what comes OUT, which is a different number from what may come
 * in and has to be, because re-encoding is not guaranteed to shrink anything.
 *
 * 0065 creates the `story-media` bucket with `file_size_limit` 8388608. A 12 MiB
 * input is legal here, and a high-entropy PNG can re-encode to more than 8 MiB —
 * at which point the boundary reported success and Storage then refused the write,
 * so the caller got a 500. A server error is the wrong answer to a legal request
 * the product simply cannot store: it reads as "we broke", invites a retry that
 * will fail identically, and hides a bound the client could have respected.
 *
 * Kept in step with 0065 by the assertion in migration0066.test.ts: if the bucket
 * limit moves and this does not, that test fails.
 */
export const MAX_STORED_BYTES = 8 * 1024 * 1024;

/**
 * Cap on decoded dimensions. A small file can decode to an enormous bitmap (a
 * "decompression bomb"), and the memory that costs is spent before any of our
 * own code runs — so the limit goes to the decoder, not after it.
 */
export const MAX_IMAGE_DIMENSION = 8192;

/** Quality for the re-encoded output. */
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 82;

export type ReEncodedMedia = {
  bytes: Uint8Array;
  /** What the DECODER reported, not what any client claimed. */
  contentType: AcceptedImageType;
  width: number;
  height: number;
};

/** sharp's format name for the types we accept. */
const FORMAT_TO_TYPE: Readonly<Record<string, AcceptedImageType>> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Decode, normalize orientation, and write fresh bytes.
 *
 * Returns a rejection rather than throwing: an upload route must be able to
 * tell a bad image from a broken server, and an exception conflates them.
 */
export async function reEncodeImage(
  input: Uint8Array,
): Promise<MediaResult<ReEncodedMedia>> {
  if (input.length === 0) {
    return mediaFailure('rejected', 'That file is empty.');
  }
  if (input.length > MAX_UPLOAD_BYTES) {
    return mediaFailure('rejected', 'That image is too large.');
  }

  // Cheap prefix check first, so obvious non-images never reach the decoder.
  const sniffed = sniffImageType(input);
  if (sniffed === null) {
    return mediaFailure('rejected', 'That file is not an image we accept.');
  }

  try {
    // `limitInputPixels` is the bomb guard; `failOn: 'error'` makes sharp
    // refuse a truncated or corrupt file instead of returning whatever it
    // managed to decode. A partially-decoded image is exactly the kind of
    // "worked well enough" that puts unverified bytes in a bucket.
    const pipeline = sharp(Buffer.from(input), {
      limitInputPixels: MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION,
      failOn: 'error',
    });

    const metadata = await pipeline.metadata();
    const decodedType = FORMAT_TO_TYPE[metadata.format ?? ''];
    if (!isAcceptedImageType(decodedType)) {
      return mediaFailure('rejected', 'That file is not an image we accept.');
    }

    // The decoder is the authority, and it disagreeing with the prefix means
    // the bytes are lying about themselves in one direction or the other.
    // Neither is an upload worth accepting.
    if (decodedType !== sniffed) {
      return mediaFailure('rejected', 'That file is not an image we accept.');
    }

    if (
      (metadata.width ?? 0) > MAX_IMAGE_DIMENSION
      || (metadata.height ?? 0) > MAX_IMAGE_DIMENSION
    ) {
      return mediaFailure('rejected', 'That image is too large.');
    }

    // `.rotate()` with no argument applies the EXIF orientation to the PIXELS
    // before the tag is dropped. Without it, stripping metadata silently turns
    // every portrait phone photo sideways — the strip would be correct and the
    // product would be visibly broken.
    const rotated = pipeline.rotate();

    // No `.withMetadata()` anywhere in this chain. That call is what would
    // carry EXIF across the re-encode, and its absence is the requirement.
    const encoded = decodedType === 'image/png'
      ? await rotated.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : decodedType === 'image/webp'
        ? await rotated.webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true })
        : await rotated.jpeg({ quality: JPEG_QUALITY }).toBuffer({ resolveWithObject: true });

    // THE OUTPUT IS BOUNDED TOO. Re-encoding is not guaranteed to shrink, so a
    // legal 12 MiB input can produce more than the bucket's 8 MiB limit. Refusing
    // here turns a Storage 500 into an honest, bounded rejection.
    if (encoded.data.byteLength > MAX_STORED_BYTES) {
      return mediaFailure('too_large', 'That image is too large to store.');
    }

    return {
      ok: true,
      value: {
        bytes: new Uint8Array(encoded.data),
        contentType: decodedType,
        width: encoded.info.width,
        height: encoded.info.height,
      },
    };
  } catch {
    // Decode failed, the file is malformed, or the codec is missing. All three
    // reject; none of them stores the original.
    return mediaFailure('rejected', 'That image could not be processed.');
  }
}
