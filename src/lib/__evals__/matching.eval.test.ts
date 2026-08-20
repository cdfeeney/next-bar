import { describe, expect, it } from 'vitest';
import type { Bar, VibeProfile, VibeTag } from '@/types';
import { jaccard, matches, rankScore } from '@/lib/matching';
import { EMPTY_TASTE } from '@/lib/tasteAffinity';
import {
  EXPLORATION_MIN_RESULTS,
  MAX_RESULTS,
} from '@/lib/constants';

/**
 * B7b eval suite — matching invariants (blueprint §B7): score monotonic in
 * jaccard and distance; neighborhood-filter honesty (MED-12); exploration
 * slot (1 of top-10 = qualified long-tail pick, deterministic seed); 5k
 * perf under a CI ceiling.
 */

const NOW = new Date('2026-07-25T04:00:00.000Z');
const FRESH = '2026-07-01';

const ALL_TAGS: VibeTag[] = [
  'dive', 'cocktail', 'wine', 'beer', 'dance', 'lounge', 'speakeasy', 'pub',
  'rooftop', 'garden', 'chill', 'buzzy', 'loud', 'locals', 'post-work',
  'date', 'industry', 'rough', 'polished', 'romantic', 'old-nyc', 'trendy',
];

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function bar(id: string, overrides: Partial<Bar> = {}): Bar {
  return {
    id,
    name: `Bar ${id}`,
    neighborhood: 'East Village',
    address: '1 Test St',
    lat: 40.727,
    lng: -73.984,
    priceTier: 2,
    tags: ['dive', 'chill'],
    blurb: 'Synthetic eval bar.',
    lastVerified: FRESH,
    ...overrides,
  };
}

function syntheticPool(n: number, rng: () => number): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const tags = [...ALL_TAGS]
      .sort(() => rng() - 0.5)
      .slice(0, 2 + Math.floor(rng() * 4)) as VibeTag[];
    return bar(`s${i}`, {
      tags,
      lat: 40.7 + rng() * 0.1,
      lng: -74.02 + rng() * 0.08,
      neighborhood: rng() < 0.5 ? 'East Village' : 'LES',
    });
  });
}

const PROFILE: VibeProfile = {
  tags: ['dive', 'chill', 'locals'],
  answers: {},
} as unknown as VibeProfile;

describe('eval: matching score monotonicity', () => {
  it('score is non-decreasing in vibe overlap (adding a shared tag never hurts)', () => {
    const rng = makeRng(1);
    for (let trial = 0; trial < 200; trial++) {
      const userTags = [...ALL_TAGS].sort(() => rng() - 0.5).slice(0, 4);
      const barTags = [...ALL_TAGS].sort(() => rng() - 0.5).slice(0, 3);
      const missing = userTags.find((t) => !barTags.includes(t));
      if (!missing) continue;
      const b1 = bar('m1', { tags: barTags as VibeTag[] });
      const b2 = bar('m2', { tags: [...barTags, missing] as VibeTag[] });
      const s1 = rankScore(b1, userTags as VibeTag[], EMPTY_TASTE);
      const s2 = rankScore(b2, userTags as VibeTag[], EMPTY_TASTE);
      expect(s2).toBeGreaterThanOrEqual(s1);
    }
  });

  // V8: distance left the ranking score entirely — it selects the BAND and
  // breaks ties. The monotonicity that still matters is therefore expressed
  // against matches(): an equal-taste bar in a nearer band always outranks a
  // farther one, and within a band the closer of two equals leads.
  it('a nearer band always outranks a farther one at equal taste', () => {
    const rng = makeRng(2);
    const coords = { lat: 40.728, lng: -73.985 };
    for (let trial = 0; trial < 200; trial++) {
      const tags = [...ALL_TAGS].sort(() => rng() - 0.5).slice(0, 3) as VibeTag[];
      const near = bar('n', { tags, lat: coords.lat + 0.001, lng: coords.lng });
      // 0.1-0.3 deg latitude ~= 7-21 miles: always past RADIUS_CAB.
      const far = bar('f', {
        tags,
        lat: coords.lat + 0.1 + rng() * 0.2,
        lng: coords.lng,
      });
      const ids = matches({
        profile: PROFILE,
        coords,
        preferredNeighborhoods: [],
        maxMiles: null,
        bars: [far, near],
        maxResults: 2,
      }).map((b) => b.id);
      expect(ids[0]).toBe('n');
    }
  });
});

describe('eval: neighborhood-filter honesty (MED-12)', () => {
  it('every result respects preferredNeighborhoods — no silent spillover', () => {
    const rng = makeRng(3);
    const pool = syntheticPool(200, rng);
    const results = matches({
      profile: PROFILE,
      coords: null,
      preferredNeighborhoods: ['East Village'],
      maxMiles: null,
      bars: pool,
      maxResults: 20,
      now: NOW,
    });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.neighborhood).toBe('East Village');
  });
});

describe('eval: no exploration slot — every result is cascade-ordered', () => {
  function bigPool(): Bar[] {
    // 30 bars sharing profile tags with descending extra overlap so the
    // score order is unambiguous, all fresh, one neighborhood.
    return Array.from({ length: 30 }, (_, i) =>
      bar(`e${i}`, {
        tags:
          i < 15
            ? (['dive', 'chill', 'locals'] as VibeTag[])
            : (['dive', 'cocktail'] as VibeTag[]),
      }),
    );
  }

  // The B7b exploration slot was REMOVED on 2026-08-19 (operator direction:
  // V8 ranking correctness wins). These pin its absence — every returned
  // result, including the last one on a 10-slot surface, must come straight
  // from the cascade order.
  it('no slot is sacrificed: the last result IS the cascade-ordered Nth', () => {
    const results = matches({
      profile: PROFILE,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: bigPool(),
      maxResults: EXPLORATION_MIN_RESULTS,
      now: NOW,
    });
    expect(results).toHaveLength(EXPLORATION_MIN_RESULTS);

    const pureTop = [...bigPool()]
      .map((b) => ({ b, s: rankScore(b, PROFILE.tags, EMPTY_TASTE) }))
      .sort((a, z) => z.s - a.s)
      .slice(0, EXPLORATION_MIN_RESULTS)
      .map((x) => x.b.id);

    // EVERY slot matches — previously the loop stopped at N-1 because the
    // last one was deliberately overwritten.
    expect(results.map((b) => b.id)).toEqual(pureTop);
  });

  it('results no longer rotate with the night — ordering is stable', () => {
    const run = (dayOfMonth: number, nycHour = 12) =>
      matches({
        profile: PROFILE,
        coords: null,
        preferredNeighborhoods: [],
        maxMiles: null,
        bars: bigPool(),
        maxResults: EXPLORATION_MIN_RESULTS,
        now: new Date(Date.UTC(2026, 6, dayOfMonth, nycHour + 4)),
      }).map((b) => b.id);

    // The daily rotation was a property of the removed exploration pick. With
    // it gone, `now` only drives staleness filtering, so the page is stable
    // across nights for an unchanged catalog and profile.
    expect(run(26, 2)).toEqual(run(25, 23));
    expect(run(27, 12)).toEqual(run(25, 12));
  });

  it('small default surfaces (MAX_RESULTS) never sacrifice a slot', () => {
    const results = matches({
      profile: PROFILE,
      coords: null,
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: bigPool(),
      now: NOW,
    });
    const pureTop = [...bigPool()]
      .map((b) => ({ b, s: rankScore(b, PROFILE.tags, EMPTY_TASTE) }))
      .sort((a, z) => z.s - a.s)
      .slice(0, MAX_RESULTS)
      .map((r) => r.b.id);
    expect(results.map((r) => r.id)).toEqual(pureTop);
  });
});

describe('eval: 5k-bar perf ceiling', () => {
  it('a full match over 5k bars stays under the CI ceiling', () => {
    const rng = makeRng(4);
    const pool = syntheticPool(5000, rng);
    const start = performance.now();
    const results = matches({
      profile: PROFILE,
      coords: { lat: 40.728, lng: -73.985 },
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: pool,
      maxResults: EXPLORATION_MIN_RESULTS,
      now: NOW,
    });
    const elapsed = performance.now() - start;
    expect(results.length).toBeGreaterThan(0);
    // Generous CI ceiling — the B1 budget test pins ~50ms locally; this
    // eval only guards against order-of-magnitude regressions on slow CI.
    expect(elapsed).toBeLessThan(250);
  });
});
