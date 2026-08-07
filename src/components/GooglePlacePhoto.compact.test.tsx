// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
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
import { __resetRequested, billableEventCountForSurface } from '@/lib/placesUiKit';

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

  test('while pending the container reserves height but still never clips', async () => {
    const host = await mountWidget();
    expect(host.getAttribute('data-status')).toBe('pending');
    expect(host.className).toMatch(/min-h-/); // stable first paint
    expect(host.className).not.toMatch(/overflow-hidden/);
    expect(host.className).not.toMatch(/aspect-\[/);
  });
});
