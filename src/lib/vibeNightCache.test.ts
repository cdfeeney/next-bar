// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearNightVibe,
  loadNightVibe,
  saveNightVibe,
} from '@/lib/vibeNightCache';

// Times chosen around the 6am NYC rollover nycNightKey implements.
// (Tests run with jsdom local time; nycNightKey converts via
// America/New_York — using late-evening/next-morning pairs far from
// DST edges keeps the assertions timezone-stable.)
const friday11pm = new Date('2026-07-24T23:30:00-04:00');
const saturday2am = new Date('2026-07-25T02:30:00-04:00'); // same night
const saturday9am = new Date('2026-07-25T09:00:00-04:00'); // after rollover

describe('vibeNightCache (E2.2 / R11)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips a pick within the same night, across the midnight boundary', () => {
    saveNightVibe(['cocktail', 'chill'], friday11pm);
    expect(loadNightVibe(friday11pm)).toEqual(['cocktail', 'chill']);
    // 2:30am belongs to the SAME night (6am rollover).
    expect(loadNightVibe(saturday2am)).toEqual(['cocktail', 'chill']);
  });

  it('forgets at the rollover — a new night starts clean', () => {
    saveNightVibe(['dive', 'loud'], friday11pm);
    expect(loadNightVibe(saturday9am)).toBeNull();
  });

  it('later picks overwrite earlier ones (never locks)', () => {
    saveNightVibe(['cocktail'], friday11pm);
    saveNightVibe(['beer', 'pub'], saturday2am);
    expect(loadNightVibe(saturday2am)).toEqual(['beer', 'pub']);
  });

  it('filters unknown tags out of a cached pick (membership validation)', () => {
    // Write a real pick, then corrupt its tag list in place.
    saveNightVibe(['cocktail'], friday11pm);
    const stored = JSON.parse(
      window.localStorage.getItem('next-bar:night-vibe:v1') as string,
    ) as { night: string; tags: string[] };
    stored.tags = ['cocktail', 'zombie-tag', 'jazz'];
    window.localStorage.setItem('next-bar:night-vibe:v1', JSON.stringify(stored));

    // The garbage member vanishes; the valid remainder survives.
    expect(loadNightVibe(friday11pm)).toEqual(['cocktail', 'jazz']);
  });

  it('corrupt storage reads as no-pick, never throws', () => {
    window.localStorage.setItem('next-bar:night-vibe:v1', '{not json');
    expect(loadNightVibe(friday11pm)).toBeNull();
    window.localStorage.setItem(
      'next-bar:night-vibe:v1',
      JSON.stringify({ night: 'garbage', tags: 'nope' }),
    );
    expect(loadNightVibe(friday11pm)).toBeNull();
  });

  it('clearNightVibe wipes the pick', () => {
    saveNightVibe(['jazz'], friday11pm);
    clearNightVibe();
    expect(loadNightVibe(friday11pm)).toBeNull();
  });
});
