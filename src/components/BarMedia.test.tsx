import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Bar } from '@/types';
import BarMedia from '@/components/BarMedia';
import type { MediaFlags, OwnedPhoto } from '@/lib/mediaPolicy';

/**
 * Criterion 4: Google attribution must be VISIBLE wherever Places-derived
 * imagery is shown. A screen-reader-only label is not attribution — it is
 * the absence of attribution for every sighted user, which is the whole
 * exposure section B exists to close.
 *
 * jsdom applies no Tailwind, so `toBeVisible()` cannot detect `sr-only`.
 * These tests assert on the class instead: the attribution element must not
 * carry it.
 */

const bar = (overrides: Partial<Bar> = {}): Bar =>
  ({
    id: 'attaboy',
    name: 'Attaboy',
    neighborhood: 'LES',
    address: '134 Eldridge St',
    lat: 40.72,
    lng: -73.99,
    tags: ['dive'],
    priceTier: 2,
    blurb: 'test',
    lastVerified: '2026-04-01',
    ...overrides,
  }) as Bar;

const LEGACY_CACHE_ON: MediaFlags = { googleLive: false, legacyCache: true };
const ALL_GOOGLE_OFF: MediaFlags = { googleLive: false, legacyCache: false };

/** A cached Google photo file — the 3,435 legacy files still on disk. */
const withLegacyPhoto = bar({ photoRef: 'places/x/photos/a', photoCount: 2 });

describe('BarMedia Google attribution (criterion 4)', () => {
  test('renders VISIBLE attribution for a legacy cached Google photo', () => {
    render(<BarMedia bar={withLegacyPhoto} flags={LEGACY_CACHE_ON} />);
    const attribution = screen.getByTestId('google-attribution');
    expect(attribution.className).not.toMatch(/sr-only/);
    expect(attribution.textContent ?? '').toMatch(/google/i);
  });

  test('links the photo to its Google Maps place entry when we have a place id', () => {
    render(
      <BarMedia
        bar={bar({ photoRef: 'places/x/photos/a', photoCount: 1, googlePlaceId: 'abc123' })}
        flags={LEGACY_CACHE_ON}
      />,
    );
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toContain('place_id:abc123');
  });

  test('renders NO attribution when it falls through to the glyph', () => {
    render(<BarMedia bar={withLegacyPhoto} flags={ALL_GOOGLE_OFF} />);
    expect(screen.getByTestId('bar-media-glyph')).toBeTruthy();
    expect(screen.queryByTestId('google-attribution')).toBeNull();
  });

  test('renders NO attribution for a photo we own outright', () => {
    const owned: OwnedPhoto[] = [
      { url: '/media/nextbar-0.webp', source: 'nextbar', isPrimary: true },
    ];
    render(<BarMedia bar={withLegacyPhoto} owned={owned} flags={LEGACY_CACHE_ON} />);
    expect(screen.queryByTestId('google-attribution')).toBeNull();
  });
});
