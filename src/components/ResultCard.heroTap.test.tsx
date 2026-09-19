import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Bar } from '@/types';

/**
 * T-01a2: on a google-live card the photo is Google's own widget, which cannot
 * sit inside a button, so a transparent tap target covers the photo region.
 * The owner's "Photos and hours does nothing" was a tap on the photo — the only
 * opener used to be the small text link below it.
 */
vi.mock('@/lib/mediaPolicy', () => ({
  resolveMedia: () => ({ source: 'google-live', placeId: 'ChIJtap' }),
}));
vi.mock('@/components/GooglePlacePhotoLazy', () => ({
  default: ({ fallback }: { fallback: React.ReactNode }) => <div data-testid="widget-stub">{fallback}</div>,
}));
vi.mock('@/components/BarLightbox', () => ({
  default: ({ bar }: { bar: Bar }) => <div role="dialog" aria-label={`${bar.name} details`} />,
}));
vi.mock('@/components/RatingBadge', () => ({ default: () => null }));
vi.mock('@/components/OpenNowBadge', () => ({ default: () => null }));

import ResultCard from './ResultCard';

const BAR: Bar = {
  id: 'bar-tap', name: 'Tap Bar', neighborhood: 'Chelsea', address: '1 W 20th St',
  lat: 40.74, lng: -73.99, priceTier: 2, tags: ['pub'], blurb: '', lastVerified: '2026-09-19',
  googlePlaceId: 'ChIJtap',
};

describe('ResultCard google-live hero tap (T-01a2)', () => {
  test('tapping the photo region opens the lightbox and keeps focus on the control', () => {
    render(<ResultCard bar={BAR} rank={1} miles={0.4} selectedVibes={[]} />);
    const tap = screen.getByTestId('hero-photo-tap');
    expect(tap).toHaveAttribute('aria-label', 'See photos and hours for Tap Bar');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(tap);
    expect(screen.getByRole('dialog', { name: 'Tap Bar details' })).toBeTruthy();
    expect(document.activeElement).toBe(tap);
  });

  test('the text link still opens it too', () => {
    render(<ResultCard bar={BAR} rank={2} miles={0.4} selectedVibes={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Photos & hours/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
