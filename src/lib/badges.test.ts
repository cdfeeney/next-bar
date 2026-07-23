import { describe, it, expect } from 'vitest';
import { deriveBadges, weekendStreak } from '@/lib/badges';
import type { Bar } from '@/types';
import type { BarRating } from '@/types/ratings';

const NOW = new Date('2026-07-20T12:00:00Z'); // a Monday

const makeBar = (overrides: Partial<Bar>): Bar => ({
  id: 'bar-x',
  name: 'X',
  neighborhood: 'East Village',
  address: '1 Main St',
  lat: 40.7264,
  lng: -73.9818,
  priceTier: 2,
  tags: [],
  blurb: 'A bar.',
  lastVerified: '2026-04-01',
  ...overrides,
});

const rating = (
  barId: string,
  tier: BarRating['rating'] = 'liked',
  ratedAt = '2026-07-01T00:00:00Z',
): BarRating => ({ barId, rating: tier, ratedAt });

describe('deriveBadges', () => {
  it('earns nothing with zero ratings, and every badge reports progress', () => {
    const { badges, explorerScore } = deriveBadges([], [], NOW);
    expect(badges.every((b) => !b.earned)).toBe(true);
    expect(badges.every((b) => b.progress.current === 0)).toBe(true);
    expect(explorerScore).toBe(0);
  });

  it('earns first-night on the first rating of any tier (pass counts as a visit)', () => {
    const bars = [makeBar({ id: 'a' })];
    const { badges } = deriveBadges([rating('a', 'pass')], bars, NOW);
    expect(badges.find((b) => b.id === 'first-night')?.earned).toBe(true);
  });

  it('earns neighborhood badges from distinct neighborhoods visited', () => {
    const bars = [
      makeBar({ id: 'a', neighborhood: 'LES' }),
      makeBar({ id: 'b', neighborhood: 'Midtown' }),
      makeBar({ id: 'c', neighborhood: 'Williamsburg' }),
    ];
    const ratings = [rating('a'), rating('b'), rating('c')];
    const { badges } = deriveBadges(ratings, bars, NOW);
    const hopper = badges.find((b) => b.id === 'hood-hopper');
    expect(hopper?.earned).toBe(true);
    expect(hopper?.progress).toEqual({ current: 3, target: 3 });
    expect(badges.find((b) => b.id === 'city-wide')?.earned).toBe(false);
  });

  it('earns variety badges from tag counts (5 speakeasies)', () => {
    const bars = Array.from({ length: 5 }, (_, i) =>
      makeBar({ id: `s${i}`, tags: ['speakeasy'] }),
    );
    const { badges } = deriveBadges(bars.map((b) => rating(b.id)), bars, NOW);
    expect(badges.find((b) => b.id === 'hidden-doors')?.earned).toBe(true);
  });

  it('ignores off-catalog ratings for tag/neighborhood badges but counts them as visits', () => {
    const { badges } = deriveBadges([rating('ghost')], [], NOW);
    expect(badges.find((b) => b.id === 'first-night')?.earned).toBe(true);
    expect(badges.find((b) => b.id === 'hood-hopper')?.progress.current).toBe(0);
  });

  it('explorer score = visits + 3 per distinct neighborhood', () => {
    const bars = [
      makeBar({ id: 'a', neighborhood: 'LES' }),
      makeBar({ id: 'b', neighborhood: 'Midtown' }),
    ];
    const { explorerScore } = deriveBadges([rating('a'), rating('b')], bars, NOW);
    expect(explorerScore).toBe(2 + 3 * 2);
  });
});

describe('weekendStreak', () => {
  it('is 0 with no weekend ratings', () => {
    // 2026-07-01 is a Wednesday.
    expect(weekendStreak([rating('a', 'liked', '2026-07-01T00:00:00Z')], NOW)).toBe(0);
  });

  it('counts consecutive weekends ending at the most recent weekend', () => {
    // Fridays/Saturdays: Jul 17-18 (weekend before NOW=Mon Jul 20), Jul 11, Jul 4.
    const ratings = [
      rating('a', 'liked', '2026-07-18T02:00:00Z'), // Sat
      rating('b', 'liked', '2026-07-11T02:00:00Z'), // Sat
      rating('c', 'liked', '2026-07-04T02:00:00Z'), // Sat
    ];
    expect(weekendStreak(ratings, NOW)).toBe(3);
  });

  it('breaks the streak on a skipped weekend', () => {
    const ratings = [
      rating('a', 'liked', '2026-07-18T02:00:00Z'), // Sat (last weekend)
      rating('b', 'liked', '2026-07-04T02:00:00Z'), // Sat (two weekends back)
    ];
    expect(weekendStreak(ratings, NOW)).toBe(1);
  });

  it('streak is stale (0) when the most recent weekend rated is over a week ago', () => {
    const ratings = [rating('a', 'liked', '2026-07-04T02:00:00Z')];
    expect(weekendStreak(ratings, NOW)).toBe(0);
  });
});
