/**
 * Rate windows for /api/media-metric. Lives outside the route file because
 * Next route modules permit only handler exports.
 *
 * TWO limiters, deliberately, because they bound different things:
 *
 *  - `mediaMetricRateLimited` is a GLOBAL per-instance window (not keyed by
 *    caller). It caps how much this instance will log in a minute, full
 *    stop, and it is what the existing route tests exercise. Retained as the
 *    local backstop.
 *  - `sharedLimiter` (Item 10) is PER-IP and shared across instances, so one
 *    caller can no longer spread a flood across warm instances to stay under
 *    every local window.
 *
 * Both are FAIL-OPEN: this counter is advisory — Google's SKU metrics are
 * the authoritative meter (docs/GOOGLE-MEDIA-RUNBOOK.md) — so it must never
 * block or error a media request because a rate-limit store blipped.
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

/**
 * Test seam only. Resets BOTH tiers: the global per-instance window above and
 * the shared limiter's local backstop. Missing the second one made a suite
 * fail as though the limiter were broken when it was really carrying state
 * between tests.
 */
export function __resetMediaMetricRateLimit(): void {
  windowStart = 0;
  windowCount = 0;
  sharedLimiter.resetLocal();
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

import { createTieredLimiter } from '@/lib/rateLimiter';
import {
  durableCounterFromEnv,
  rateLimitSaltFromEnv,
} from '@/lib/rateLimiter.durable';

export { requestPublicHost } from '@/lib/requestBoundary';
export type { BoundedRead } from '@/lib/requestBoundary';

/** This route's payload is `{"surface":"result-card"}` and nothing else. */
export const MAX_BODY_BYTES = 64;

export const sharedLimiter = createTieredLimiter({
  bucket: 'media-metric-ip',
  limit: RATE_LIMIT_MAX,
  windowMs: RATE_LIMIT_WINDOW_MS,
  durable: durableCounterFromEnv(),
  salt: rateLimitSaltFromEnv(),
  onDegraded: 'fail-open',
});

export function contentLengthExceeds(header: string | null): boolean {
  return contentLengthExceedsBy(header, MAX_BODY_BYTES);
}

export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
): Promise<BoundedRead> {
  return readBoundedBodyTo(body, MAX_BODY_BYTES);
}
