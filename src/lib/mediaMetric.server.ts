/**
 * Per-instance rate window for /api/media-metric. Serverless instances are
 * ephemeral, so this is best-effort abuse damping, not a durable quota —
 * Google's SKU quota is the durable one (docs/GOOGLE-MEDIA-RUNBOOK.md).
 * Lives outside the route file because Next route modules permit only
 * handler exports.
 */

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX = 120;

let windowStart = 0;
let windowCount = 0;

export function mediaMetricRateLimited(now: number): boolean {
  if (now - windowStart >= RATE_LIMIT_WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount > RATE_LIMIT_MAX;
}

/** Test seam only. */
export function __resetMediaMetricRateLimit(): void {
  windowStart = 0;
  windowCount = 0;
}

export const MAX_BODY_BYTES = 64;

/**
 * True when an HONEST Content-Length already exceeds the cap — reject before
 * reading a single byte. A missing, malformed, or dishonest header returns
 * false and the caller falls through to the bounded stream read, which is
 * the enforcement that cannot be lied to.
 */
export function contentLengthExceeds(header: string | null): boolean {
  if (header === null) return false;
  const n = Number(header);
  return Number.isFinite(n) && n > MAX_BODY_BYTES;
}

export type BoundedRead = { kind: 'ok'; bytes: Uint8Array } | { kind: 'too-large' };

/**
 * Read a request stream incrementally, counting actual UTF-8 BYTES (never
 * JS string length — one '€' is three bytes). The moment cumulative bytes
 * exceed MAX_BODY_BYTES the reader is cancelled and the caller returns 413:
 * a chunked or dishonestly-labelled body cannot buffer past the cap.
 * Decoding happens only AFTER the bounded read, on at most 64 bytes.
 */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
): Promise<BoundedRead> {
  if (!body) return { kind: 'ok', bytes: new Uint8Array(0) };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return { kind: 'too-large' };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: 'ok', bytes };
}

/**
 * The public host this request was addressed to. On Vercel the edge sets
 * x-forwarded-host to the public hostname while Host may be an internal
 * routing value, so the forwarded header wins when present. A forwarding
 * CHAIN (comma-separated) contributes its FIRST entry — the client-facing
 * hop. Normalized to lower case; empty/malformed values return null and
 * the caller rejects.
 */
export function requestPublicHost(
  forwardedHost: string | null,
  host: string | null,
): string | null {
  const candidate = forwardedHost
    ? forwardedHost.split(',')[0]?.trim()
    : host?.trim();
  if (!candidate) return null;
  return candidate.toLowerCase();
}
