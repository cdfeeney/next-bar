import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import GooglePlacePhoto from './GooglePlacePhoto';
import {
  WIDGET_LOAD_TIMEOUT_MS,
  __resetLoader,
  __resetRequested,
  requestedCount,
} from '@/lib/placesUiKit';

/**
 * The default path must cost nothing and break nothing.
 *
 * No Google Maps API key is configured in this repo yet, so every render here
 * exercises the unconfigured path — which is exactly the state a fresh deploy,
 * a preview branch, or a rollback would be in. It must degrade to the caller's
 * fallback, issue zero requests, and inject no script.
 */

const FALLBACK = <span data-testid="glyph-fallback">glyph</span>;

beforeEach(() => {
  __resetLoader();
  __resetRequested();
  document.head.querySelectorAll('script[src*="maps.googleapis.com"]').forEach((s) => s.remove());
});

describe('GooglePlacePhoto with no API key configured', () => {
  test('renders the fallback rather than an empty box', async () => {
    render(<GooglePlacePhoto placeId="ChIJtest" fallback={FALLBACK} />);
    await waitFor(() => expect(screen.getByTestId('glyph-fallback')).toBeTruthy());
    expect(screen.queryByTestId('google-place-photo')).toBeNull();
  });

  test('issues zero billable requests', async () => {
    render(<GooglePlacePhoto placeId="ChIJtest" fallback={FALLBACK} />);
    await waitFor(() => expect(screen.getByTestId('glyph-fallback')).toBeTruthy());
    expect(requestedCount()).toBe(0);
  });

  test('never injects the Google Maps script', async () => {
    render(<GooglePlacePhoto placeId="ChIJtest" fallback={FALLBACK} />);
    await waitFor(() => expect(screen.getByTestId('glyph-fallback')).toBeTruthy());
    expect(document.querySelectorAll('script[src*="maps.googleapis.com"]').length).toBe(0);
  });

  test('does not fire the billing callback', async () => {
    const onBillableRequest = vi.fn();
    render(
      <GooglePlacePhoto placeId="ChIJtest" fallback={FALLBACK} onBillableRequest={onBillableRequest} />,
    );
    await waitFor(() => expect(screen.getByTestId('glyph-fallback')).toBeTruthy());
    expect(onBillableRequest).not.toHaveBeenCalled();
  });
});

describe('surface exclusion', () => {
  // Criterion 12 surfaces (pickers, saved lists, recaps, dense maps, markers)
  // must never bill. They should not render this component at all — this is the
  // second gate behind that, so a stray google-live decision cannot leak.
  test('allowed={false} renders the fallback and issues nothing', async () => {
    const onBillableRequest = vi.fn();
    render(
      <GooglePlacePhoto
        placeId="ChIJtest"
        allowed={false}
        fallback={FALLBACK}
        onBillableRequest={onBillableRequest}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('glyph-fallback')).toBeTruthy());
    expect(requestedCount()).toBe(0);
    expect(onBillableRequest).not.toHaveBeenCalled();
  });

  test('an empty placeId is treated as unavailable, not requested', async () => {
    render(<GooglePlacePhoto placeId="" fallback={FALLBACK} />);
    await waitFor(() => expect(screen.getByTestId('glyph-fallback')).toBeTruthy());
    expect(requestedCount()).toBe(0);
  });
});

/**
 * Regression for the stuck-'pending' bug Codex found in 0f614b8.
 *
 * With the SDK configured, `onBillableRequest` used to sit in the effect's
 * dependency array. Callers pass an inline arrow, so its identity changed every
 * render, the effect re-ran, cleanup cancelled the in-flight build, and the
 * re-run bailed on builtRef — leaving status on 'pending' forever: an empty
 * reserved box showing neither a photo nor the fallback.
 *
 * These tests need the CONFIGURED path, which the suite above cannot reach
 * (no key in this repo), so the seam module is mocked.
 */
describe('re-render churn does not strand the widget (regression, Codex 0f614b8)', () => {
  let observerCount = 0;

  beforeEach(() => {
    observerCount = 0;
    class FakeObserver {
      constructor(private cb: IntersectionObserverCallback) {
        observerCount += 1;
        // Fire immediately so the build path runs without real scrolling.
        queueMicrotask(() =>
          this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as never),
        );
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver as unknown as typeof IntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('@/lib/placesUiKit');
  });

  test('a new onBillableRequest identity does not re-run the effect', async () => {
    vi.doMock('@/lib/placesUiKit', async (orig) => ({
      ...(await orig<typeof import('@/lib/placesUiKit')>()),
      isPlacesUiKitConfigured: () => true,
      loadPlacesUiKit: async () => true,
    }));
    vi.resetModules();
    const { default: Fresh } = await import('./GooglePlacePhoto');

    const { rerender } = render(
      <Fresh placeId="ChIJtest" fallback={FALLBACK} onBillableRequest={() => {}} />,
    );
    await waitFor(() => expect(observerCount).toBe(1));

    // A parent re-render with a brand-new inline arrow — the exact trigger.
    rerender(<Fresh placeId="ChIJtest" fallback={FALLBACK} onBillableRequest={() => {}} />);
    rerender(<Fresh placeId="ChIJtest" fallback={FALLBACK} onBillableRequest={() => {}} />);

    // One observer means one effect run means one billable widget. Before the
    // fix this climbed with every render.
    await waitFor(() => expect(observerCount).toBe(1));
  });

  /**
   * Regression, santa-loop round 3.
   *
   * The safety timer used to be armed only AFTER `await loadPlacesUiKit()`, so a
   * loader that never settled meant nothing downstream ever ran and the card sat
   * on 'pending' forever. The loader is bounded now too, but the component must
   * not depend on a collaborator's internal timing for its own liveness.
   */
  test('a loader that NEVER settles still falls back', async () => {
    vi.useFakeTimers();
    try {
      vi.doMock('@/lib/placesUiKit', async (orig) => ({
        ...(await orig<typeof import('@/lib/placesUiKit')>()),
        isPlacesUiKitConfigured: () => true,
        // Never settles — the exact round-3 hang.
        loadPlacesUiKit: () => new Promise<boolean>(() => {}),
      }));
      vi.resetModules();
      const { default: Fresh } = await import('./GooglePlacePhoto');
      const { MAX_LOAD_MS: MAX } = await import('@/lib/placesUiKit');

      render(<Fresh placeId="ChIJtest" fallback={FALLBACK} onBillableRequest={() => {}} />);

      await vi.advanceTimersByTimeAsync(MAX + 100);
      expect(screen.queryByTestId('glyph-fallback')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  test('never strands the user on an empty box: it resolves to the fallback', async () => {
    vi.useFakeTimers();
    try {
      vi.doMock('@/lib/placesUiKit', async (orig) => ({
        ...(await orig<typeof import('@/lib/placesUiKit')>()),
        isPlacesUiKitConfigured: () => true,
        loadPlacesUiKit: async () => true,
      }));
      vi.resetModules();
      const { default: Fresh } = await import('./GooglePlacePhoto');

      render(<Fresh placeId="ChIJtest" fallback={FALLBACK} onBillableRequest={() => {}} />);

      // gmp-load never fires in jsdom, so the WIDGET timeout must rescue the
      // user. (This referenced SDK_LOAD_TIMEOUT_MS until santa-loop round 2 —
      // it passed only because 5100 > 4000, i.e. for the wrong reason.)
      await vi.advanceTimersByTimeAsync(WIDGET_LOAD_TIMEOUT_MS + 100);
      expect(screen.queryByTestId('glyph-fallback')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
