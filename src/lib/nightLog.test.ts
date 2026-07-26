// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  assembleNight,
  clearNightLog,
  loadNightVisits,
  recordVisit,
} from '@/lib/nightLog';
import { nycNightKey } from '@/lib/nightKey';

// Same night-boundary fixtures as vibeNightCache.test.ts — explicit
// offsets keep the 6am NYC rollover assertions timezone-stable.
const friday11pm = new Date('2026-07-24T23:30:00-04:00');
const saturday1am = new Date('2026-07-25T01:30:00-04:00'); // same night
const saturday9am = new Date('2026-07-25T09:00:00-04:00'); // after rollover
const saturday11pm = new Date('2026-07-25T23:00:00-04:00'); // next night

const FRI_NIGHT = nycNightKey(friday11pm);
const SAT_NIGHT = nycNightKey(saturday11pm);

const LOG_KEY = 'next-bar:night-log:v1';
const RATINGS_KEY = 'next-bar:ratings:v1';

describe('nightLog (E4.1)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('records visits in order across the midnight boundary of one night', () => {
    recordVisit('attaboy', friday11pm);
    recordVisit('mister-paradise', saturday1am);
    expect(loadNightVisits(FRI_NIGHT).map((v) => v.barId)).toEqual([
      'attaboy',
      'mister-paradise',
    ]);
  });

  it('dedups consecutive re-picks of the same bar, but not a return visit', () => {
    recordVisit('attaboy', friday11pm);
    recordVisit('attaboy', friday11pm); // re-search from the same bar
    recordVisit('mister-paradise', saturday1am);
    recordVisit('attaboy', saturday1am); // went BACK — that's a real visit
    expect(loadNightVisits(FRI_NIGHT).map((v) => v.barId)).toEqual([
      'attaboy',
      'mister-paradise',
      'attaboy',
    ]);
  });

  it("tonight's first visit replaces last night's log; yesterday reads empty after that", () => {
    recordVisit('attaboy', friday11pm);
    recordVisit('sisters', saturday11pm);
    expect(loadNightVisits(SAT_NIGHT).map((v) => v.barId)).toEqual(['sisters']);
    expect(loadNightVisits(FRI_NIGHT)).toEqual([]);
  });

  it("last night's log stays readable the MORNING after (recap window)", () => {
    recordVisit('attaboy', friday11pm);
    // Saturday 9am: nothing new recorded yet — Friday's record survives.
    expect(loadNightVisits(FRI_NIGHT).map((v) => v.barId)).toEqual(['attaboy']);
    expect(loadNightVisits(nycNightKey(saturday9am))).toEqual([]);
  });

  it('refuses synthetic free-text seeds', () => {
    recordVisit('synthetic:1753500000000', friday11pm);
    expect(loadNightVisits(FRI_NIGHT)).toEqual([]);
  });

  it('caps a degenerate night at 20 visits without evicting the start', () => {
    for (let i = 0; i < 25; i++) {
      recordVisit(`bar-${i}`, friday11pm);
    }
    const visits = loadNightVisits(FRI_NIGHT);
    expect(visits).toHaveLength(20);
    expect(visits[0].barId).toBe('bar-0');
    expect(visits[19].barId).toBe('bar-19');
  });

  it('corrupt storage reads as empty and recovers on the next write', () => {
    window.localStorage.setItem(LOG_KEY, '{not json');
    expect(loadNightVisits(FRI_NIGHT)).toEqual([]);
    recordVisit('attaboy', friday11pm);
    expect(loadNightVisits(FRI_NIGHT).map((v) => v.barId)).toEqual(['attaboy']);
    // Malformed entries inside an otherwise-valid log are filtered out.
    window.localStorage.setItem(
      LOG_KEY,
      JSON.stringify({ night: FRI_NIGHT, visits: [{ barId: 'ok', at: 'now' }, { nope: 1 }, 42] }),
    );
    expect(loadNightVisits(FRI_NIGHT).map((v) => v.barId)).toEqual(['ok']);
  });

  it('assembleNight joins visits with that night\'s ratings only', () => {
    recordVisit('attaboy', friday11pm);
    recordVisit('mister-paradise', saturday1am);
    window.localStorage.setItem(
      RATINGS_KEY,
      JSON.stringify([
        { barId: 'attaboy', rating: 'loved', ratedAt: '2026-07-25T01:45:00-04:00' }, // same night
        { barId: 'old-bar', rating: 'liked', ratedAt: '2026-07-20T22:00:00-04:00' }, // earlier week
        { barId: 'bad-date', rating: 'pass', ratedAt: 'garbage' }, // unparseable — dropped
      ]),
    );
    const night = assembleNight(FRI_NIGHT);
    expect(night.visits.map((v) => v.barId)).toEqual(['attaboy', 'mister-paradise']);
    expect(night.ratings.map((r) => r.barId)).toEqual(['attaboy']);
    expect(night.nightKey).toBe(FRI_NIGHT);
  });

  it('clearNightLog wipes the record', () => {
    recordVisit('attaboy', friday11pm);
    clearNightLog();
    expect(loadNightVisits(FRI_NIGHT)).toEqual([]);
  });
});
