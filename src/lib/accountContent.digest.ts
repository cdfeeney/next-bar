/**
 * accountContent.digest — canonical synchronous content identity (v2.1).
 *
 * Identity = FNV-1a 64-bit digest + UTF-8 byte length over the canonical
 * JSON text (sorted object keys, arrays in place). Every preservation
 * decision in the quarantine/journal/confirmation machinery compares this
 * identity — never object references, never raw localStorage text, never
 * "no error happened".
 *
 * FNV-1a is deliberate: synchronous (no SubtleCrypto promise), tiny, and
 * collision-resistant enough for change detection between a device and its
 * own server rows. It is NOT a security boundary — RLS is.
 */

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit over the UTF-8 bytes of `text`, as 16 lowercase hex chars. */
export function fnv1a64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let hash = FNV_OFFSET_BASIS;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & U64;
  }
  return hash.toString(16).padStart(16, '0');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

/** The single canonical JSON text every digest and equality check uses. */
export function canonicalAccountContentJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export type ContentIdentity = {
  /** fnv1a64 of the canonical JSON text. */
  digest: string;
  /** UTF-8 byte length of the canonical JSON text. */
  byteLength: number;
};

export function contentIdentity(value: unknown): ContentIdentity {
  const text = canonicalAccountContentJson(value);
  return {
    digest: fnv1a64(text),
    byteLength: new TextEncoder().encode(text).length,
  };
}
