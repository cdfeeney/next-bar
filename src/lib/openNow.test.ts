import { describe, it, expect } from 'vitest';
import { isOpenNow } from '@/lib/openNow';
import type { WeeklyHours } from '@/types';

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
