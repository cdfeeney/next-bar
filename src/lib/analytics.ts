/**
 * Privacy-light product analytics — client side (N4 skeleton, DARK).
 * Design: docs/ANALYTICS-DESIGN.md.
 *
 * trackEvent fire-and-forgets one of four event NAMES to /api/event —
 * no user id, no bar id, no payload. Hard no-op unless
 * NEXT_PUBLIC_ANALYTICS === '1' (and the server side needs its own flag
 * + applied migration 0018 before anything lands). Never throws, never
 * blocks UI.
 */

export const ANALYTICS_EVENTS = ['search', 'share', 'save', 'visit'] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export function isAnalyticsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ANALYTICS === '1';
}

export function trackEvent(name: AnalyticsEvent): void {
  if (!isAnalyticsEnabled()) return;
  if (typeof window === 'undefined') return;
  try {
    const body = JSON.stringify({ name });
    // sendBeacon survives page navigations (share taps often navigate);
    // fetch keepalive is the fallback.
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/event', body);
      return;
    }
    void fetch('/api/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Analytics must never break the product.
  }
}
