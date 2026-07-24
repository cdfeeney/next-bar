import { describe, it, expect } from 'vitest';
import {
  computeSuggestions,
  MAP_SUGGESTION_COUNT,
} from '@/hooks/useSuggestions';
import type { Bar, VibeProfile, VibeTag } from '@/types';
import type { BarRating } from '@/types/ratings';

// Fixed "now" so the lastVerified staleness filter is deterministic.
const NOW = new Date('2026-05-15T12:00:00Z');
const FRESH = '2026-04-01';

const makeBar = (overrides: Partial<Bar>): Bar => ({
  id: 'bar-x',
  name: 'X',
  neighborhood: 'Midtown',
  address: '1 Main St',
  lat: 40.755,
  lng: -73.984,
  priceTier: 2,
  tags: [],
  blurb: 'A bar.',
  lastVerified: FRESH,
  ...overrides,
});

const makeRating = (
  barId: string,
  rating: BarRating['rating'],
): BarRating => ({
  barId,
  rating,
  ratedAt: '2026-05-01T00:00:00Z',
});

const profile = (
  tags: VibeTag[],
  preferredNeighborhoods: VibeProfile['preferredNeighborhoods'] = [],
): VibeProfile => ({
  tags,
  archetype: 'test-archetype',
  preferredNeighborhoods,
});

describe('computeSuggestions — pure map-suggestion pipeline (B6)', () => {
  it('excludes pass-rated bars from suggestions', () => {
    const bars = [
      makeBar({ id: 'a', tags: ['dive', 'cheap'] }),
      makeBar({ id: 'b', tags: ['dive', 'cheap'] }),
    ];
    const result = computeSuggestions({
      profile: profile(['dive', 'cheap']),
      coords: null,
      bars,
      ratings: [makeRating('a', 'pass')],
      now: NOW,
    });
    expect(result.map((b) => b.id)).not.toContain('a');
    expect(result.map((b) => b.id)).toContain('b');
  });

  it('keeps loved/liked bars in the pool (only pass excludes)', () => {
    const bars = [
      makeBar({ id: 'a', tags: ['dive'] }),
      makeBar({ id: 'b', tags: ['dive'] }),
    ];
    const result = computeSuggestions({
      profile: profile(['dive']),
      coords: null,
      bars,
      ratings: [makeRating('a', 'loved'), makeRating('b', 'liked')],
      now: NOW,
    });
    expect(result.map((b) => b.id).sort()).toEqual(['a', 'b']);
  });

  it('flattens Loved bars’ tags into the loved-affinity term', () => {
    // User profile matches both candidates equally; only the loved-affinity
    // term (jazz from the loved bar) separates them.
    const bars = [
      makeBar({ id: 'loved-seed', tags: ['jazz'] }),
      makeBar({ id: 'jazzy', tags: ['dive', 'jazz'] }),
      makeBar({ id: 'plain', tags: ['dive', 'rooftop'] }),
    ];
    const withLoved = computeSuggestions({
      profile: profile(['dive']),
      coords: null,
      bars,
      ratings: [makeRating('loved-seed', 'loved')],
      now: NOW,
    });
    const jazzyIdx = withLoved.findIndex((b) => b.id === 'jazzy');
    const plainIdx = withLoved.findIndex((b) => b.id === 'plain');
    expect(jazzyIdx).toBeGreaterThanOrEqual(0);
    expect(plainIdx).toBeGreaterThanOrEqual(0);
    expect(jazzyIdx).toBeLessThan(plainIdx);
  });

  it('honors the profile’s preferred neighborhoods', () => {
    const bars = [
      makeBar({ id: 'les', neighborhood: 'LES', tags: ['dive'] }),
      makeBar({ id: 'mid', neighborhood: 'Midtown', tags: ['dive'] }),
    ];
    const result = computeSuggestions({
      profile: profile(['dive'], ['LES']),
      coords: null,
      bars,
      ratings: [],
      now: NOW,
    });
    expect(result.map((b) => b.id)).toEqual(['les']);
  });

  it('caps results at MAP_SUGGESTION_COUNT by default', () => {
    const bars = Array.from({ length: 30 }, (_, i) =>
      makeBar({ id: `bar-${i}`, tags: ['dive'] }),
    );
    const result = computeSuggestions({
      profile: profile(['dive']),
      coords: null,
      bars,
      ratings: [],
      now: NOW,
    });
    expect(result.length).toBe(MAP_SUGGESTION_COUNT);
  });

  it('respects an explicit maxResults', () => {
    const bars = Array.from({ length: 30 }, (_, i) =>
      makeBar({ id: `bar-${i}`, tags: ['dive'] }),
    );
    const result = computeSuggestions({
      profile: profile(['dive']),
      coords: null,
      bars,
      ratings: [],
      maxResults: 4,
      now: NOW,
    });
    expect(result.length).toBe(4);
  });

  it('still ranks with an empty-tag profile (distance/pool fallback)', () => {
    const bars = [
      makeBar({ id: 'a', tags: ['dive'] }),
      makeBar({ id: 'b', tags: ['cocktail'] }),
    ];
    const result = computeSuggestions({
      profile: profile([]),
      coords: { lat: 40.755, lng: -73.984 },
      bars,
      ratings: [],
      now: NOW,
    });
    expect(result.length).toBe(2);
  });

  it('ignores loved ratings pointing at ids not in the catalog', () => {
    const bars = [makeBar({ id: 'a', tags: ['dive'] })];
    const result = computeSuggestions({
      profile: profile(['dive']),
      coords: null,
      bars,
      ratings: [makeRating('ghost-bar', 'loved')],
      now: NOW,
    });
    expect(result.map((b) => b.id)).toEqual(['a']);
  });
});
