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

/**
 * The bounded-body and origin primitives BELOW used to be implemented here,
 * and this was the only route that had them. Item 9 needed the same
 * behaviour on /api/waitlist and /api/event, so the implementation moved to
 * `@/lib/requestBoundary` and this module now supplies only the 64-byte cap
 * that is specific to THIS route's payload. One implementation, one suite,
 * three callers — copying it twice more was the alternative and it is how
 * boundary code drifts apart.
 */
import {
  contentLengthExceeds as contentLengthExceedsBy,
  readBoundedBody as readBoundedBodyTo,
  type BoundedRead,
} from '@/lib/requestBoundary';

export { requestPublicHost } from '@/lib/requestBoundary';
export type { BoundedRead } from '@/lib/requestBoundary';

/** This route's payload is `{"surface":"result-card"}` and nothing else. */
export const MAX_BODY_BYTES = 64;

export function contentLengthExceeds(header: string | null): boolean {
  return contentLengthExceedsBy(header, MAX_BODY_BYTES);
}

export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
): Promise<BoundedRead> {
  return readBoundedBodyTo(body, MAX_BODY_BYTES);
}
