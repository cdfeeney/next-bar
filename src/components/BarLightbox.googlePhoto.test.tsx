import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Bar } from '@/types';

vi.mock('@/lib/mediaPolicy', () => ({
  // A spy, not a bare stub: BarLightbox calls this DURING render with the bar
  // it is about to paint, which is the only place a one-frame mis-attribution
  // is observable. `rerender` flushes effects inside act(), so a post-swap DOM
  // assertion cannot see it (measured: such a test passes against the bug).
  resolveMedia: vi.fn(() => ({ source: 'google-live', placeId: 'ChIJbar54' })),
}));

vi.mock('@/lib/barReviews', () => ({
  fetchBarDetails: vi.fn(async () => null),
}));

vi.mock('@/components/GooglePlacePhotoLazy', () => ({
  default: ({ placeId, surface }: { placeId: string; surface: string }) => (
    <div data-testid="live-google-photo" data-place-id={placeId} data-surface={surface} />
  ),
}));

import { fetchBarDetails } from '@/lib/barReviews';
import { resolveMedia } from '@/lib/mediaPolicy';
import BarLightbox from './BarLightbox';

const BAR: Bar = {
  id: 'bar-54',
  name: 'Bar 54',
  neighborhood: 'Midtown',
  address: '135 W 45th St, New York, NY',
  lat: 40.7575,
  lng: -73.9842,
  priceTier: 4,
  tags: ['rooftop', 'cocktail'],
  blurb: 'A rooftop bar.',
  lastVerified: '2026-08-13',
  googlePlaceId: 'ChIJbar54',
};

/**
 * V8-1a: BarLightbox is the ONE shared bar-detail surface — Map, Rankings and
 * Social all mount it. A prop gap found after those lanes start blocks three at
 * once, so pin the contract here: two props, and a lean catalog `Bar` (no
 * hours, no reviews, no photo fields — all optional in the type) is enough to
 * render the whole panel. This fails if someone adds a required prop or makes
 * the panel depend on detail a caller would have to pre-fetch.
 */
describe('BarLightbox shared contract', () => {
  test('an external caller mounts it with only a lean catalog bar', () => {
    render(<BarLightbox bar={BAR} onClose={() => {}} />);

    const dialog = screen.getByRole('dialog', { name: 'Bar 54 details' });
    expect(dialog).toBeTruthy();
    // Identity, the venue tags and the action pair all come from `bar` alone.
    expect(screen.getByRole('heading', { name: 'Bar 54' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Bar 54 tags' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View on Maps' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  /**
   * Round-1 review (Codex, corroborated): the swap-safety promise in
   * BarLightboxProps was broken. `displayBar` merged fetched details during
   * RENDER while the reset ran in a passive effect, so the first render after a
   * `bar` swap painted the previous bar's address, blurb and place id under the
   * new bar's name — and handed them to resolveMedia, which is what decides
   * which Google place the photo widget requests.
   *
   * Assert on resolveMedia's render-time argument, not on the DOM: `rerender`
   * flushes effects inside act(), so by the time the DOM can be queried the
   * effect has already corrected it. A DOM-only version of this test passes
   * against the bug.
   */
  test('swapping bar while mounted never renders the prior bar details', async () => {
    vi.mocked(fetchBarDetails).mockResolvedValueOnce({
      address: '1 PREVIOUS BAR PLAZA',
      blurb: 'The previous bar.',
    });

    const { rerender } = render(<BarLightbox bar={BAR} onClose={() => {}} />);
    expect(await screen.findByText('1 PREVIOUS BAR PLAZA')).toBeTruthy();

    const OTHER: Bar = { ...BAR, id: 'bar-99', name: 'Bar 99', address: '99 Own St' };
    vi.mocked(resolveMedia).mockClear();
    rerender(<BarLightbox bar={OTHER} onClose={() => {}} />);

    const leaked = vi
      .mocked(resolveMedia)
      .mock.calls.filter(([shown]) => (shown as Bar).id === 'bar-99')
      .filter(([shown]) => (shown as Bar).address === '1 PREVIOUS BAR PLAZA');
    expect(leaked).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Bar 99' })).toBeTruthy();
  });
});

describe('BarLightbox Google media', () => {
  test('uses the live Google widget on the lightbox surface', () => {
    render(<BarLightbox bar={BAR} onClose={() => {}} />);
    const photo = screen.getByTestId('live-google-photo');
    expect(photo.getAttribute('data-place-id')).toBe('ChIJbar54');
    expect(photo.getAttribute('data-surface')).toBe('bar-lightbox');
  });
});
