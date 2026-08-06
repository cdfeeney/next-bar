// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { reportGoogleMediaRequest, sendMediaMetric } from '@/lib/mediaMetric';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendMediaMetric — advisory, surface-only, never blocking', () => {
  test('prefers sendBeacon with the surface enum as the whole payload', () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    sendMediaMetric('result-card');
    expect(beacon).toHaveBeenCalledWith(
      '/api/media-metric',
      JSON.stringify({ surface: 'result-card' }),
    );
  });

  test('falls back to keepalive fetch when sendBeacon is unavailable — and swallows rejection', async () => {
    vi.stubGlobal('navigator', {} as Navigator);
    const fetchSpy = vi.fn(() => Promise.reject(new TypeError('offline')));
    vi.stubGlobal('fetch', fetchSpy);
    expect(() => sendMediaMetric('result-card')).not.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.keepalive).toBe(true);
    await Promise.resolve(); // rejection settles without surfacing
  });

  test('a throwing beacon never propagates', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      sendBeacon: () => {
        throw new Error('blocked');
      },
    });
    expect(() => sendMediaMetric('result-card')).not.toThrow();
  });

  test('reportGoogleMediaRequest DROPS the placeId the widget reports', () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    reportGoogleMediaRequest('ChIJsecret-place-id');
    const [, body] = beacon.mock.calls[0] as unknown as [string, string];
    expect(body).toBe(JSON.stringify({ surface: 'result-card' }));
    expect(body).not.toContain('ChIJ');
  });
});
