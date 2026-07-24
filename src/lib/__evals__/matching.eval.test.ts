import { describe, expect, it } from 'vitest';
import type { Bar, VibeProfile, VibeTag } from '@/types';
import { jaccard, matches, scoreBar } from '@/lib/matching';
import {
  EXPLORATION_MIN_RESULTS,
  JACCARD_FLOOR,
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
      const s1 = scoreBar(b1, userTags as VibeTag[], null, []);
      const s2 = scoreBar(b2, userTags as VibeTag[], null, []);
      expect(s2).toBeGreaterThanOrEqual(s1);
    }
  });

  it('score is non-increasing in distance (moving a bar farther never helps)', () => {
    const rng = makeRng(2);
    const coords = { lat: 40.728, lng: -73.985 };
    for (let trial = 0; trial < 200; trial++) {
      const tags = [...ALL_TAGS].sort(() => rng() - 0.5).slice(0, 3) as VibeTag[];
      const near = bar('n', { tags, lat: coords.lat + 0.001, lng: coords.lng });
      const far = bar('f', {
        tags,
        lat: coords.lat + 0.001 + rng() * 0.2,
        lng: coords.lng,
      });
      const sNear = scoreBar(near, PROFILE.tags, coords, []);
      const sFar = scoreBar(far, PROFILE.tags, coords, []);
      expect(sNear).toBeGreaterThanOrEqual(sFar);
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

describe('eval: exploration slot (B7b ε-greedy, simplified)', () => {
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

  it('surfaces with >= EXPLORATION_MIN_RESULTS reserve the LAST slot for a qualified long-tail pick', () => {
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

    // Re-rank without exploration by scoring directly.
    const pureTop = [...bigPool()]
      .map((b) => ({ b, s: scoreBar(b, PROFILE.tags, null, []) }))
      .sort((a, z) => z.s - a.s)
      .slice(0, EXPLORATION_MIN_RESULTS)
      .map((r) => r.b.id);

    // First N-1 slots are the pure top; the last is from OUTSIDE it.
    for (let i = 0; i < EXPLORATION_MIN_RESULTS - 1; i++) {
      expect(results[i].id).toBe(pureTop[i]);
    }
    expect(pureTop).not.toContain(results[EXPLORATION_MIN_RESULTS - 1].id);

    // Qualified: the pick still clears the Jaccard floor.
    expect(
      jaccard(PROFILE.tags, results[EXPLORATION_MIN_RESULTS - 1].tags),
    ).toBeGreaterThanOrEqual(JACCARD_FLOOR);
  });

  it('the pick is deterministic for (profile, night) and rotates across nights — at the 5am LOCAL rollover, not UTC midnight', () => {
    // Local-noon dates: unambiguous nights in any timezone.
    const run = (dayOfMonth: number, hour = 12) =>
      matches({
        profile: PROFILE,
        coords: null,
        preferredNeighborhoods: [],
        maxMiles: null,
        bars: bigPool(),
        maxResults: EXPLORATION_MIN_RESULTS,
        now: new Date(2026, 6, dayOfMonth, hour),
      })[EXPLORATION_MIN_RESULTS - 1].id;

    expect(run(25)).toBe(run(25));
    // 2am belongs to the PREVIOUS night (5am rollover, cadence.ts): the
    // pick must NOT rotate mid-evening or at midnight.
    expect(run(26, 2)).toBe(run(25, 23));
    // Across many nights the pick must not be constant (rotation works).
    const nights = [25, 26, 27, 28, 29].map((d) => run(d));
    expect(new Set(nights).size).toBeGreaterThan(1);
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
      .map((b) => ({ b, s: scoreBar(b, PROFILE.tags, null, []) }))
      .sort((a, z) => z.s - a.s)
      .slice(0, MAX_RESULTS)
      .map((r) => r.b.id);
    expect(results.map((r) => r.id)).toEqual(pureTop);
  });
});

describe('eval: 5k-bar perf ceiling', () => {
  it('a full match over 5k bars (with exploration path) stays under the CI ceiling', () => {
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
