import { describe, it, expect } from 'vitest';
import {
  excludeClosedBars,
  isOpenNow,
  opensSoon,
  todayHoursLine,
  weekHoursRows,
} from '@/lib/openNow';
import type { Bar, WeeklyHours } from '@/types';

// All fixtures use January 2026 dates so NYC is on EST (UTC-5), keeping the
// UTC↔NYC conversion unambiguous. 2026-01-15 is a Thursday (day 4).
// NYC time = UTC - 5h in January.

describe('isOpenNow', () => {
  it('returns null when hours are unknown', () => {
    expect(isOpenNow(undefined, new Date('2026-01-15T20:00:00Z'))).toBeNull();
  });

  const dinnerOnly: WeeklyHours = { 4: [{ open: '17:00', close: '02:00' }] }; // Thu 5pm–2am (overnight)

  it('is closed before opening time', () => {
    // NYC Thu 15:00 (3pm) — before the 5pm open.
    expect(isOpenNow(dinnerOnly, new Date('2026-01-15T20:00:00Z'))).toBe(false);
  });

  it('is open in the evening portion of an overnight window', () => {
    // NYC Thu 19:00 (7pm).
    expect(isOpenNow(dinnerOnly, new Date('2026-01-16T00:00:00Z'))).toBe(true);
  });

  it('is open in the early-morning portion of the prior day\'s overnight window', () => {
    // NYC Fri 01:00 — still inside Thursday's 5pm–2am window.
    expect(isOpenNow(dinnerOnly, new Date('2026-01-16T06:00:00Z'))).toBe(true);
  });

  it('is closed after an overnight window ends', () => {
    // NYC Fri 03:00 — past the 2am close, and Friday itself has no hours.
    expect(isOpenNow(dinnerOnly, new Date('2026-01-16T08:00:00Z'))).toBe(false);
  });

  const sameDay: WeeklyHours = { 1: [{ open: '12:00', close: '18:00' }] }; // Mon noon–6pm

  it('is open inside a same-day window and closed outside it', () => {
    // 2026-01-19 is a Monday (day 1).
    expect(isOpenNow(sameDay, new Date('2026-01-19T19:00:00Z'))).toBe(true); // NYC Mon 14:00
    expect(isOpenNow(sameDay, new Date('2026-01-20T01:00:00Z'))).toBe(false); // NYC Mon 20:00
  });

  const splitDay: WeeklyHours = {
    5: [{ open: '11:00', close: '15:00' }, { open: '17:00', close: '23:00' }], // Fri lunch + dinner
  };

  it('handles multiple windows in one day (open during, closed in the gap)', () => {
    // 2026-01-16 is a Friday (day 5).
    expect(isOpenNow(splitDay, new Date('2026-01-16T17:00:00Z'))).toBe(true); // NYC Fri 12:00 (lunch)
    expect(isOpenNow(splitDay, new Date('2026-01-16T21:00:00Z'))).toBe(false); // NYC Fri 16:00 (gap)
    expect(isOpenNow(splitDay, new Date('2026-01-16T23:00:00Z'))).toBe(true); // NYC Fri 18:00 (dinner)
  });

  it('treats a day with no entry as closed', () => {
    // Sunday (day 0) has no hours in dinnerOnly.
    expect(isOpenNow(dinnerOnly, new Date('2026-01-18T20:00:00Z'))).toBe(false); // NYC Sun 15:00
  });
});

describe('todayHoursLine (U2-1)', () => {
  // Bar open 17:00–02:00 Fri (overnight) and 17:00–00:00 Thu.
  const HOURS = {
    4: [{ open: '17:00', close: '00:00' }],
    5: [{ open: '17:00', close: '02:00' }],
  } as unknown as import('@/types').WeeklyHours;

  // Helpers construct NY-local times via explicit offsets (EDT = UTC-4).
  const nyc = (iso: string) => new Date(iso);

  it('before opening: "Opens 5 PM"', () => {
    expect(todayHoursLine(HOURS, nyc('2026-07-24T14:00:00-04:00'))).toBe('Opens 5 PM');
  });

  it('while open: "Open · until 2 AM"', () => {
    expect(todayHoursLine(HOURS, nyc('2026-07-24T22:00:00-04:00'))).toBe('Open · until 2 AM');
  });

  it("in the overnight tail (1 AM Sat) still shows Friday's close", () => {
    expect(todayHoursLine(HOURS, nyc('2026-07-25T01:00:00-04:00'))).toBe('Open · until 2 AM');
  });

  it('day with no windows: "Closed today"', () => {
    expect(todayHoursLine(HOURS, nyc('2026-07-20T20:00:00-04:00'))).toBe('Closed today');
  });

  it('before/after the overnight boundary resolves to the correct window', () => {
    expect(todayHoursLine(HOURS, nyc('2026-07-23T23:30:00-04:00'))).toBe('Open · until midnight');
    expect(todayHoursLine(HOURS, nyc('2026-07-24T03:00:00-04:00'))).toBe('Opens 5 PM');
  });

  it('unknown hours → null (never guess)', () => {
    expect(todayHoursLine(undefined, new Date())).toBeNull();
  });
});

describe('weekHoursRows (U2-1)', () => {
  const HOURS = {
    4: [{ open: '17:00', close: '00:00' }],
    5: [{ open: '17:00', close: '02:00' }],
  } as unknown as import('@/types').WeeklyHours;

  it('renders Monday-first with Closed gaps and marks today', () => {
    const rows = weekHoursRows(HOURS, new Date('2026-07-24T22:00:00-04:00'));
    expect(rows).not.toBeNull();
    expect(rows!.map((r) => r.day)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(rows![3]).toEqual({ day: 'Thu', hours: '5 PM – midnight', isToday: false });
    expect(rows![4]).toEqual({ day: 'Fri', hours: '5 PM – 2 AM', isToday: true });
    expect(rows![0].hours).toBe('Closed');
  });

  it('null for unknown hours', () => {
    expect(weekHoursRows(undefined, new Date())).toBeNull();
  });
});

describe('todayHoursLine — DeepSeek review fixes', () => {
  it('24-hour encoding (open === close) reads "Open 24 hours", never "until midnight"', () => {
    const ALL_DAY = {
      5: [{ open: '00:00', close: '00:00' }],
    } as unknown as import('@/types').WeeklyHours;
    expect(todayHoursLine(ALL_DAY, new Date('2026-07-24T22:00:00-04:00'))).toBe(
      'Open 24 hours',
    );
    const rows = weekHoursRows(ALL_DAY, new Date('2026-07-24T22:00:00-04:00'));
    expect(rows!.find((r) => r.day === 'Fri')!.hours).toBe('Open 24 hours');
  });

  it('"opens tomorrow" only when tomorrow actually has windows', () => {
    // Saturday windows only: after close on Saturday night... use a bar
    // open Thu only — checked on Thu after close, Fri has no windows.
    const THU_ONLY = {
      4: [{ open: '12:00', close: '14:00' }],
    } as unknown as import('@/types').WeeklyHours;
    // Thursday 20:00 — after close, Friday empty → plain "Closed".
    expect(todayHoursLine(THU_ONLY, new Date('2026-07-23T20:00:00-04:00'))).toBe(
      'Closed',
    );
    // Wednesday 20:00 — no windows today, tomorrow (Thu) has some.
    const WED_THU = {
      3: [{ open: '12:00', close: '14:00' }],
      4: [{ open: '12:00', close: '14:00' }],
    } as unknown as import('@/types').WeeklyHours;
    expect(todayHoursLine(WED_THU, new Date('2026-07-22T20:00:00-04:00'))).toBe(
      'Closed · opens tomorrow',
    );
  });
});

describe('excludeClosedBars (E3.3 hard filter)', () => {
  const makeBar = (overrides: Partial<Bar> & { id: string }): Bar =>
    ({
      name: overrides.id,
      neighborhood: 'LES',
      address: '1 Test St',
      lat: 40.72,
      lng: -73.99,
      tags: ['dive'],
      priceTier: 1,
      blurb: 'test',
      lastVerified: '2026-04-01',
      ...overrides,
    }) as Bar;

  // Thu 5pm–2am overnight bar; NYC Thu 19:00 = open, NYC Thu 15:00 = closed.
  const THU_NIGHT: WeeklyHours = {
    4: [{ open: '17:00', close: '02:00' }],
  } as unknown as WeeklyHours;
  const OPEN_AT = new Date('2026-01-16T00:00:00Z'); // NYC Thu 7pm
  const CLOSED_AT = new Date('2026-01-15T20:00:00Z'); // NYC Thu 3pm

  it('drops KNOWN-closed bars, keeps open ones', () => {
    const bars = [
      makeBar({ id: 'open-bar', hours: THU_NIGHT }),
      makeBar({ id: 'closed-bar', hours: THU_NIGHT }),
    ];
    expect(excludeClosedBars(bars, OPEN_AT).map((b) => b.id)).toEqual([
      'open-bar',
      'closed-bar',
    ]);
    expect(excludeClosedBars(bars, CLOSED_AT)).toEqual([]);
  });

  it('no-hours bars ALWAYS stay — unknown never reads as closed', () => {
    const bars = [makeBar({ id: 'no-hours' })];
    expect(excludeClosedBars(bars, CLOSED_AT).map((b) => b.id)).toEqual([
      'no-hours',
    ]);
  });

  it("keeps the morning tail of yesterday's overnight window", () => {
    const bars = [makeBar({ id: 'late-bar', hours: THU_NIGHT })];
    // NYC Fri 01:00 — still inside Thursday's 5pm–2am window.
    expect(
      excludeClosedBars(bars, new Date('2026-01-16T06:00:00Z')).map((b) => b.id),
    ).toEqual(['late-bar']);
    // NYC Fri 03:00 — past close.
    expect(excludeClosedBars(bars, new Date('2026-01-16T08:00:00Z'))).toEqual([]);
  });

  it('drops permanently-closed bars regardless of hours', () => {
    const bars = [
      makeBar({
        id: 'gone-bar',
        hours: THU_NIGHT,
        businessStatus: 'CLOSED_PERMANENTLY',
      }),
    ];
    expect(excludeClosedBars(bars, OPEN_AT)).toEqual([]);
  });

  describe('opens-soon window (operator 2026-07-26: day drinkers search before doors)', () => {
    // NYC Thu 16:15 — 45min before the 5pm open; Thu 13:00 — 4h before.
    const T_MINUS_45 = new Date('2026-01-15T21:15:00Z');
    const T_MINUS_4H = new Date('2026-01-15T18:00:00Z');
    const bar = makeBar({ id: 'happy-hour-soon', hours: THU_NIGHT });

    it('keeps a closed bar opening within the window; still drops one hours away', () => {
      expect(excludeClosedBars([bar], T_MINUS_45, 60).map((b) => b.id)).toEqual([
        'happy-hour-soon',
      ]);
      expect(excludeClosedBars([bar], T_MINUS_4H, 60)).toEqual([]);
      // Default window 0 keeps the strict pre-refinement behavior.
      expect(excludeClosedBars([bar], T_MINUS_45)).toEqual([]);
    });

    it('lookahead crosses midnight into tomorrow’s early windows', () => {
      // Fri opens 00:15 (i.e. Friday's day array); checked Thu 23:30 NYC.
      const lateOpener = makeBar({
        id: 'after-midnight',
        hours: { 5: [{ open: '00:15', close: '04:00' }] } as unknown as WeeklyHours,
      });
      const thu1130pm = new Date('2026-01-16T04:30:00Z'); // NYC Thu 23:30
      expect(
        excludeClosedBars([lateOpener], thu1130pm, 60).map((b) => b.id),
      ).toEqual(['after-midnight']);
      // Opening 01:30 — beyond the hour — still drops.
      const laterOpener = makeBar({
        id: 'way-later',
        hours: { 5: [{ open: '01:30', close: '04:00' }] } as unknown as WeeklyHours,
      });
      expect(excludeClosedBars([laterOpener], thu1130pm, 60)).toEqual([]);
    });

    it('opensSoon is false for unknown hours and for already-open bars', () => {
      expect(opensSoon(undefined, T_MINUS_45, 60)).toBe(false);
      // Open right now: not "opening soon" (the filter never asks, but the
      // primitive stays honest).
      expect(opensSoon(THU_NIGHT, OPEN_AT, 60)).toBe(false);
    });
  });
});
