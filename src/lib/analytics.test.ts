import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  ANALYTICS_EVENTS,
  isAnalyticsEnabled,
  trackEvent,
} from './analytics';

describe('analytics skeleton (N4 — dark by default)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test('exactly the four privacy-light product events exist', () => {
    expect(ANALYTICS_EVENTS).toEqual(['search', 'share', 'save', 'visit']);
  });

  test('disabled without the flag — no network call ever fires', () => {
    const beacon = vi.fn();
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    expect(isAnalyticsEnabled()).toBe(false);
    trackEvent('search');
    expect(beacon).not.toHaveBeenCalled();
  });

  test('with the flag, the event name is beaconed to /api/event', () => {
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS', '1');
    const beacon = vi.fn();
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    trackEvent('share');
    expect(beacon).toHaveBeenCalledWith(
      '/api/event',
      JSON.stringify({ name: 'share' }),
    );
  });

  test('a beacon that throws never propagates (analytics must not break the product)', () => {
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS', '1');
    vi.stubGlobal('navigator', {
      sendBeacon: () => {
        throw new Error('boom');
      },
    });
    expect(() => trackEvent('visit')).not.toThrow();
  });
});
