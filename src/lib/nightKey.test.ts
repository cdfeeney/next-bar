import { describe, expect, it } from 'vitest';
import { nycNightKey, nycNightDay } from '@/lib/nightKey';

/**
 * The ONE night definition, pinned directly.
 *
 * Every instant here is ABSOLUTE (Z). That is the point of the file: the
 * rollover is defined in America/New_York, so a local-time literal like
 * '2026-07-24T21:00:00' names a different NYC wall clock on every runner and
 * would make these assertions machine-dependent. The old cadence.ts and
 * intent.ts rollovers were *local*-hour rules, which is exactly the class of
 * bug this module exists to end.
 *
 * The two windows below are the ones that actually broke things in review:
 *   - 9pm NYC, where UTC has ALREADY rolled to tomorrow (migration 0053: a
 *     `current_date` comparison marked tonight's invite expired from 8pm on).
 *   - midnight–6am NYC, where the night key must still name YESTERDAY.
 *
 * Summer is EDT (UTC-4), winter EST (UTC-5); each case notes its NYC clock.
 */

describe('nycNightKey', () => {
  // 2026-07-24 is a Friday.
  it('names tonight at 9pm NYC, when UTC has already rolled over', () => {
    // Fri 9pm EDT = Sat 01:00Z. The UTC date is already the 25th; the NIGHT
    // is still Friday the 24th. This is the 0053 defect in one assertion.
    expect(nycNightKey(new Date('2026-07-25T01:00:00Z'))).toBe('2026-07-24');
  });

  it('still names yesterday through the midnight-6am window', () => {
    // Sat 12:01am EDT — one minute past midnight, still Friday night.
    expect(nycNightKey(new Date('2026-07-25T04:01:00Z'))).toBe('2026-07-24');
    // Sat 3am EDT — the middle of the small hours.
    expect(nycNightKey(new Date('2026-07-25T07:00:00Z'))).toBe('2026-07-24');
    // Sat 5:59am EDT — the last minute of Friday night.
    expect(nycNightKey(new Date('2026-07-25T09:59:00Z'))).toBe('2026-07-24');
  });

  it('rolls to the new night exactly at 6am NYC', () => {
    expect(nycNightKey(new Date('2026-07-25T10:00:00Z'))).toBe('2026-07-25');
  });

  it('holds the boundary across DST, where a fixed UTC offset would drift', () => {
    // Winter is EST (UTC-5), so the 6am boundary sits at 11:00Z, not 10:00Z.
    // A rule hardcoded to the summer offset would roll an hour early here.
    // Sat 2026-01-24 5:59am EST — still Friday night.
    expect(nycNightKey(new Date('2026-01-24T10:59:00Z'))).toBe('2026-01-23');
    // Sat 2026-01-24 6:00am EST — Saturday.
    expect(nycNightKey(new Date('2026-01-24T11:00:00Z'))).toBe('2026-01-24');
  });
});

describe('nycNightDay', () => {
  it('reports the NIGHT weekday, not the calendar weekday', () => {
    // Sat 1am NYC belongs to Friday night → 5 (Friday), not 6 (Saturday).
    expect(nycNightDay(new Date('2026-07-25T05:00:00Z'))).toBe(5);
    // Fri 9pm NYC is Friday night, even though UTC already says Saturday.
    expect(nycNightDay(new Date('2026-07-25T01:00:00Z'))).toBe(5);
  });

  it('agrees with nycNightKey for the same instant', () => {
    // Guards the getUTCDay/getDay trap: nycNight() is a UTC-midnight Date, so
    // reading it with getDay() would report the PREVIOUS day west of UTC.
    const at = new Date('2026-07-25T05:00:00Z');
    const [y, m, d] = nycNightKey(at).split('-').map(Number);
    expect(nycNightDay(at)).toBe(new Date(Date.UTC(y, m - 1, d)).getUTCDay());
  });
});
