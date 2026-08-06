/**
 * Fire-and-forget telemetry for Google-media widget creations.
 *
 * ADVISORY ONLY: this signal exists so the operator can see request volume
 * in Vercel logs without waiting on Google's console. Google Cloud's SKU
 * metrics remain the AUTHORITATIVE usage and billing meter — a dropped
 * beacon under-counts here and changes nothing there.
 *
 * Privacy/scope contract (santa BLOCK, 2026-08-06): the payload is the
 * surface enum and NOTHING else — no place_id, no bar id, no user id, no
 * cookies read, no arbitrary fields. The signature deliberately ACCEPTS the
 * placeId GooglePlacePhoto's onBillableRequest passes and then drops it, so
 * a caller cannot wire the id through by accident.
 *
 * Failure contract: never throws, never blocks, never retries. A photo must
 * render identically whether this beacon lands or not.
 */

/** The only billing surface in this release (see docs/GOOGLE-MEDIA-RUNBOOK.md). */
export type GoogleMediaSurface = 'result-card';

export const MEDIA_METRIC_PATH = '/api/media-metric';

export function sendMediaMetric(surface: GoogleMediaSurface): void {
  try {
    const body = JSON.stringify({ surface });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(MEDIA_METRIC_PATH, body);
      return;
    }
    if (typeof fetch === 'function') {
      void fetch(MEDIA_METRIC_PATH, {
        method: 'POST',
        body,
        keepalive: true,
        headers: { 'content-type': 'application/json' },
      }).catch(() => {
        /* advisory — a lost beacon must cost nothing */
      });
    }
  } catch {
    /* advisory — never let telemetry disturb the photo path */
  }
}

/**
 * The exact callback ResultCard hands to GooglePlacePhoto. Takes the
 * placeId the component reports and DISCARDS it — surface enum only.
 */
export function reportGoogleMediaRequest(_placeId: string): void {
  sendMediaMetric('result-card');
}
