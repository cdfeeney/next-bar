import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Bar } from '@/types';

vi.mock('@/lib/mediaPolicy', () => ({
  resolveMedia: () => ({ source: 'google-live', placeId: 'ChIJbar54' }),
}));

vi.mock('@/lib/barReviews', () => ({
  fetchBarDetails: vi.fn(async () => null),
}));

vi.mock('@/components/GooglePlacePhotoLazy', () => ({
  default: ({ placeId, surface }: { placeId: string; surface: string }) => (
    <div data-testid="live-google-photo" data-place-id={placeId} data-surface={surface} />
  ),
}));

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

describe('BarLightbox Google media', () => {
  test('uses the live Google widget on the lightbox surface', () => {
    render(<BarLightbox bar={BAR} onClose={() => {}} />);
    const photo = screen.getByTestId('live-google-photo');
    expect(photo.getAttribute('data-place-id')).toBe('ChIJbar54');
    expect(photo.getAttribute('data-surface')).toBe('bar-lightbox');
  });
});
