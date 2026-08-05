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

import {
  ANALYTICS_EVENTS,
  buildEnvelope,
  dispatchToAdapters,
  isAnalyticsEnabled,
  type AnalyticsEvent,
} from './analyticsAdapters';

// Allowlist + type + master-flag check moved to analyticsAdapters.ts
// (one-way dependency; the dispatcher needs the flag for its own defensive
// gate) — re-exported here so every existing consumer keeps its import path.
export { ANALYTICS_EVENTS, isAnalyticsEnabled };
export type { AnalyticsEvent };

/**
 * Names outside ANALYTICS_EVENTS are DROPPED entirely (runtime allowlist,
 * GLM review note) — a future caller adding an event must extend the
 * allowlist first, or its beacon silently no-ops.
 */
export function trackEvent(name: AnalyticsEvent): void {
  if (!isAnalyticsEnabled()) return;
  if (typeof window === 'undefined') return;
  // Envelope layer (g-649592c7): facade-constructed, versioned, allowlisted
  // — adapters never see a caller-shaped object. The legacy /api/event
  // beacon below is UNCHANGED (Supabase aggregate counters stay live);
  // adapters are additive and dark by default.
  const envelope = buildEnvelope(name);
  if (envelope === null) return; // non-allowlisted name: dropped entirely
  dispatchToAdapters(envelope);
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
