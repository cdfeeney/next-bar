import { describe, it, expect, beforeEach } from 'vitest';
import {
  demoFriends,
  findDemoFriend,
  topRatedBars,
  lovedCount,
  barById,
  SAMPLE_NIGHT,
  seedSampleNight,
  clearSampleNight,
  isDemoSeeded,
} from './index';
import { loadRatings, writeRatings } from '@/lib/ratings';

describe('demo friends data integrity', () => {
  it('every friend rating references a real bar', () => {
    for (const friend of demoFriends) {
      for (const r of friend.ratings) {
        expect(
          barById(r.barId),
          `${friend.handle} references unknown bar ${r.barId}`,
        ).toBeDefined();
      }
    }
  });

  it('every seeded score sits inside its tier band', () => {
    const all = [...demoFriends.flatMap((f) => f.ratings), ...SAMPLE_NIGHT];
    for (const r of all) {
      const score = r.score ?? -1;
      if (r.rating === 'loved') expect(score).toBeGreaterThanOrEqual(8.0);
      if (r.rating === 'liked')
        expect(score >= 5.0 && score < 8.0).toBe(true);
      if (r.rating === 'pass') expect(score).toBeLessThan(5.0);
    }
  });

  it('findDemoFriend is case-insensitive and returns undefined for unknown', () => {
    expect(findDemoFriend('MAYA')?.handle).toBe('maya');
    expect(findDemoFriend('nobody')).toBeUndefined();
  });
});

describe('topRatedBars / lovedCount', () => {
  const maya = findDemoFriend('maya')!;

  it('sorts a friend list high→low by score', () => {
    const top = topRatedBars(maya);
    const scores = top.map((t) => t.rating.score ?? 0);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
  });

  it('respects the limit', () => {
    expect(topRatedBars(maya, 3)).toHaveLength(3);
  });

  it('counts only loved entries', () => {
    const expected = maya.ratings.filter((r) => r.rating === 'loved').length;
    expect(lovedCount(maya)).toBe(expected);
  });
});

describe('sample-night seeder', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts unseeded and writes the sample night on seed', () => {
    expect(isDemoSeeded()).toBe(false);
    seedSampleNight();
    expect(isDemoSeeded()).toBe(true);
    const ratings = loadRatings();
    for (const r of SAMPLE_NIGHT) {
      expect(ratings.find((x) => x.barId === r.barId)?.score).toBe(r.score);
    }
  });

  it('preserves pre-existing ratings for other bars', () => {
    window.localStorage.setItem(
      'next-bar:ratings:v1',
      JSON.stringify([
        { barId: 'pier-a', rating: 'liked', ratedAt: '2026-05-01T00:00:00.000Z', score: 6.0 },
      ]),
    );
    seedSampleNight();
    const ratings = loadRatings();
    expect(ratings.find((r) => r.barId === 'pier-a')).toBeDefined();
    expect(ratings.length).toBe(SAMPLE_NIGHT.length + 1);
  });

  it('is idempotent — seeding twice does not duplicate', () => {
    seedSampleNight();
    seedSampleNight();
    expect(loadRatings().length).toBe(SAMPLE_NIGHT.length);
  });

  it('clearSampleNight removes seeded bars and resets the flag', () => {
    seedSampleNight();
    clearSampleNight();
    expect(isDemoSeeded()).toBe(false);
    const ratings = loadRatings();
    for (const r of SAMPLE_NIGHT) {
      expect(ratings.find((x) => x.barId === r.barId)).toBeUndefined();
    }
  });
});

describe('sample night is data-safe (regression: Codex-found HIGH data loss)', () => {
  beforeEach(() => window.localStorage.clear());

  it('seeding never overwrites a genuine rating; clearing never deletes it', () => {
    // A genuine user rating for death-and-co — a bar that ALSO appears in SAMPLE_NIGHT (at 9.2).
    writeRatings([
      { barId: 'death-and-co', rating: 'liked', ratedAt: '2026-01-01T00:00:00.000Z', score: 6.0 },
    ]);

    seedSampleNight();
    const afterSeed = loadRatings();
    expect(afterSeed.find((r) => r.barId === 'death-and-co')?.score).toBe(6.0); // NOT overwritten to 9.2
    expect(afterSeed.length).toBeGreaterThan(1); // other sample bars were added

    clearSampleNight();
    const afterClear = loadRatings();
    expect(afterClear.find((r) => r.barId === 'death-and-co')?.score).toBe(6.0); // genuine rating survives
    expect(afterClear.some((r) => r.barId === 'employees-only')).toBe(false); // pure-seed bar removed
  });

  it('is idempotent and clears back to empty on a fresh device', () => {
    seedSampleNight();
    const n = loadRatings().length;
    seedSampleNight(); // no-op once seeded
    expect(loadRatings().length).toBe(n);
    expect(isDemoSeeded()).toBe(true);
    clearSampleNight();
    expect(loadRatings().length).toBe(0);
    expect(isDemoSeeded()).toBe(false);
  });
});
