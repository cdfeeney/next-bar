// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * The widget must be built as the COMPACT element and must never be clipped.
 *
 * Live measurement at 390x844 (Staging, 2026-08-06) found the full
 * <gmp-place-details> laying out at 340x365 inside a 145.7px
 * `aspect-[16/9] overflow-hidden` host: Google's media AND its required
 * attribution were cut off. Clipping the provider's credit is a policy
 * violation, so both halves of that are pinned here.
 */

vi.mock('@/lib/placesUiKit', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/placesUiKit')>('@/lib/placesUiKit');
  return {
    ...actual,
    isPlacesUiKitConfigured: vi.fn(() => true),
    isRuntimeGoogleMediaEnabled: vi.fn(async () => true),
    loadPlacesUiKit: vi.fn(async () => true),
  };
});

import GooglePlacePhoto from './GooglePlacePhoto';
import {
  WIDGET_LOAD_TIMEOUT_MS,
  __resetRequested,
  billableEventCountForSurface,
} from '@/lib/placesUiKit';

const FALLBACK = <span data-testid="glyph-fallback">glyph</span>;

afterEach(() => {
  __resetRequested();
  vi.clearAllMocks();
});

async function mountWidget(): Promise<HTMLElement> {
  render(
    <GooglePlacePhoto placeId="ChIJtest" surface="result-card" fallback={FALLBACK} />,
  );
  const host = await screen.findByTestId('google-place-photo');
  await waitFor(() =>
    expect(host.querySelector('gmp-place-details-compact')).not.toBeNull(),
  );
  return host;
}

describe('compact element construction', () => {
  test('openNowStatus adds the open-now line to the same single request (T-01a lightbox)', async () => {
    render(<GooglePlacePhoto placeId="ChIJhours" surface="bar-lightbox" fallback={FALLBACK} openNowStatus />);
    const host = await vi.waitFor(() => screen.getByTestId('google-place-photo'));
    await vi.waitFor(() => expect(host.querySelector('gmp-place-details-compact')).not.toBeNull());
    const config = host.querySelector('gmp-place-content-config');
    expect(config?.querySelector('gmp-place-open-now-status')).not.toBeNull();
    expect(config?.querySelector('gmp-place-media')).not.toBeNull();
    expect(billableEventCountForSurface('bar-lightbox')).toBe(1);
  });

  test('creates gmp-place-details-compact, never the full details element', async () => {
    const host = await mountWidget();
    expect(host.querySelector('gmp-place-details-compact')).not.toBeNull();
    // The full element is what clipped; it must not be created at all.
    expect(host.querySelector('gmp-place-details')).toBeNull();
  });

  test('retains the place request, media with lightbox-preferred, and attribution', async () => {
    const host = await mountWidget();
    const compact = host.querySelector('gmp-place-details-compact');
    const request = compact?.querySelector('gmp-place-details-place-request');
    expect(request?.getAttribute('place')).toBe('ChIJtest');

    const media = compact?.querySelector('gmp-place-media');
    expect(media).not.toBeNull();
    expect(media?.hasAttribute('lightbox-preferred')).toBe(true);

    const attribution = compact?.querySelector('gmp-place-attribution');
    expect(attribution).not.toBeNull();
    // Attribution stays a sibling of media inside the content config —
    // never removed, never repositioned by us.
    expect(attribution?.parentElement?.tagName.toLowerCase()).toBe(
      'gmp-place-content-config',
    );
  });

  test('one billable creation per widget, attributed to its surface', async () => {
    await mountWidget();
    expect(billableEventCountForSurface('result-card')).toBe(1);
  });
});

/**
 * A deadline is a deadline, not a verdict (T-01a): the fallback shows, the
 * host stays, and Google's late answer still lands in it.
 *
 * Once the widget budget expires the fallback renders over a HIDDEN host.
 * Google's element is still alive inside the `gmp-load` listener closure,
 * so a slow place/photo fetch completing afterwards flips status to 'ready'
 * and reveals that same host — never a fresh, empty one, and never a second
 * billable creation. (The pre-T-01a latch that kept the fallback for good
 * was santa: Claude/FABLE H-1's fix for a detached-host resurrection.)
 */
describe('a late widget replaces the fallback when it lands', () => {
  test('a gmp-load arriving after the timeout reveals the widget (T-01a)', async () => {
    vi.useFakeTimers();
    try {
      render(
        <GooglePlacePhoto placeId="ChIJlate" surface="result-card" fallback={FALLBACK} />,
      );

      const host = await vi.waitFor(() => screen.getByTestId('google-place-photo'));
      const compact = await vi.waitFor(() => {
        const el = host.querySelector('gmp-place-details-compact');
        expect(el).not.toBeNull();
        return el as Element;
      });

      // Burn the whole widget budget FIRST, then deliver Google's late answer:
      // the two must be observable as separate states, or the test cannot
      // tell "never gave up" from "recovered".
      // The deadline passes first: fallback visible, host kept (hidden).
      act(() => {
        vi.advanceTimersByTime(WIDGET_LOAD_TIMEOUT_MS + 1_000);
      });
      expect(screen.getByTestId('glyph-fallback')).toBeTruthy();
      expect(host.hidden).toBe(true);
      expect(host.getAttribute('data-status')).toBe('late');

      // Google's late answer lands in that SAME host (never rebuilt, never
      // re-billed): the widget shows, the fallback goes.
      act(() => {
        compact.dispatchEvent(new Event('gmp-load'));
      });
      expect(screen.queryByTestId('glyph-fallback')).toBeNull();
      expect(host.hidden).toBe(false);
      expect(host.getAttribute('data-status')).toBe('ready');
      expect(host.querySelector('gmp-place-details-compact')).toBe(compact);
      expect(billableEventCountForSurface('result-card')).toBe(1);

      await vi.advanceTimersByTimeAsync(50);
      expect(screen.queryByTestId('glyph-fallback')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * A card that gave up must still be able to start over.
 *
 * Once the fallback renders the host div is unmounted. A later placeId change
 * reaches a mounted card only if a parent reconciles by position rather than
 * identity — ResultsView.tsx:387 keys by `bar.id`, so this is defensive
 * coverage — and the effect used to re-run while the ref was still null, return
 * before installing anything, and never re-run again once the host mounted.
 * The card was then stuck on an empty pending box with no widget, no
 * fallback, no name and no Maps link. (santa: Codex, High.)
 */
describe('a new placeId after a fallback still builds', () => {
  test('recovers instead of stranding on an empty pending box', async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <GooglePlacePhoto placeId="ChIJfirst" surface="result-card" fallback={FALLBACK} />,
      );
      await vi.waitFor(() => expect(screen.getByTestId('google-place-photo')).toBeTruthy());

      // Let the first attempt run late so the fallback shows over a hidden host.
      await vi.advanceTimersByTimeAsync(WIDGET_LOAD_TIMEOUT_MS + 1_000);
      expect(screen.getByTestId('glyph-fallback')).toBeTruthy();
      expect(screen.getByTestId('google-place-photo').hidden).toBe(true);

      // A different bar now occupies this card position.
      rerender(
        <GooglePlacePhoto placeId="ChIJsecond" surface="result-card" fallback={FALLBACK} />,
      );

      // The replacement attempt must actually run: host back, widget built
      // for the NEW place. Previously this hung on 'pending' forever with an
      // empty host and no widget.
      const host = await vi.waitFor(() => screen.getByTestId('google-place-photo'));
      const compact = await vi.waitFor(() => {
        const el = host.querySelector('gmp-place-details-compact');
        expect(el).not.toBeNull();
        return el as Element;
      });
      expect(
        compact
          .querySelector('gmp-place-details-place-request')
          ?.getAttribute('place'),
      ).toBe('ChIJsecond');

      // Exactly one billable creation per attempt — the recovery must not
      // double-bill the card it just rebuilt.
      expect(billableEventCountForSurface('result-card')).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('no clipping of a loaded Google child', () => {
  test('the ready container imposes no fixed height and no overflow clipping', async () => {
    const host = await mountWidget();
    // Simulate Google finishing its load.
    host.querySelector('gmp-place-details-compact')?.dispatchEvent(
      new Event('gmp-load'),
    );
    await waitFor(() => expect(host.getAttribute('data-status')).toBe('ready'));
    expect(host.className).not.toMatch(/overflow-hidden/);
    expect(host.className).not.toMatch(/aspect-\[/);
    expect(host.className).not.toMatch(/\bh-\d/);
    // min-height is a RESERVATION, not a cap — it must not survive as a
    // fixed height once real content is in.
    expect(host.className).not.toMatch(/max-h-/);
  });

  test('while pending the container reserves the 16/9 strip and still never clips', async () => {
    const host = await mountWidget();
    expect(host.getAttribute('data-status')).toBe('pending');
    // The reservation must be the SAME ratio the fallback renders, so a
    // widget that never arrives changes nothing about the card's height
    // (g-65ba768e criterion 4). The old `min-h-[146px]` matched the
    // fallback at exactly one card width and jumped at every other.
    expect(host.className).toMatch(/aspect-\[16\/9\]/);
    expect(host.className).not.toMatch(/overflow-hidden/);
    // An aspect ratio sets height from width; it must never also CAP it,
    // or a tall ready widget would be clipped again.
    expect(host.className).not.toMatch(/max-h-/);
  });
});
