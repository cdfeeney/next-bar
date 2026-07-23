import { describe, it, expect } from 'vitest';
import { jaccard, matches, scoreBar, vibeMatchBadge } from '@/lib/matching';
import type { Bar, VibeProfile, VibeTag } from '@/types';

// Fixed "now" used for the 180-day staleness filter.
const NOW = new Date('2026-05-15T12:00:00Z');
const FRESH = '2026-04-01'; // ~44 days old — passes 180-day filter
const STALE = '2025-01-01'; // ~500 days old — fails 365-day filter

const makeBar = (overrides: Partial<Bar>): Bar => ({
  id: 'bar-x',
  name: 'X',
  neighborhood: 'Midtown',
  address: '1 Main St',
  lat: 40.7550,
  lng: -73.9840,
  priceTier: 2,
  tags: [],
  blurb: 'A bar.',
  lastVerified: FRESH,
  ...overrides,
});

const baseProfile = (tags: VibeTag[]): VibeProfile => ({
  tags,
  archetype: 'test-archetype',
  preferredNeighborhoods: [],
});

describe('jaccard', () => {
  it('returns 0 when sets have empty intersection', () => {
    expect(jaccard(['dive', 'beer'], ['cocktail', 'wine'])).toBe(0);
  });

  it('returns 1 for identical sets', () => {
    expect(jaccard(['dive', 'beer'], ['dive', 'beer'])).toBe(1);
  });

  it('is commutative', () => {
    const a: VibeTag[] = ['cocktail', 'speakeasy', 'polished'];
    const b: VibeTag[] = ['cocktail', 'dive', 'cheap'];
    expect(jaccard(a, b)).toBe(jaccard(b, a));
  });

  it('returns 0 when both inputs are empty (no divide-by-zero)', () => {
    expect(jaccard([], [])).toBe(0);
  });
});

describe('vibeMatchBadge', () => {
  it('numerator is the intersection size', () => {
    const { num } = vibeMatchBadge(
      ['cocktail', 'speakeasy', 'polished'],
      ['cocktail', 'speakeasy', 'dive'],
    );
    expect(num).toBe(2);
  });

  it('denominator is min(|user|, |bar|) when user is smaller', () => {
    const { den } = vibeMatchBadge(
      ['cocktail', 'speakeasy'],
      ['cocktail', 'speakeasy', 'polished', 'industry'],
    );
    expect(den).toBe(2);
  });

  it('denominator is min(|user|, |bar|) when bar is smaller', () => {
    const { den } = vibeMatchBadge(
      ['cocktail', 'speakeasy', 'polished', 'industry'],
      ['cocktail'],
    );
    expect(den).toBe(1);
  });

  it('denominator is floored at 1 when both inputs are empty (no divide-by-zero)', () => {
    const { num, den } = vibeMatchBadge([], []);
    expect(num).toBe(0);
    expect(den).toBe(1);
  });
});

describe('matches() — filters', () => {
  const profile = baseProfile(['cocktail', 'speakeasy', 'polished', 'industry']);

  it('excludeIds removes the named bar', () => {
    const barA = makeBar({
      id: 'a',
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    const barB = makeBar({
      id: 'b',
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    const result = matches({
      profile,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [barA, barB],
      excludeIds: ['a'],
      now: NOW,
    });
    expect(result.map((b) => b.id)).toEqual(['b']);
  });

  it('drops bars whose lastVerified is older than the hard-filter window', () => {
    const fresh = makeBar({
      id: 'fresh',
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
      lastVerified: FRESH,
    });
    const stale = makeBar({
      id: 'stale',
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
      lastVerified: STALE,
    });
    const result = matches({
      profile,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [fresh, stale],
      now: NOW,
    });
    const ids = result.map((b) => b.id);
    expect(ids).toContain('fresh');
    expect(ids).not.toContain('stale');
  });

  it('preferredNeighborhoods = [] is a no-op', () => {
    const midtown = makeBar({
      id: 'midtown',
      neighborhood: 'Midtown',
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    const fidi = makeBar({
      id: 'fidi',
      neighborhood: 'FiDi',
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    const result = matches({
      profile,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [midtown, fidi],
      now: NOW,
    });
    const ids = result.map((b) => b.id).sort();
    expect(ids).toEqual(['fidi', 'midtown']);
  });

  it('preferredNeighborhoods = ["Midtown"] filters out non-Midtown bars', () => {
    const midtown = makeBar({
      id: 'midtown',
      neighborhood: 'Midtown',
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    const fidi = makeBar({
      id: 'fidi',
      neighborhood: 'FiDi',
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    const result = matches({
      profile,
      coords: null,
      preferredNeighborhoods: ['Midtown'],
      maxMiles: null,
      bars: [midtown, fidi],
      now: NOW,
    });
    expect(result.map((b) => b.id)).toEqual(['midtown']);
  });

  it('maxMiles with coords filters by radius', () => {
    // Origin = Midtown centroid. Near bar at Midtown, far bar at FiDi (~3.4mi).
    const near = makeBar({
      id: 'near',
      lat: 40.7550,
      lng: -73.9840,
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    const far = makeBar({
      id: 'far',
      lat: 40.7060,
      lng: -74.0090,
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    const result = matches({
      profile,
      coords: { lat: 40.7550, lng: -73.9840 },
      preferredNeighborhoods: [],
      maxMiles: 1,
      bars: [near, far],
      now: NOW,
    });
    expect(result.map((b) => b.id)).toEqual(['near']);
  });

  it('maxMiles set but coords === null is a no-op (no radius filter applied)', () => {
    const near = makeBar({
      id: 'near',
      lat: 40.7550,
      lng: -73.9840,
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    const far = makeBar({
      id: 'far',
      lat: 40.7060,
      lng: -74.0090,
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    const result = matches({
      profile,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: 1,
      bars: [near, far],
      now: NOW,
    });
    const ids = result.map((b) => b.id).sort();
    expect(ids).toEqual(['far', 'near']);
  });
});

describe('matches() — threshold relaxation', () => {
  // User has 4 tags. We build a pool where < 3 bars meet 0.25 jaccard
  // but >= 3 bars meet a relaxed threshold.
  // Tag arithmetic for user = ['cocktail', 'speakeasy', 'polished', 'industry'] (4):
  //   - Full overlap (4 shared, union 4)          → 1.00 (>= 0.25)
  //   - Bar tags = ['cocktail', 'dive'] (2)
  //     intersection 1, union 5                   → 0.20 (< 0.25, >= 0.20)
  const profile = baseProfile(['cocktail', 'speakeasy', 'polished', 'industry']);

  it('relaxes the threshold from 0.25 down by 0.05 steps when < MIN_CANDIDATES match', () => {
    const strongA = makeBar({
      id: 'strongA',
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    const strongB = makeBar({
      id: 'strongB',
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    // weak bars only meet at 0.20 (below the 0.25 start)
    const weakA = makeBar({
      id: 'weakA',
      tags: ['cocktail', 'dive'],
    });
    const weakB = makeBar({
      id: 'weakB',
      tags: ['cocktail', 'rooftop'],
    });

    const result = matches({
      profile,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [strongA, strongB, weakA, weakB],
      now: NOW,
    });

    // At 0.25 only the two strong bars match (< 3) → engine relaxes to 0.20
    // and now all four match. Sort is jaccard-desc; cap at 3.
    expect(result).toHaveLength(3);
    const ids = result.map((b) => b.id);
    expect(ids.slice(0, 2).sort()).toEqual(['strongA', 'strongB']);
    expect(['weakA', 'weakB']).toContain(ids[2]);
  });

  it('floors at 0.10 — when nothing meets even 0.10, returns whatever exists (no infinite loop)', () => {
    // No bar shares any tag with the user.
    const noOverlapA = makeBar({ id: 'noA', tags: ['beer', 'pub', 'cheap'] });
    const noOverlapB = makeBar({ id: 'noB', tags: ['wine', 'romantic'] });

    const result = matches({
      profile,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [noOverlapA, noOverlapB],
      now: NOW,
    });

    // Floor hit, nothing matches, function still returns (possibly empty) array.
    expect(result).toHaveLength(0);
  });
});

describe('matches() — blended ranking (vibe + proximity + loved affinity)', () => {
  const profile = baseProfile(['cocktail', 'speakeasy', 'polished', 'industry']);
  const ORIGIN = { lat: 40.7550, lng: -73.9840 }; // Midtown centroid

  it('a strong vibe match slightly farther outranks a weak vibe match that is closer', () => {
    // weakNear: jaccard 0.25 (only 'cocktail' shared), ~0 mi from origin.
    const weakNear = makeBar({
      id: 'weakNear',
      lat: 40.7551,
      lng: -73.984,
      tags: ['cocktail'],
    });
    // strongFar: jaccard 1.0 (all four shared), ~0.6 mi from origin.
    const strongFar = makeBar({
      id: 'strongFar',
      lat: 40.764,
      lng: -73.984,
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });

    const result = matches({
      profile,
      coords: ORIGIN,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [weakNear, strongFar],
      now: NOW,
    });

    // OLD behavior (pure-distance sort) ranked weakNear first. The blended
    // score must now put the far-but-far-better vibe match ahead of it.
    expect(result.map((b) => b.id)).toEqual(['strongFar', 'weakNear']);
  });

  it('among equal-vibe bars, the closer one still wins (proximity breaks the tie)', () => {
    const near = makeBar({
      id: 'near',
      lat: 40.7551,
      lng: -73.984,
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    const far = makeBar({
      id: 'far',
      lat: 40.764,
      lng: -73.984,
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    const result = matches({
      profile,
      coords: ORIGIN,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [far, near],
      now: NOW,
    });
    expect(result.map((b) => b.id)).toEqual(['near', 'far']);
  });

  it('loved-tag affinity breaks ties between otherwise equal bars', () => {
    // Both bars have identical jaccard vs the profile (2/6 = 0.333) and no
    // coords, so vibe and proximity tie. Only lovedTags differ.
    const matchesLoved = makeBar({
      id: 'matchesLoved',
      tags: ['cocktail', 'speakeasy', 'dive', 'rough'],
    });
    const noLovedOverlap = makeBar({
      id: 'noLovedOverlap',
      tags: ['cocktail', 'speakeasy', 'dive', 'cheap'],
    });
    const result = matches({
      profile,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [noLovedOverlap, matchesLoved],
      lovedTags: ['dive', 'rough', 'old-nyc'],
      now: NOW,
    });
    expect(result.map((b) => b.id)).toEqual(['matchesLoved', 'noLovedOverlap']);
  });

  it('omitting lovedTags is a no-op (backward compatible)', () => {
    const a = makeBar({
      id: 'a',
      tags: ['cocktail', 'speakeasy', 'dive', 'rough'],
    });
    const b = makeBar({
      id: 'b',
      tags: ['cocktail', 'speakeasy', 'dive', 'cheap'],
    });
    // Equal vibe, no coords, no lovedTags → stable order, neither boosted.
    const withLoved = matches({
      profile,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [a, b],
      lovedTags: [],
      now: NOW,
    });
    const withoutLoved = matches({
      profile,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [a, b],
      now: NOW,
    });
    expect(withLoved.map((x) => x.id)).toEqual(withoutLoved.map((x) => x.id));
  });
});

describe('scoreBar', () => {
  const makeBar = (tags: VibeTag[], lat = 40.755, lng = -73.984): Bar => ({
    id: 's',
    name: 'S',
    neighborhood: 'Midtown',
    address: '1 Main St',
    lat,
    lng,
    priceTier: 2,
    tags,
    blurb: 'A bar.',
    lastVerified: FRESH,
  });
  const userTags: VibeTag[] = ['cocktail', 'speakeasy', 'polished', 'industry'];

  it('with no coords, score = VIBE_WEIGHT·jaccard + DIST_WEIGHT (proximity=1)', () => {
    // jaccard = 1.0 → 0.5·1 + 0.4·1 + 0 = 0.9
    const score = scoreBar(makeBar(userTags), userTags, null, []);
    expect(score).toBeCloseTo(0.9, 10);
  });

  it('proximity decays with distance so a closer equal-vibe bar scores higher', () => {
    const origin = { lat: 40.755, lng: -73.984 };
    const near = scoreBar(makeBar(userTags, 40.7551), userTags, origin, []);
    const far = scoreBar(makeBar(userTags, 40.764), userTags, origin, []);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(0.9); // never exceeds the no-distance-penalty max
  });

  it('stays within [0, 1] even at max vibe, zero distance, full loved affinity', () => {
    const origin = { lat: 40.755, lng: -73.984 };
    const score = scoreBar(makeBar(userTags), userTags, origin, userTags);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('matches() — sorting and slicing', () => {
  const profile = baseProfile(['cocktail', 'speakeasy', 'polished', 'industry']);

  it('sorts by distance ascending when coords provided', () => {
    // Origin = Midtown centroid.
    const closest = makeBar({
      id: 'closest',
      lat: 40.7550, // ~0 mi
      lng: -73.9840,
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    const mid = makeBar({
      id: 'mid',
      lat: 40.7470, // Chelsea centroid ~1.3mi
      lng: -74.0010,
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });
    const farthest = makeBar({
      id: 'farthest',
      lat: 40.7060, // FiDi centroid ~3.4mi
      lng: -74.0090,
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
    });

    const result = matches({
      profile,
      coords: { lat: 40.7550, lng: -73.9840 },
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [farthest, mid, closest], // pass out-of-order
      now: NOW,
    });

    expect(result.map((b) => b.id)).toEqual(['closest', 'mid', 'farthest']);
  });

  it('sorts by jaccard descending when coords is null', () => {
    const perfect = makeBar({
      id: 'perfect',
      tags: ['cocktail', 'speakeasy', 'polished', 'industry'], // jaccard = 1.0
    });
    const partial = makeBar({
      id: 'partial',
      tags: ['cocktail', 'speakeasy', 'dive', 'rough'], // intersection 2, union 6 = 0.33
    });
    const weakest = makeBar({
      id: 'weakest',
      tags: ['cocktail', 'speakeasy', 'dive', 'rough', 'cheap', 'old-nyc'], // intersection 2, union 8 = 0.25
    });

    const result = matches({
      profile,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [weakest, partial, perfect],
      now: NOW,
    });

    expect(result.map((b) => b.id)).toEqual(['perfect', 'partial', 'weakest']);
  });

  it('regression: bars.ts PLACEHOLDER_VERIFIED dates still pass the hard filter on 2026-09-28', async () => {
    // Calendar-bomb regression. Both v0.3.1 council voices independently flagged
    // that with LAST_VERIFIED_HARD_FILTER_DAYS = 180 and placeholder 2026-04-01,
    // the real bars.ts dataset would silently return zero results on 2026-09-28.
    // We bumped the threshold to 365 to buy time until per-bar verification.
    // This test asserts matches() returns >= 3 against the REAL dataset at that
    // future date.
    const { bars: realBars } = await import('@/lib/bars');
    const futureNow = new Date('2026-09-28T00:00:00Z');
    const result = matches({
      profile: baseProfile(['cocktail', 'speakeasy', 'polished', 'industry']),
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: realBars,
      now: futureNow,
    });
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it('caps the result set at MAX_RESULTS (3) even when 5 bars match', () => {
    const fiveMatchers: Bar[] = [
      makeBar({ id: 'm1', tags: ['cocktail', 'speakeasy', 'polished', 'industry'] }),
      makeBar({ id: 'm2', tags: ['cocktail', 'speakeasy', 'polished', 'industry'] }),
      makeBar({ id: 'm3', tags: ['cocktail', 'speakeasy', 'polished', 'industry'] }),
      makeBar({ id: 'm4', tags: ['cocktail', 'speakeasy', 'polished', 'industry'] }),
      makeBar({ id: 'm5', tags: ['cocktail', 'speakeasy', 'polished', 'industry'] }),
    ];

    const result = matches({
      profile,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: fiveMatchers,
      now: NOW,
    });

    expect(result).toHaveLength(3);
  });

  it('maxResults override expands the cap (quiz path uses 10)', () => {
    const twelveMatchers: Bar[] = Array.from({ length: 12 }, (_, i) =>
      makeBar({
        id: `m${i}`,
        tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
      }),
    );

    const result = matches({
      profile,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: twelveMatchers,
      maxResults: 10,
      now: NOW,
    });

    expect(result).toHaveLength(10);
  });
});

describe('matches — empty vibe profile (location-first suggest)', () => {
  it('returns proximity-ranked bars instead of filtering everything out', () => {
    // Regression: an empty profile made jaccard(vs []) === 0 for every bar,
    // which never cleared the Jaccard floor → zero results. The location-first
    // "suggest near me" flow (no quiz taken) must still surface bars.
    const near = makeBar({ id: 'near', lat: 40.7250, lng: -73.9850, tags: ['dive'] });
    const far = makeBar({ id: 'far', lat: 40.8100, lng: -73.9500, tags: ['cocktail'] });
    const coords = { lat: 40.7250, lng: -73.9850 };

    const result = matches({
      profile: baseProfile([]), // no vibe preference
      coords,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [far, near],
      maxResults: 5,
      now: NOW,
    });

    expect(result.length).toBeGreaterThan(0);
    // Ranked by proximity when there's no vibe signal: nearest first.
    expect(result[0].id).toBe('near');
  });
});
