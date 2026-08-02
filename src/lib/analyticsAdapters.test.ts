import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  __resetAdaptersForTests,
  buildEnvelope,
  createPostHogAdapter,
  dispatchToAdapters,
  isPostHogEnabled,
  registerAdapter,
  registeredAdapters,
  type AnalyticsEnvelope,
} from './analyticsAdapters';
import { trackEvent } from './analytics';

/**
 * PostHog foundation (goal g-649592c7). Operator-locked prohibitions: no
 * account, no credentials, no collection enabled, no user identification,
 * no dashboards. These tests pin the structural guarantees: versioned
 * facade-constructed envelopes, runtime allowlist, and an adapter that is
 * INERT — zero network — unless three env values exist, none of which do.
 */

describe('analytics adapter foundation (dark by default)', () => {
  beforeEach(() => {
    __resetAdaptersForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    __resetAdaptersForTests();
  });

  test('envelopes are versioned, facade-constructed, and allowlist-enforced', () => {
    expect(buildEnvelope('search')).toEqual({ v: 1, name: 'search' });
    // Non-allowlisted names are rejected at runtime even though TS types
    // them away — future callers cannot smuggle arbitrary strings.
    expect(buildEnvelope('signup_email' as never)).toBeNull();
    // The envelope has exactly two keys by construction — no free-form
    // fields exist to carry PII (DeepSeek design condition).
    expect(Object.keys(buildEnvelope('share') as object).sort()).toEqual(['name', 'v']);
  });

  test('PostHog adapter is DISABLED by default — no env vars exist for it', () => {
    expect(isPostHogEnabled()).toBe(false);
  });

  test("'true'/'yes'/'TRUE' do not enable — only the exact string '1'", () => {
    for (const v of ['true', 'TRUE', 'yes', 'on', '']) {
      vi.stubEnv('NEXT_PUBLIC_POSTHOG_ENABLED', v);
      vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
      vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://ph.example.com');
      expect(isPostHogEnabled()).toBe(false);
    }
  });

  test('flag alone is NOT enough — key and host must also exist', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_ENABLED', '1');
    expect(isPostHogEnabled()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    expect(isPostHogEnabled()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://ph.example.com');
    expect(isPostHogEnabled()).toBe(true);
  });

  test('disabled adapter makes ZERO network calls and touches no browser API', () => {
    const beacon = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    vi.stubGlobal('fetch', fetchSpy);
    const adapter = createPostHogAdapter();
    adapter.capture({ v: 1, name: 'search' });
    adapter.capture({ v: 1, name: 'visit' });
    expect(beacon).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('enabled adapter (test-only env) posts ONLY the envelope — no identify, no ids', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_ENABLED', '1');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://ph.example.com');
    const beacon = vi.fn();
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    const adapter = createPostHogAdapter();
    adapter.capture({ v: 1, name: 'save' });
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, payload] = beacon.mock.calls[0];
    expect(url).toBe('https://ph.example.com/capture/');
    const parsed = JSON.parse(payload as string);
    expect(parsed).toEqual({
      api_key: 'phc_test',
      event: 'save',
      properties: { v: 1, distinct_id: 'nb-anon' },
    });
    // Structural prohibitions: no user identification surface exists.
    expect(JSON.stringify(parsed)).not.toContain('email');
    expect('identify' in adapter).toBe(false);
  });

  test('adapter registry: envelopes fan out to registered adapters via trackEvent', () => {
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS', '1');
    vi.stubGlobal('navigator', { sendBeacon: vi.fn() });
    const captured: AnalyticsEnvelope[] = [];
    registerAdapter({ name: 'test', capture: (e) => captured.push(e) });
    trackEvent('search');
    expect(captured).toEqual([{ v: 1, name: 'search' }]);
  });

  test('adapters do NOT run when the master analytics flag is off', () => {
    const captured: AnalyticsEnvelope[] = [];
    registerAdapter({ name: 'test', capture: (e) => captured.push(e) });
    trackEvent('search');
    expect(captured).toEqual([]);
  });

  test('dispatchToAdapters is defensive on its own: flag-gated, rebuilds, strips smuggled keys', () => {
    // Codex review: this export is reachable WITHOUT trackEvent, so the
    // guarantees must hold at this layer too.
    const captured: AnalyticsEnvelope[] = [];
    registerAdapter({ name: 'test', capture: (e) => captured.push(e) });

    // Master flag off → nothing, even via direct dispatch.
    dispatchToAdapters({ v: 1, name: 'search' });
    expect(captured).toEqual([]);

    vi.stubEnv('NEXT_PUBLIC_ANALYTICS', '1');
    // Smuggled extra key is STRIPPED (envelope rebuilt, not trusted).
    dispatchToAdapters({ v: 1, name: 'share', email: 'x@y.z' } as never);
    expect(captured).toEqual([{ v: 1, name: 'share' }]);
    // Cast non-allowlisted name is dropped outright.
    dispatchToAdapters({ v: 1, name: 'signup_email' } as never);
    expect(captured).toHaveLength(1);
  });

  test('enabled adapter falls back to fetch when sendBeacon refuses to queue', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_ENABLED', '1');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://ph.example.com');
    const beacon = vi.fn().mockReturnValue(false); // browser refused (quota)
    const fetchSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    vi.stubGlobal('fetch', fetchSpy);
    createPostHogAdapter().capture({ v: 1, name: 'visit' });
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // refusal is not delivery
  });

  test('an adapter that throws never breaks the product or other adapters', () => {
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS', '1');
    vi.stubGlobal('navigator', { sendBeacon: vi.fn() });
    const captured: AnalyticsEnvelope[] = [];
    registerAdapter({
      name: 'bad',
      capture: () => {
        throw new Error('adapter boom');
      },
    });
    registerAdapter({ name: 'good', capture: (e) => captured.push(e) });
    expect(() => trackEvent('visit')).not.toThrow();
    expect(captured).toEqual([{ v: 1, name: 'visit' }]);
  });

  test('legacy Supabase counter beacon is unchanged by the adapter layer', () => {
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS', '1');
    const beacon = vi.fn();
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    registerAdapter({ name: 'test', capture: () => undefined });
    trackEvent('share');
    expect(beacon).toHaveBeenCalledWith('/api/event', JSON.stringify({ name: 'share' }));
    expect(registeredAdapters().map((a) => a.name)).toEqual(['test']);
  });
});
