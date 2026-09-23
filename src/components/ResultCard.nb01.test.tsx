import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Bar } from '@/types';

/**
 * NB-01 (owner-approved mock v3, 2026-09-23): the card is a 16/9 photo hero,
 * ONE meta line (open status · walk time) and ONE action ("Photos & hours").
 * The drive line and the Maps/directions links live in the lightbox now.
 */
vi.mock('@/lib/mediaPolicy', () => ({
  resolveMedia: () => ({ source: 'local', urls: ['/bar-photos/one.jpg'] }),
}));
vi.mock('@/components/BarLightbox', () => ({
  default: ({ bar }: { bar: Bar }) => <div role="dialog" aria-label={`${bar.name} details`} />,
}));
vi.mock('@/components/RatingBadge', () => ({ default: () => null }));
vi.mock('@/components/OpenNowBadge', () => ({ default: () => <span>Open · until 11 PM</span> }));

import ResultCard from './ResultCard';

const BAR: Bar = {
  id: 'bar-nb01', name: 'Card Bar', neighborhood: 'LES', address: '1 Ludlow St',
  lat: 40.72, lng: -73.99, priceTier: 2, tags: ['pub'], blurb: '', lastVerified: '2026-09-19',
};

describe('ResultCard — NB-01 card shape', () => {
  test('hero is 16/9, one meta line, one "Photos & hours" action, no drive line or Maps links', () => {
    render(
      <ResultCard
        bar={BAR}
        rank={1}
        miles={0.3}
        selectedVibes={[]}
        origin={{ lat: 40.72, lng: -73.98 }}
        travel={{ walking: { minutes: 4, miles: 0.2 }, driving: { minutes: 2, miles: 0.2 } } as never}
      />,
    );
    expect(screen.getByTestId('bar-visual').className).toMatch(/aspect-\[16\/9\]/);
    expect(screen.getAllByRole('button', { name: /^Photos & hours$/ })).toHaveLength(1);
    expect(screen.queryByText(/^Drive/)).toBeNull();
    expect(screen.queryByRole('link', { name: /directions/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /Maps →/ })).toBeNull();
    expect(screen.getByText(/Open · until 11 PM/)).toBeTruthy();
  });
});
