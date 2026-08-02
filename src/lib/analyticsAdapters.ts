/**
 * Analytics adapter foundation (goal g-649592c7) — DARK BY DEFAULT.
 *
 * The envelope is FACADE-CONSTRUCTED ONLY (DeepSeek design review): no code
 * path accepts an externally-shaped envelope object, so there is no
 * free-form field through which PII could ever travel. Adapters receive
 * exactly { v, name } where name passed the runtime allowlist.
 *
 * Operator-locked prohibitions, structural not procedural: no PostHog
 * account exists, no credentials live in this repo, collection is disabled
 * everywhere, there is no identify() and no per-user id anywhere in this
 * layer. Enabling is an ATTENDED operator action documented in
 * docs/ANALYTICS-DESIGN.md — it requires three env values that do not
 * exist in any environment today.
 */

/**
 * The allowlist lives HERE (not in analytics.ts) so the dependency stays
 * one-way: analytics.ts consumes this module, never the reverse.
 * analytics.ts re-exports these for its existing public API.
 */
export const ANALYTICS_EVENTS = ['search', 'share', 'save', 'visit'] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export const ENVELOPE_VERSION = 1 as const;

export interface AnalyticsEnvelope {
  v: typeof ENVELOPE_VERSION;
  name: AnalyticsEvent;
}

export interface AnalyticsAdapter {
  name: string;
  capture(envelope: AnalyticsEnvelope): void;
}

/** Runtime allowlist gate — TS narrows callers, this stops smugglers. */
export function buildEnvelope(name: AnalyticsEvent): AnalyticsEnvelope | null {
  if (!(ANALYTICS_EVENTS as readonly string[]).includes(name)) return null;
  return { v: ENVELOPE_VERSION, name };
}

/**
 * Module-level registry, mutated only via registerAdapter — called lazily
 * from client code, never as an import side effect (SSR-safe: importing
 * this module executes nothing that touches window/network).
 */
const adapters: AnalyticsAdapter[] = [];

export function registerAdapter(adapter: AnalyticsAdapter): void {
  adapters.push(adapter);
}

export function registeredAdapters(): readonly AnalyticsAdapter[] {
  return adapters;
}

/** Master kill-switch — exact '1' only, same rule as every gate here. */
export function isAnalyticsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ANALYTICS === '1';
}

/**
 * Fan an envelope out; one broken adapter never affects the rest.
 * DEFENSIVE AT THIS LAYER TOO (Codex review): this export is reachable
 * without going through trackEvent, so it re-checks the master flag and
 * REBUILDS the envelope from the name — a caller-shaped object with extra
 * keys (or a cast non-allowlisted name) is stripped or dropped here, not
 * trusted. Adapters can only ever observe a facade-shaped envelope.
 */
export function dispatchToAdapters(envelope: AnalyticsEnvelope): void {
  if (!isAnalyticsEnabled()) return;
  const safe = buildEnvelope(envelope.name);
  if (safe === null) return;
  for (const adapter of adapters) {
    try {
      adapter.capture(safe);
    } catch {
      // Analytics must never break the product — same rule as the facade.
    }
  }
}

/**
 * TRIPLE gate, all required, none present in any environment today:
 * exact-'1' flag AND key AND host. 'true'/'yes'/etc never enable.
 */
export function isPostHogEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED === '1' &&
    Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY) &&
    Boolean(process.env.NEXT_PUBLIC_POSTHOG_HOST)
  );
}

/**
 * PostHog adapter WITHOUT posthog-js: when (attended-future) enabled it
 * posts the envelope to <host>/capture/ with the anonymous constant
 * distinct_id — no cookies, no localStorage, no user identity ever.
 * Disabled ⇒ capture() returns before ANY browser/network API is touched.
 */
export function createPostHogAdapter(): AnalyticsAdapter {
  return {
    name: 'posthog',
    capture(envelope: AnalyticsEnvelope): void {
      if (!isPostHogEnabled()) return;
      if (typeof window === 'undefined') return;
      try {
        const body = JSON.stringify({
          api_key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
          event: envelope.name,
          properties: { v: envelope.v, distinct_id: 'nb-anon' },
        });
        const url = `${process.env.NEXT_PUBLIC_POSTHOG_HOST}/capture/`;
        // sendBeacon returns false when the browser REFUSES to queue (quota
        // full) — that is not delivery; fall through to fetch (Codex review).
        if (navigator.sendBeacon && navigator.sendBeacon(url, body)) {
          return;
        }
        void fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        // Never break the product.
      }
    },
  };
}

/** Test-only: adapter registry is module state and must not leak across tests. */
export function __resetAdaptersForTests(): void {
  adapters.length = 0;
}
