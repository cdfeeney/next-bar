import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BarPicker from './BarPicker';

/**
 * Ratings-storm regression (measured 2026-09-03): every picker row rendered a
 * RatingBadge that mounted its own useRatings, and each mount runs a full
 * server hydration — 2,107 production bars meant ~2,107 duplicate fetches per
 * picker open, ending in net::ERR_INSUFFICIENT_RESOURCES. The picker now reads
 * useRatings ONCE and hands each row its rating. This pins that shape: many
 * rows, one hook mount.
 */

const { MANY_BARS, useRatingsMock } = vi.hoisted(() => {
  const bars = Array.from({ length: 200 }, (_, i) => ({
    id: `bar-${i}`,
    name: `Bar ${i}`,
    neighborhood: 'Midtown',
    address: `${i} W 40th St`,
    lat: 0,
    lng: 0,
    priceTier: 1,
    tags: [],
    blurb: '',
    lastVerified: '2026-01-01',
  }));
  return {
    MANY_BARS: bars,
    useRatingsMock: vi.fn(() => ({
      getRating: (barId: string) => (barId === 'bar-1' ? 'loved' : null),
    })),
  };
});

vi.mock('@/hooks/useRatings', () => ({
  useRatings: () => useRatingsMock(),
}));
vi.mock('@/lib/useBars', () => ({
  useBars: () => MANY_BARS,
}));
vi.mock('@/components/BarVisualTile', () => ({
  default: () => null,
}));

describe('BarPicker ratings hydration', () => {
  it('renders many rows from a single useRatings mount', () => {
    render(<BarPicker onPick={() => undefined} />);

    // All 200 rows actually rendered — the single hook is feeding every row,
    // not a truncated list.
    expect(screen.getByText('Bar 199')).toBeTruthy();
    // The rated row still shows its badge through the passed-down rating.
    expect(screen.getByText('Loved')).toBeTruthy();
    // ONE hydration source for the whole list. Per-row mounts would put this
    // at 200; a stray extra render pass would be 2, still a fail we want to
    // hear about.
    expect(useRatingsMock).toHaveBeenCalledTimes(1);
  });
});
