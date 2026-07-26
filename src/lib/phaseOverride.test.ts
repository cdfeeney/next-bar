// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPhaseOverride,
  loadPhaseOverride,
  savePhaseOverride,
} from '@/lib/phaseOverride';

// Same night-boundary fixtures as vibeNightCache.test.ts — late-evening/
// next-morning pairs far from DST edges keep assertions timezone-stable.
const friday11pm = new Date('2026-07-24T23:30:00-04:00');
const saturday2am = new Date('2026-07-25T02:30:00-04:00'); // same night
const saturday9am = new Date('2026-07-25T09:00:00-04:00'); // after rollover

const KEY = 'next-bar:night-phase-override:v1';

describe('phaseOverride (E2.4 / R10+R11)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips within the same night, across the midnight boundary', () => {
    savePhaseOverride('out', friday11pm);
    expect(loadPhaseOverride(friday11pm)).toBe('out');
    expect(loadPhaseOverride(saturday2am)).toBe('out');
  });

  it('forgets at the rollover — a new night derives fresh', () => {
    savePhaseOverride('recap', friday11pm);
    expect(loadPhaseOverride(saturday9am)).toBeNull();
  });

  it('later choices overwrite earlier ones', () => {
    savePhaseOverride('planning', friday11pm);
    savePhaseOverride('out', saturday2am);
    expect(loadPhaseOverride(saturday2am)).toBe('out');
  });

  it('rejects an unknown phase value (membership validation)', () => {
    savePhaseOverride('out', friday11pm);
    const stored = JSON.parse(window.localStorage.getItem(KEY) as string) as {
      night: string;
      phase: string;
    };
    stored.phase = 'afterparty';
    window.localStorage.setItem(KEY, JSON.stringify(stored));
    expect(loadPhaseOverride(friday11pm)).toBeNull();
  });

  it('corrupt storage reads as no-override, never throws', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(loadPhaseOverride(friday11pm)).toBeNull();
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ night: 'garbage', phase: 42 }),
    );
    expect(loadPhaseOverride(friday11pm)).toBeNull();
  });

  it('clearPhaseOverride wipes the choice', () => {
    savePhaseOverride('planning', friday11pm);
    clearPhaseOverride();
    expect(loadPhaseOverride(friday11pm)).toBeNull();
  });
});
