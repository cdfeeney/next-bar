import { describe, it, expect } from 'vitest';
import { daysAgo, isFresh, formatVerified } from '@/lib/freshness';

describe('daysAgo', () => {
  it('returns 44 for 2026-04-01 when now is 2026-05-15', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    expect(daysAgo('2026-04-01', now)).toBe(44);
  });

  it('returns 0 when the date is today', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    expect(daysAgo('2026-05-15', now)).toBe(0);
  });

  it('returns 1 for yesterday', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    expect(daysAgo('2026-05-14', now)).toBe(1);
  });

  it('returns Infinity for an invalid date string', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    expect(daysAgo('not-a-date', now)).toBe(Infinity);
  });

  it('returns Infinity for an empty string', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    expect(daysAgo('', now)).toBe(Infinity);
  });
});

describe('isFresh', () => {
  const now = new Date('2026-05-15T12:00:00Z');

  it('returns true at exactly 90 days ago', () => {
    // 90 days before 2026-05-15 is 2026-02-14
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const iso = ninetyDaysAgo.toISOString().slice(0, 10);
    expect(isFresh(iso, now)).toBe(true);
  });

  it('returns true at 89 days ago', () => {
    const eightyNineDaysAgo = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000);
    const iso = eightyNineDaysAgo.toISOString().slice(0, 10);
    expect(isFresh(iso, now)).toBe(true);
  });

  it('returns false at 91 days ago', () => {
    const ninetyOneDaysAgo = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
    const iso = ninetyOneDaysAgo.toISOString().slice(0, 10);
    expect(isFresh(iso, now)).toBe(false);
  });

  it('returns false for a date 180 days ago', () => {
    const oneEightyDaysAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    const iso = oneEightyDaysAgo.toISOString().slice(0, 10);
    expect(isFresh(iso, now)).toBe(false);
  });
});

describe('formatVerified', () => {
  it('returns "Apr 2026" for 2026-04-15 (mid-month, timezone-safe)', () => {
    // Use mid-month date to avoid UTC-midnight timezone roll-back
    expect(formatVerified('2026-04-15')).toBe('Apr 2026');
  });

  it('returns "Jan 2025" for 2025-01-15', () => {
    expect(formatVerified('2025-01-15')).toBe('Jan 2025');
  });

  it('returns "unknown" for an invalid date string', () => {
    expect(formatVerified('not-a-date')).toBe('unknown');
  });

  it('returns "unknown" for an empty string', () => {
    expect(formatVerified('')).toBe('unknown');
  });
});
