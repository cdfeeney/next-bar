import { describe, it, expect } from 'vitest';
import { deriveBadges, weekendStreak } from '@/lib/badges';
import type { Bar } from '@/types';
import type { BarRating } from '@/types/ratings';

const NOW = new Date('2026-07-20T12:00:00Z'); // a Monday

/**
 * S1: the three-neighborhood badge was called "Hood Hopper" with id
 * `hood-hopper`. That name is racially loaded and must not come back — via a
 * revert, a copy-paste from an older branch, or a new badge reusing the id.
 * Asserting on the SHIPPED badge list is what makes the rename stick; a test
 * that only checks the new name would still pass if the old one reappeared
 * alongside it.
 */
const FORBIDDEN_BADGE_TEXT = /hood[\s-]?hopper/i;

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
    const crawler = badges.find((b) => b.id === 'borough-crawler');
    expect(crawler?.earned).toBe(true);
    expect(crawler?.progress).toEqual({ current: 3, target: 3 });
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
    expect(badges.find((b) => b.id === 'borough-crawler')?.progress.current).toBe(0);
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

describe('S1 — the retired badge name cannot come back', () => {
  it('no shipped badge uses the "Hood Hopper" label or id', () => {
    // Derived from the real badge list, not a grep, so it also catches the old
    // name reappearing on a DIFFERENT badge.
    const { badges } = deriveBadges([rating('a')], [makeBar({ id: 'a' })], NOW);
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) {
      expect(b.id).not.toMatch(FORBIDDEN_BADGE_TEXT);
      expect(b.label).not.toMatch(FORBIDDEN_BADGE_TEXT);
      expect(b.description).not.toMatch(FORBIDDEN_BADGE_TEXT);
    }
  });

  it('the three-neighborhood badge is Borough Crawler and keeps its threshold', () => {
    const bars = [
      makeBar({ id: 'a', neighborhood: 'LES' }),
      makeBar({ id: 'b', neighborhood: 'Midtown' }),
    ];
    const { badges } = deriveBadges([rating('a'), rating('b')], bars, NOW);
    const crawler = badges.find((b) => b.id === 'borough-crawler');
    expect(crawler?.label).toBe('Borough Crawler');
    // Threshold and progress behavior are unchanged by the rename: 2 of 3.
    expect(crawler?.progress).toEqual({ current: 2, target: 3 });
    expect(crawler?.earned).toBe(false);
  });
});
