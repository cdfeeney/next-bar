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
