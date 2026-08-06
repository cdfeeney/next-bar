// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  __resetRequested,
  __resetRuntimeFlag,
  billableEventCountForSurface,
  billableEventCount,
  isRuntimeGoogleMediaEnabled,
  markRequested,
  requestedCount,
} from '@/lib/placesUiKit';

beforeEach(() => {
  __resetRequested();
  __resetRuntimeFlag();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFlags(response: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const spy = vi.fn(response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('isRuntimeGoogleMediaEnabled — fail-closed runtime gate', () => {
  test('flags route unreachable (network error) → disabled', async () => {
    stubFlags(() => Promise.reject(new TypeError('fetch failed')));
    expect(await isRuntimeGoogleMediaEnabled()).toBe(false);
  });

  test('non-200 response → disabled', async () => {
    stubFlags(async () => new Response('{}', { status: 503 }));
    expect(await isRuntimeGoogleMediaEnabled()).toBe(false);
  });

  test('malformed body → disabled', async () => {
    stubFlags(async () => new Response('not json', { status: 200 }));
    expect(await isRuntimeGoogleMediaEnabled()).toBe(false);
  });

  test('googleMedia must be BOOLEAN true — "true" string is disabled', async () => {
    stubFlags(
      async () =>
        new Response(JSON.stringify({ googleMedia: 'true' }), { status: 200 }),
    );
    expect(await isRuntimeGoogleMediaEnabled()).toBe(false);
  });

  test('{googleMedia:true} → enabled, and the verdict is briefly cached', async () => {
    const spy = stubFlags(
      async () =>
        new Response(JSON.stringify({ googleMedia: true }), { status: 200 }),
    );
    expect(await isRuntimeGoogleMediaEnabled()).toBe(true);
    expect(await isRuntimeGoogleMediaEnabled()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1); // second read served from the TTL cache
  });

  test('a FAILED check is never cached — the next creation retries', async () => {
    let calls = 0;
    stubFlags(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ googleMedia: true }), { status: 200 });
    });
    expect(await isRuntimeGoogleMediaEnabled()).toBe(false);
    expect(await isRuntimeGoogleMediaEnabled()).toBe(true);
  });

  test('concurrent checks share one in-flight request (single-flight)', async () => {
    const spy = stubFlags(
      async () =>
        new Response(JSON.stringify({ googleMedia: true }), { status: 200 }),
    );
    const [a, b] = await Promise.all([
      isRuntimeGoogleMediaEnabled(),
      isRuntimeGoogleMediaEnabled(),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('per-surface request metering', () => {
  test('billable events are attributed to the surface that created the widget', () => {
    markRequested('place-1', 'result-card');
    markRequested('place-1', 'result-card'); // same place, second widget: bills again
    markRequested('place-2', 'bar-lightbox');

    expect(billableEventCountForSurface('result-card')).toBe(2);
    expect(billableEventCountForSurface('bar-lightbox')).toBe(1);
    expect(billableEventCountForSurface('recap-card')).toBe(0);
    // The invoice-level totals are unchanged by attribution.
    expect(billableEventCount()).toBe(3);
    expect(requestedCount()).toBe(2); // distinct place_ids — diagnostic only
  });

  test('an unattributed call still counts toward the invoice total', () => {
    markRequested('place-3');
    expect(billableEventCount()).toBe(1);
    expect(billableEventCountForSurface('unattributed')).toBe(1);
  });
});
