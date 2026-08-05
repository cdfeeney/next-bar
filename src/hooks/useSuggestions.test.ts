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

describe('computeSuggestions — signalBars parity (santa: Codex r2)', () => {
  it('a filtered ranking pool must NOT change the taste model: signals derive from signalBars', () => {
    // History: THREE Loved bars — two scream 'cocktail', one is a
    // garden/wine outlier. Full-catalog weights: cocktail 2/3,
    // garden 1/3, wine 1/3.
    const lovedA = makeBar({ id: 'loved-a', tags: ['cocktail'] });
    const lovedB = makeBar({ id: 'loved-b', tags: ['cocktail'] });
    const lovedC = makeBar({ id: 'loved-c', tags: ['garden', 'wine'] });
    // Two candidates with EQUAL profile overlap ('dive'); only the
    // affinity term separates them.
    const candCocktail = makeBar({ id: 'cand-cocktail', tags: ['dive', 'cocktail'] });
    const candGarden = makeBar({ id: 'cand-garden', tags: ['dive', 'garden'] });
    const fullCatalog = [lovedA, lovedB, lovedC, candCocktail, candGarden];
    // The map filter hides BOTH cocktail Loved bars from the ranking
    // pool — the user's dominant taste must survive the filter.
    const filteredPool = [lovedC, candCocktail, candGarden];
    const ratings = [
      makeRating('loved-a', 'loved'),
      makeRating('loved-b', 'loved'),
      makeRating('loved-c', 'loved'),
    ];

    const withSignalBars = computeSuggestions({
      profile: profile(['dive']),
      coords: null,
      bars: filteredPool,
      signalBars: fullCatalog,
      ratings,
      now: NOW,
    }).map((b) => b.id);
    // Full-catalog weights keep 'cocktail' dominant (coverage 0.5 vs
    // 0.25): the cocktail candidate outranks the garden one.
    expect(withSignalBars.indexOf('cand-cocktail')).toBeLessThan(
      withSignalBars.indexOf('cand-garden'),
    );
    // Hidden Loved bars are still NOT ranked (not in the pool).
    expect(withSignalBars).not.toContain('loved-a');

    // DISCRIMINATING control: deriving signals from the filtered pool
    // sees ONE visible Loved bar (< caution floor) → flat-union
    // fallback {garden, wine} → the ORDER FLIPS. This proves the
    // signalBars wiring is load-bearing, not decorative.
    const withoutSignalBars = computeSuggestions({
      profile: profile(['dive']),
      coords: null,
      bars: filteredPool,
      ratings,
      now: NOW,
    }).map((b) => b.id);
    expect(withoutSignalBars.indexOf('cand-garden')).toBeLessThan(
      withoutSignalBars.indexOf('cand-cocktail'),
    );
  });
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
