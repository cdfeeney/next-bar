/**
 * Content type by INSPECTION (V8-R-STO-014).
 *
 * The requirement is explicit that a client-declared MIME allowlist is not a
 * trust boundary: "content type is verified by inspection rather than by a
 * client-declared MIME allowlist". A modified client sends whatever
 * Content-Type it likes, so nothing in this module ever reads one.
 *
 * This is the CHEAP half of the check — a magic-byte prefix test that rejects
 * obvious non-images before a decoder is handed the bytes. It is not the whole
 * verification: the authoritative answer is what the decoder in `reEncode.ts`
 * actually managed to decode, and the type recorded in `media_objects` comes
 * from there. Treating a magic-byte match as proof of a valid image is how a
 * malformed file reaches a decoder that was never meant to see it.
 */

/** The image types this product accepts. Everything else is rejected. */
export type AcceptedImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export const ACCEPTED_IMAGE_TYPES: readonly AcceptedImageType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/** Longest prefix any signature below needs. */
const MAX_SIGNATURE_BYTES = 12;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

/**
 * The real type of these bytes, or null if they are not an image this product
 * accepts.
 *
 * Pure and synchronous so the rejection path costs nothing: a request carrying
 * a PDF, an HTML page or an executable never reaches the decoder at all.
 */
export function sniffImageType(bytes: Uint8Array): AcceptedImageType | null {
  if (bytes.length < MAX_SIGNATURE_BYTES) return null;

  // JPEG: SOI marker FF D8 FF.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // PNG: the 8-byte signature, including the CRLF/EOF trap bytes.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }

  // WebP: "RIFF" .... "WEBP" — the four size bytes in between are skipped, so
  // both halves are checked rather than trusting the RIFF container alone.
  // A bare RIFF match would accept a WAV file as an image.
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

export function isAcceptedImageType(value: unknown): value is AcceptedImageType {
  return typeof value === 'string'
    && (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(value);
}
