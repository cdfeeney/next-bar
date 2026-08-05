import { describe, it, expect } from 'vitest';
import { isLateNight, jaccard, matches, scoreBar, vibeMatchBadge } from '@/lib/matching';
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

describe('matches() — sliceCap (g-d3f8d912 fresh-hand depth)', () => {
  it('returns ranked depth at the SAME adaptive threshold maxResults would settle on', () => {
    // Four strong matches (jaccard 1) settle the relax loop at the 0.25
    // start for relaxTarget max(3, maxResults=3). One weak bar (jaccard
    // 1/5 = 0.2) passes only a relaxed threshold. sliceCap must return
    // ALL bars at the SETTLED threshold — and never relax further to
    // reach the deeper slice (that would weaken the vibe gate; the naive
    // maxResults=pool.length approach did exactly that).
    const strong = ['s1', 's2', 's3', 's4'].map((id) =>
      makeBar({ id, tags: ['dive'] }),
    );
    const weak = makeBar({
      id: 'weak',
      tags: ['dive', 'cocktail', 'wine', 'speakeasy', 'polished'],
    });
    const args = {
      profile: baseProfile(['dive']),
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [...strong, weak],
      now: NOW,
    };
    const sliced = matches({ ...args, maxResults: 3, sliceCap: 100 });
    expect(sliced.map((b) => b.id).sort()).toEqual(['s1', 's2', 's3', 's4']);
    // Control: without sliceCap the same call slices to maxResults.
    expect(matches({ ...args, maxResults: 3 })).toHaveLength(3);
    // Control: the naive deep request DOES relax to the floor and admit
    // the weak bar — the behavior sliceCap exists to avoid.
    const naive = matches({ ...args, maxResults: 5 });
    expect(naive.map((b) => b.id)).toContain('weak');
  });

  it('relaxDiscountIds relaxes exactly as far as hard-excluding those ids would (santa: Codex round 2)', () => {
    // Seen bars qualify only at a RELAXED threshold; three fresh strong
    // bars qualify at the 0.25 start. A run-it-again deal (seen bars
    // hard-excluded) settles at 0.25 — the discounted soft-seen deal must
    // settle there too. The superseded maxResults + seen.length target
    // demanded five candidates and relaxed to 0.20, admitting the weak
    // seen bars AND any weak fresh bar with them.
    const fresh = ['f1', 'f2', 'f3'].map((id) => makeBar({ id, tags: ['dive'] }));
    const seenWeak = ['w1', 'w2'].map((id) =>
      makeBar({ id, tags: ['dive', 'cocktail', 'wine', 'speakeasy', 'polished'] }),
    );
    const args = {
      profile: baseProfile(['dive']),
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [...fresh, ...seenWeak],
      now: NOW,
    };
    const deal = matches({
      ...args,
      maxResults: 3,
      sliceCap: 100,
      relaxDiscountIds: ['w1', 'w2'],
    });
    expect(deal.map((b) => b.id).sort()).toEqual(['f1', 'f2', 'f3']);
  });

  it('discounted ids that DO qualify at the settled threshold stay ranked (fallback reuse)', () => {
    // One seen strong bar + two fresh strong bars, target 3: the discount
    // means only the fresh pair counts, so the loop relaxes to the floor
    // hunting a third fresh candidate — but the seen bar remains in the
    // output throughout, available to the arrangement as fallback.
    const bars = [
      makeBar({ id: 'seen-strong', tags: ['dive'] }),
      makeBar({ id: 'f1', tags: ['dive'] }),
      makeBar({ id: 'f2', tags: ['dive'] }),
    ];
    const deal = matches({
      profile: baseProfile(['dive']),
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars,
      now: NOW,
      maxResults: 3,
      sliceCap: 100,
      relaxDiscountIds: ['seen-strong'],
    });
    expect(deal.map((b) => b.id).sort()).toEqual(['f1', 'f2', 'seen-strong']);
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

  it('QA-6: keeps relaxing the Jaccard threshold to FILL the requested cap, not just the 3-result minimum', () => {
    // 3 exact-vibe matchers pass at the strictest threshold; the other 4
    // only clear the floor. Pre-QA-6 the relax loop stopped at 3
    // candidates and a 5-result surface got shortchanged.
    const pool: Bar[] = [
      makeBar({ id: 's1', tags: ['cocktail', 'speakeasy', 'polished', 'industry'] }),
      makeBar({ id: 's2', tags: ['cocktail', 'speakeasy', 'polished', 'industry'] }),
      makeBar({ id: 's3', tags: ['cocktail', 'speakeasy', 'polished', 'industry'] }),
      makeBar({ id: 'w1', tags: ['cocktail', 'dive', 'beer', 'garden'] }),
      makeBar({ id: 'w2', tags: ['cocktail', 'dive', 'beer', 'rooftop'] }),
      makeBar({ id: 'w3', tags: ['cocktail', 'dive', 'jazz', 'garden'] }),
      makeBar({ id: 'w4', tags: ['cocktail', 'wine', 'beer', 'garden'] }),
    ];

    const result = matches({
      profile,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: pool,
      maxResults: 5,
      now: NOW,
    });

    expect(result).toHaveLength(5);
    // The strict matchers still lead — relaxed admissions rank below.
    expect(result.slice(0, 3).map((b) => b.id).sort()).toEqual(['s1', 's2', 's3']);
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

describe('permanently-closed hard filter (Places refresh 2026-07-23)', () => {
  it('never suggests a CLOSED_PERMANENTLY bar even on perfect vibe match', () => {
    const open = makeBar({ id: 'open-bar', tags: ['dive', 'chill'] });
    const dead = makeBar({
      id: 'dead-bar',
      tags: ['dive', 'chill'],
      businessStatus: 'CLOSED_PERMANENTLY',
    });
    const ranked = matches({
      profile: { tags: ['dive', 'chill'], archetype: 't', preferredNeighborhoods: [] },
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [open, dead],
      now: NOW,
    });
    expect(ranked.map((b) => b.id)).toContain('open-bar');
    expect(ranked.map((b) => b.id)).not.toContain('dead-bar');
  });
});

describe('late-night bias (operator 2026-07-27: clubs up, restaurants down after hours)', () => {
  // Equal vibe overlap across all three (the bias is TIE-BREAKER scale —
  // a genuinely stronger vibe match must still win, so the fixture holds
  // vibe constant and lets the night nudge decide).
  const profile = baseProfile(['cocktail']);
  const club = makeBar({ id: 'club', tags: ['cocktail', 'club'] });
  const resto = makeBar({ id: 'resto', tags: ['cocktail', 'restaurant-bar'] });
  const plain = makeBar({ id: 'plain', tags: ['cocktail', 'chill'] });
  const LATE = new Date('2026-07-24T23:30:00');
  const AFTERNOON = new Date('2026-07-24T15:00:00');

  const rank = (biasNow?: Date) =>
    matches({
      profile,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [resto, plain, club],
      maxResults: 3,
      now: NOW,
      biasNow,
    }).map((b) => b.id);

  it('at 11:30pm the club leads and the restaurant-bar trails', () => {
    expect(rank(LATE)).toEqual(['club', 'plain', 'resto']);
  });

  it('at 3pm identical-vibe venues stay un-biased', () => {
    const ids = rank(AFTERNOON);
    expect(new Set(ids)).toEqual(new Set(['club', 'plain', 'resto']));
    expect(rank(AFTERNOON)).toEqual(rank(undefined));
  });

  it('a restaurant that is ALSO a club keeps its night credibility', () => {
    const hybrid = makeBar({ id: 'hybrid', tags: ['cocktail', 'restaurant-bar', 'club'] });
    const ids = matches({
      profile,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: [resto, hybrid],
      maxResults: 2,
      now: NOW,
      biasNow: LATE,
    }).map((b) => b.id);
    expect(ids).toEqual(['hybrid', 'resto']);
  });

  it('the window wraps midnight: 3:59am biased, 4:00am not', () => {
    expect(isLateNight(new Date('2026-07-25T03:59:00'))).toBe(true);
    expect(isLateNight(new Date('2026-07-25T04:00:00'))).toBe(false);
    expect(isLateNight(new Date('2026-07-24T22:00:00'))).toBe(true);
    expect(isLateNight(new Date('2026-07-24T21:59:00'))).toBe(false);
  });
});

describe('distance widening re-runs discovery from the wider radius (goal g-f81ccdfc)', () => {
  // LES-ish origin. nearPerfect sits ~0.3mi away but matches the profile
  // poorly; farPerfect sits ~2.5mi away (outside Walkable 1.5, inside Cab 4)
  // and matches the profile PERFECTLY. If widening merely re-filtered the
  // walkable pool, farPerfect could never appear — let alone win.
  const origin = { lat: 40.717, lng: -73.987 };
  const profile = baseProfile(['cocktail', 'speakeasy', 'polished', 'industry']);
  const nearWeak = makeBar({
    id: 'near-weak',
    lat: 40.7205, lng: -73.9865, // ~0.25 mi
    // ONE shared tag: enough overlap to stay in the pool (the matcher drops
    // zero-overlap bars outright), weak enough to lose to a perfect match.
    tags: ['cocktail', 'dive', 'beer'],
  });
  const farPerfect = makeBar({
    id: 'far-perfect',
    lat: 40.7515, lng: -73.9772, // ~2.4 mi — outside walking, inside cab
    tags: ['cocktail', 'speakeasy', 'polished', 'industry'],
  });
  const pool = [nearWeak, farPerfect];
  const run = (maxMiles: number | null) =>
    matches({
      profile,
      coords: origin,
      preferredNeighborhoods: [],
      maxMiles,
      bars: pool,
      now: NOW,
    }).map((b) => b.id);

  it('at Walkable the far bar is genuinely absent from the pool', () => {
    expect(run(1.5)).toEqual(['near-weak']);
  });

  it('a bar only reachable at the wider radius CAN WIN the pick', () => {
    // The whole point of widening: candidate DISCOVERY re-runs, so the far
    // bar not only appears — it out-ranks the weak near one.
    expect(run(4)[0]).toBe('far-perfect');
  });

  it('widening equals a fresh run at the wide radius — no memory of the narrow run', () => {
    // matches() is pure: called after a narrow run, the wide result is
    // byte-identical to a cold wide run. This is the property that makes
    // "re-filter the fetched pool" impossible at this layer; the component
    // layer's only carried state is the documented E3.1 visited-set rule
    // (and shownIds, which handleRadiusChange clears — e2e covers that).
    const narrowFirst = run(1.5);
    const wideAfterNarrow = run(4);
    const coldWide = run(4);
    expect(wideAfterNarrow).toEqual(coldWide);
    expect(narrowFirst).not.toEqual(wideAfterNarrow);
  });

  it('no-result semantics preserved: a radius admitting nothing returns []', () => {
    const nothingNear = matches({
      profile,
      coords: { lat: 40.9, lng: -73.8 }, // far from both fixtures
      preferredNeighborhoods: [],
      maxMiles: 1.5,
      bars: pool,
      now: NOW,
    });
    expect(nothingNear).toEqual([]);
  });
});
