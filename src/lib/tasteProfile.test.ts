import { describe, it, expect } from 'vitest';
import { deriveTasteProfile } from '@/lib/tasteProfile';
import type { Bar } from '@/types';
import type { BarRating } from '@/types/ratings';

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

const rating = (barId: string, tier: BarRating['rating']): BarRating => ({
  barId,
  rating: tier,
  ratedAt: '2026-07-01T00:00:00Z',
});

describe('deriveTasteProfile', () => {
  it('returns an empty profile when there are no ratings', () => {
    const profile = deriveTasteProfile([], [makeBar({ id: 'a' })]);
    expect(profile.ratedCount).toBe(0);
    expect(profile.topTags).toEqual([]);
    expect(profile.neighborhoods).toEqual([]);
    expect(profile.archetype).toBeNull();
  });

  it('weights Loved (2x) over Liked (1x) and excludes Pass from taste', () => {
    const bars = [
      makeBar({ id: 'dive-bar', tags: ['dive', 'locals'] }),
      makeBar({ id: 'cocktail-bar', tags: ['cocktail', 'polished'] }),
      makeBar({ id: 'passed-bar', tags: ['rooftop', 'trendy'] }),
    ];
    const profile = deriveTasteProfile(
      [
        rating('dive-bar', 'loved'),
        rating('cocktail-bar', 'liked'),
        rating('passed-bar', 'pass'),
      ],
      bars,
    );

    const tagNames = profile.topTags.map((t) => t.tag);
    // Loved tags outrank Liked tags.
    expect(tagNames.indexOf('dive')).toBeLessThan(tagNames.indexOf('cocktail'));
    // Pass-rated tags never appear.
    expect(tagNames).not.toContain('rooftop');
    expect(tagNames).not.toContain('trendy');
    // Weights: loved=2, liked=1.
    expect(profile.topTags.find((t) => t.tag === 'dive')?.weight).toBe(2);
    expect(profile.topTags.find((t) => t.tag === 'cocktail')?.weight).toBe(1);
  });

  it('caps topTags at 5, ties broken alphabetically for determinism', () => {
    const bars = [
      makeBar({
        id: 'many-tags',
        tags: ['dive', 'cocktail', 'wine', 'beer', 'jazz', 'chill', 'locals'],
      }),
    ];
    const profile = deriveTasteProfile([rating('many-tags', 'loved')], bars);
    expect(profile.topTags).toHaveLength(5);
    const tags = profile.topTags.map((t) => t.tag);
    // All weight 2 → alphabetical prefix of the 7 tags.
    expect(tags).toEqual(['beer', 'chill', 'cocktail', 'dive', 'jazz']);
  });

  it('counts neighborhoods from Loved+Liked only, sorted by count desc', () => {
    const bars = [
      makeBar({ id: 'a', neighborhood: 'LES' }),
      makeBar({ id: 'b', neighborhood: 'LES' }),
      makeBar({ id: 'c', neighborhood: 'Williamsburg' }),
      makeBar({ id: 'd', neighborhood: 'Midtown' }),
    ];
    const profile = deriveTasteProfile(
      [
        rating('a', 'loved'),
        rating('b', 'liked'),
        rating('c', 'loved'),
        rating('d', 'pass'),
      ],
      bars,
    );
    expect(profile.neighborhoods[0]).toEqual({ neighborhood: 'LES', count: 2 });
    expect(profile.neighborhoods).toHaveLength(2); // Midtown (pass) excluded
  });

  it('ignores ratings whose bar is not in the catalog', () => {
    const profile = deriveTasteProfile(
      [rating('ghost-bar', 'loved')],
      [makeBar({ id: 'real-bar', tags: ['dive'] })],
    );
    expect(profile.topTags).toEqual([]);
    // ratedCount reflects all ratings the user made, even off-catalog ones.
    expect(profile.ratedCount).toBe(1);
  });

  it('derives an archetype from the weighted top tags', () => {
    const bars = [
      makeBar({ id: 'a', tags: ['dive', 'locals'] }),
      makeBar({ id: 'b', tags: ['dive', 'locals'] }),
    ];
    const profile = deriveTasteProfile(
      [rating('a', 'loved'), rating('b', 'loved')],
      bars,
    );
    expect(profile.archetype).toBe('Dive devotee');
  });
});
