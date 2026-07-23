import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Bar, VibeTag } from '@/types';
import { bars } from '@/lib/bars';
import { jaccard, matches } from '@/lib/matching';
import {
  TAG_VOCABULARY,
  getBarById,
  getBars,
  getBarsSnapshot,
  getTagMask,
  jaccardByMask,
  replaceCatalog,
  tagsToMask,
} from '@/lib/catalog';
import { useBars } from '@/lib/useBars';

// Deterministic PRNG (mulberry32) so the synthetic catalog and the random
// tag sets are reproducible across runs — a perf/property failure must be
// re-runnable, not a dice roll.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomTags(rand: () => number, count: number): VibeTag[] {
  const picked = new Set<VibeTag>();
  while (picked.size < count) {
    picked.add(TAG_VOCABULARY[Math.floor(rand() * TAG_VOCABULARY.length)]);
  }
  return [...picked];
}

function syntheticBars(count: number, rand: () => number): Bar[] {
  const neighborhoods = [
    'LES',
    'East Village',
    'West Village',
    'Chelsea',
    'Midtown',
    'FiDi',
    'UWS',
    'UES',
    'Williamsburg',
    'Greenpoint',
    'Bushwick',
    'Park Slope',
  ] as const;
  return Array.from({ length: count }, (_, i) => ({
    id: `synthetic-${i}`,
    name: `Synthetic Bar ${i}`,
    neighborhood: neighborhoods[i % neighborhoods.length],
    address: `${i} Test St`,
    // Scatter across the NYC service area (~40.64–40.88 lat, -74.03–-73.89 lng).
    lat: 40.64 + rand() * 0.24,
    lng: -74.03 + rand() * 0.14,
    priceTier: ((i % 4) + 1) as 1 | 2 | 3 | 4,
    tags: randomTags(rand, 3 + Math.floor(rand() * 5)),
    blurb: 'Synthetic perf-test bar.',
    lastVerified: '2026-07-01',
  }));
}

afterEach(() => {
  // Tests that swap the catalog must leave the module store on the real
  // static catalog for the rest of this file.
  replaceCatalog(bars);
});

describe('catalog accessor', () => {
  it('getBars() resolves instantly with the full static catalog', async () => {
    const result = await getBars();
    expect(result).toBe(bars);
    expect(result.length).toBeGreaterThan(0);
  });

  it('getBarsSnapshot() returns the same array synchronously', () => {
    expect(getBarsSnapshot()).toBe(bars);
  });

  it('getBarById() resolves every catalog id and misses unknown ids', () => {
    for (const bar of bars) {
      expect(getBarById(bar.id)).toBe(bar);
    }
    expect(getBarById('definitely-not-a-bar')).toBeUndefined();
  });

  it('useBars() returns the catalog synchronously (no loading flash)', () => {
    const { result } = renderHook(() => useBars());
    expect(result.current).toBe(bars);
  });

  it('useBars() re-renders subscribers when the catalog is replaced', () => {
    const { result } = renderHook(() => useBars());
    const next = bars.slice(0, 3);
    act(() => {
      replaceCatalog(next);
    });
    expect(result.current).toBe(next);
    // getBarById / getTagMask follow the swap too — the accessor is one store.
    expect(getBarById(bars[bars.length - 1].id)).toBeUndefined();
    expect(getTagMask(next[0].id)).toBe(tagsToMask(next[0].tags));
  });
});

describe('tag bitmasks', () => {
  it('assigns every VibeTag exactly one distinct bit', () => {
    const masks = TAG_VOCABULARY.map((tag) => tagsToMask([tag]));
    for (const mask of masks) {
      // Power of two = exactly one bit set.
      expect(mask > 0n && (mask & (mask - 1n)) === 0n).toBe(true);
    }
    expect(new Set(masks).size).toBe(TAG_VOCABULARY.length);
  });

  it('precomputes a mask for every bar matching its tag list', () => {
    for (const bar of bars) {
      expect(getTagMask(bar.id)).toBe(tagsToMask(bar.tags));
    }
    expect(getTagMask('definitely-not-a-bar')).toBeUndefined();
  });

  it('jaccardByMask agrees with the set-based jaccard on random tag sets', () => {
    const rand = mulberry32(0xb1);
    for (let i = 0; i < 500; i += 1) {
      const a = randomTags(rand, 1 + Math.floor(rand() * 8));
      const b = randomTags(rand, 1 + Math.floor(rand() * 8));
      expect(jaccardByMask(tagsToMask(a), tagsToMask(b))).toBeCloseTo(
        jaccard(a, b),
        12,
      );
    }
  });

  it('jaccardByMask handles empty and identical masks like jaccard', () => {
    expect(jaccardByMask(0n, 0n)).toBe(0); // matches jaccard([], []) === 0
    expect(jaccardByMask(0n, tagsToMask(['dive']))).toBe(0);
    const full = tagsToMask([...TAG_VOCABULARY]);
    expect(jaccardByMask(full, full)).toBe(1);
  });
});

describe('perf budget (B1: full match over 5k bars)', () => {
  it('matches() over 5,000 synthetic bars stays under 50ms', () => {
    const rand = mulberry32(0x5eed);
    const pool = syntheticBars(5000, rand);
    const args = {
      profile: {
        tags: ['cocktail', 'speakeasy', 'date'] as VibeTag[],
        archetype: 'test',
        preferredNeighborhoods: [],
      },
      coords: { lat: 40.7259, lng: -73.9846 }, // East Village
      preferredNeighborhoods: [],
      maxMiles: null,
      bars: pool,
      lovedTags: ['cocktail', 'polished', 'jazz'] as VibeTag[],
      now: new Date('2026-07-23T22:00:00-04:00'),
    };

    // Warm-up run so JIT compilation isn't billed to the budget.
    matches(args);

    const start = performance.now();
    const ranked = matches(args);
    const elapsed = performance.now() - start;

    expect(ranked.length).toBeGreaterThan(0);
    // Blueprint B1 budget: full match over 5k bars < 50ms on dev hardware
    // (observed ~6ms). Shared/CI-class runners get the documented 150ms
    // ceiling instead of a flaky blocker (Opus review).
    const ceiling = process.env.CI ? 150 : 50;
    expect(elapsed).toBeLessThan(ceiling);
  });
});
