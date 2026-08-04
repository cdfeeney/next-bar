import { describe, expect, test } from 'vitest';
import {
  NIGHT_ROLLOVER_HOUR,
  SOCIAL_NIGHT_END_LABEL,
  relativeTimeLabel,
  socialNightEnd,
  socialNightKey,
} from '@/lib/socialNight';
import { nycNightKey } from '@/lib/nightKey';

describe('socialNightKey', () => {
  test('before 6am NYC the key is the previous date', () => {
    // 2026-08-04 05:30 EDT == 09:30 UTC
    expect(socialNightKey(new Date('2026-08-04T09:30:00Z'))).toBe('2026-08-03');
  });

  test('at exactly 6am NYC the key rolls to the new date', () => {
    // 2026-08-04 06:00 EDT == 10:00 UTC
    expect(socialNightKey(new Date('2026-08-04T10:00:00Z'))).toBe('2026-08-04');
  });

  test('evening belongs to its own date', () => {
    // 2026-08-03 22:00 EDT == 2026-08-04 02:00 UTC
    expect(socialNightKey(new Date('2026-08-04T02:00:00Z'))).toBe('2026-08-03');
  });

  test('winter (EST): 5:59am is last night, 6:00am is today', () => {
    // 2026-01-10 05:59 EST == 10:59 UTC
    expect(socialNightKey(new Date('2026-01-10T10:59:00Z'))).toBe('2026-01-09');
    expect(socialNightKey(new Date('2026-01-10T11:00:00Z'))).toBe('2026-01-10');
  });

  test('nightKey.ts re-export is the same function', () => {
    expect(nycNightKey).toBe(socialNightKey);
  });

  test('canonical rollover hour is 6', () => {
    expect(NIGHT_ROLLOVER_HOUR).toBe(6);
    expect(SOCIAL_NIGHT_END_LABEL).toBe('6:00 AM');
  });
});

describe('socialNightEnd', () => {
  test('summer night ends 6:00 EDT (UTC-4) the next morning', () => {
    const end = socialNightEnd('2026-08-03');
    expect(end.toISOString()).toBe('2026-08-04T10:00:00.000Z');
  });

  test('winter night ends 6:00 EST (UTC-5) the next morning', () => {
    const end = socialNightEnd('2026-01-09');
    expect(end.toISOString()).toBe('2026-01-10T11:00:00.000Z');
  });

  test('spring-forward night (2026-03-07 → Mar 8 DST start) ends 6:00 EDT', () => {
    // DST starts 2026-03-08 02:00 EST → 6am that morning is EDT (UTC-4).
    const end = socialNightEnd('2026-03-07');
    expect(end.toISOString()).toBe('2026-03-08T10:00:00.000Z');
  });

  test('fall-back night (2026-10-31 → Nov 1 DST end) ends 6:00 EST', () => {
    // DST ends 2026-11-01 02:00 EDT → 6am that morning is EST (UTC-5).
    const end = socialNightEnd('2026-10-31');
    expect(end.toISOString()).toBe('2026-11-01T11:00:00.000Z');
  });

  test('the end instant is exactly where the key rolls over', () => {
    const end = socialNightEnd('2026-08-03');
    const justBefore = new Date(end.getTime() - 1000);
    expect(socialNightKey(justBefore)).toBe('2026-08-03');
    expect(socialNightKey(end)).toBe('2026-08-04');
  });
});

describe('relativeTimeLabel', () => {
  const now = new Date('2026-08-04T04:00:00Z');

  test('under a minute reads "just now"', () => {
    expect(relativeTimeLabel('2026-08-04T03:59:30Z', now)).toBe('just now');
  });

  test('minutes', () => {
    expect(relativeTimeLabel('2026-08-04T03:35:00Z', now)).toBe('25 min ago');
  });

  test('hours', () => {
    expect(relativeTimeLabel('2026-08-04T01:10:00Z', now)).toBe('2 hr ago');
  });

  test('future timestamps clamp to "just now" (client clock skew)', () => {
    expect(relativeTimeLabel('2026-08-04T05:00:00Z', now)).toBe('just now');
  });

  test('unparseable input clamps to "just now"', () => {
    expect(relativeTimeLabel('not-a-date', now)).toBe('just now');
  });
});
