// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * The widget must be built as the COMPACT element and must never be clipped.
 *
 * Live measurement at 390x844 (Staging, 2026-08-06) found the full
 * <gmp-place-details> laying out at 340x365 inside a 145.7px
 * `aspect-[21/9] overflow-hidden` host: Google's media AND its required
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
 * Giving up must be FINAL.
 *
 * Once the widget budget expires the fallback renders and the host div is
 * unmounted. Google's element is still alive inside the `gmp-load` listener
 * closure, so a slow place/photo fetch completing afterwards used to fire
 * into a listener that only checked `cancelled` (set by effect cleanup) —
 * flipping status back to 'ready' and re-rendering an EMPTY host: no
 * children, no height. On a google-live card our name and Maps link are
 * suppressed outside the fallback, so that is a nameless card with no Maps
 * action — replacing a perfectly good fallback. (santa: Claude/FABLE H-1.)
 */
describe('a late widget must not un-do the fallback', () => {
  test('a gmp-load arriving after the timeout leaves the fallback in place', async () => {
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

      // Burn the whole widget budget and deliver Google's late answer INSIDE
      // THE SAME act() — i.e. before React has flushed the unmount that the
      // timeout's setStatus('unavailable') causes.
      //
      // The ordering is the whole point of this test (santa: Codex). If
      // `gmp-load` is instead dispatched after an awaited flush, the host has
      // already unmounted, `hostEl` has gone null, the effect has re-run and
      // its cleanup has set `cancelled` — so the listener returns on
      // `cancelled` alone and the test passes with or without the `gaveUp`
      // latch. That version was coverage theatre: verified 2026-08-08 by
      // deleting `|| gaveUp` from the listener and watching it still pass.
      // Batched into one act(), `cancelled` is still false and `gaveUp` is
      // the ONLY guard standing between a late widget and a resurrected,
      // empty host.
      act(() => {
        vi.advanceTimersByTime(WIDGET_LOAD_TIMEOUT_MS + 1_000);
        compact.dispatchEvent(new Event('gmp-load'));
      });

      // The fallback STANDS. Without the latch, the listener's
      // setStatus('ready') lands after the timeout's setStatus('unavailable')
      // and wins, re-rendering a host with no children and no height.
      expect(screen.getByTestId('glyph-fallback')).toBeTruthy();
      expect(screen.queryByTestId('google-place-photo')).toBeNull();

      // And it still stands once everything else settles.
      await vi.advanceTimersByTimeAsync(50);
      expect(screen.getByTestId('glyph-fallback')).toBeTruthy();
      expect(screen.queryByTestId('google-place-photo')).toBeNull();
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

      // Let the first attempt give up so the fallback replaces the host.
      await vi.advanceTimersByTimeAsync(WIDGET_LOAD_TIMEOUT_MS + 1_000);
      expect(screen.getByTestId('glyph-fallback')).toBeTruthy();
      expect(screen.queryByTestId('google-place-photo')).toBeNull();

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

  test('while pending the container reserves the 21/9 strip and still never clips', async () => {
    const host = await mountWidget();
    expect(host.getAttribute('data-status')).toBe('pending');
    // The reservation must be the SAME ratio the fallback renders, so a
    // widget that never arrives changes nothing about the card's height
    // (g-65ba768e criterion 4). The old `min-h-[146px]` matched the
    // fallback at exactly one card width and jumped at every other.
    expect(host.className).toMatch(/aspect-\[21\/9\]/);
    expect(host.className).not.toMatch(/overflow-hidden/);
    // An aspect ratio sets height from width; it must never also CAP it,
    // or a tall ready widget would be clipped again.
    expect(host.className).not.toMatch(/max-h-/);
  });
});
