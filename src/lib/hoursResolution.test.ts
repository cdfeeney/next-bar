import { describe, expect, test } from 'vitest';
import type { WeeklyHours } from '@/types';
import {
  HOURS_STALE_AFTER_DAYS,
  demoteIfStale,
  isValidWeeklyHours,
  resolveHours,
  sameHours,
  type HoursCandidate,
} from '@/lib/hoursResolution';

const THU_EVE: WeeklyHours = { 4: [{ open: '17:00', close: '02:00' }] } as unknown as WeeklyHours;
const THU_EVE_COPY: WeeklyHours = { 4: [{ open: '17:00', close: '02:00' }] } as unknown as WeeklyHours;
const THU_DIFFERENT: WeeklyHours = { 4: [{ open: '16:00', close: '23:00' }] } as unknown as WeeklyHours;

const cand = (
  source: HoursCandidate['source'],
  hours: WeeklyHours,
  observedAt = '2026-07-28T00:00:00Z',
): HoursCandidate => ({ source, hours, observedAt });

describe('isValidWeeklyHours', () => {
  test('accepts a normal evening window', () => {
    expect(isValidWeeklyHours(THU_EVE)).toBe(true);
  });

  test('accepts an overnight window that crosses midnight', () => {
    expect(isValidWeeklyHours({ 5: [{ open: '21:00', close: '04:00' }] } as unknown as WeeklyHours)).toBe(true);
  });

  test('accepts a 24-hour venue expressed as 00:00-00:00', () => {
    expect(isValidWeeklyHours({ 3: [{ open: '00:00', close: '00:00' }] } as unknown as WeeklyHours)).toBe(true);
  });

  // The plausible-but-wrong scrape defences. A parser that reads "5-2" as
  // 05:00-02:00 instead of 17:00-02:00 must not reach the database.
  test('rejects impossible clock values', () => {
    expect(isValidWeeklyHours({ 1: [{ open: '25:00', close: '02:00' }] } as unknown as WeeklyHours)).toBe(false);
    expect(isValidWeeklyHours({ 1: [{ open: '12:60', close: '02:00' }] } as unknown as WeeklyHours)).toBe(false);
    expect(isValidWeeklyHours({ 1: [{ open: '5pm', close: '2am' }] } as unknown as WeeklyHours)).toBe(false);
  });

  test('rejects a day key outside 0-6', () => {
    expect(isValidWeeklyHours({ 9: [{ open: '17:00', close: '20:00' }] } as unknown as WeeklyHours)).toBe(false);
  });

  test('rejects an empty or malformed interval list', () => {
    expect(isValidWeeklyHours({ 2: [] } as unknown as WeeklyHours)).toBe(false);
    expect(isValidWeeklyHours({ 2: [{ open: '17:00' }] } as unknown as WeeklyHours)).toBe(false);
  });

  test('rejects hours with no days at all', () => {
    expect(isValidWeeklyHours({} as unknown as WeeklyHours)).toBe(false);
  });
});

describe('sameHours', () => {
  test('two sources that agree compare equal despite separate objects', () => {
    expect(sameHours(THU_EVE, THU_EVE_COPY)).toBe(true);
  });

  test('interval order does not matter', () => {
    const a = { 4: [{ open: '12:00', close: '15:00' }, { open: '17:00', close: '02:00' }] } as unknown as WeeklyHours;
    const b = { 4: [{ open: '17:00', close: '02:00' }, { open: '12:00', close: '15:00' }] } as unknown as WeeklyHours;
    expect(sameHours(a, b)).toBe(true);
  });

  test('different windows do not compare equal', () => {
    expect(sameHours(THU_EVE, THU_DIFFERENT)).toBe(false);
  });

  test('a missing day makes them different', () => {
    const withFri = { ...(THU_EVE as object), 5: [{ open: '17:00', close: '02:00' }] } as unknown as WeeklyHours;
    expect(sameHours(THU_EVE, withFri)).toBe(false);
  });
});

describe('resolveHours — the confidence ladder', () => {
  test('no candidates resolves to nothing', () => {
    expect(resolveHours([]).outcome).toBe('none');
  });

  // A single scrape is never enough to call something verified. This is the gap
  // GLM flagged: the DB constraint enforces source != google for a trust claim,
  // but nothing enforced that verification actually happened.
  test('ONE valid candidate is reported, never verified', () => {
    const r = resolveHours([cand('official_site', THU_EVE)]);
    expect(r.outcome).toBe('reported');
    if (r.outcome === 'reported') {
      expect(r.confidence).toBe('reported');
      expect(r.source).toBe('official_site');
    }
  });

  test('TWO independent sources that agree earn verified', () => {
    const r = resolveHours([cand('official_site', THU_EVE), cand('user', THU_EVE_COPY)]);
    expect(r.outcome).toBe('verified');
    if (r.outcome === 'verified') {
      expect(r.confidence).toBe('verified');
      expect(r.corroboratedBy).toEqual(['official_site', 'user']);
    }
  });

  test('two candidates from the SAME source are not independent corroboration', () => {
    const r = resolveHours([
      cand('official_site', THU_EVE),
      cand('official_site', THU_EVE_COPY),
    ]);
    expect(r.outcome).toBe('reported');
  });

  test('disagreement goes to a human and is never auto-published', () => {
    const r = resolveHours([cand('official_site', THU_EVE), cand('user', THU_DIFFERENT)]);
    expect(r.outcome).toBe('conflict');
  });

  test('invalid candidates are discarded before the ladder is applied', () => {
    const bad = cand('user', { 1: [{ open: '25:00', close: '02:00' }] } as unknown as WeeklyHours);
    const r = resolveHours([cand('official_site', THU_EVE), bad]);
    // The bad one must not count as disagreement, and must not corroborate.
    expect(r.outcome).toBe('reported');
    if (r.outcome === 'reported') expect(r.rejected).toEqual(['user']);
  });

  test('all candidates invalid resolves to nothing, not to reported', () => {
    const bad = cand('user', {} as unknown as WeeklyHours);
    expect(resolveHours([bad]).outcome).toBe('none');
  });

  // Google may be displayed live but must never enter the trust ladder. The
  // type forbids it; this asserts the runtime guard too, since scrapers are
  // fed from JSON that TypeScript cannot police.
  test('a google-sourced candidate is refused even if smuggled in at runtime', () => {
    const smuggled = { source: 'google', hours: THU_EVE, observedAt: '2026-07-28T00:00:00Z' } as unknown as HoursCandidate;
    const r = resolveHours([smuggled]);
    expect(r.outcome).toBe('none');
  });

  test('a majority of three agreeing beats one dissenter rather than conflicting', () => {
    const r = resolveHours([
      cand('official_site', THU_EVE),
      cand('user', THU_EVE_COPY),
      cand('venue', THU_DIFFERENT),
    ]);
    expect(r.outcome).toBe('verified');
    if (r.outcome === 'verified') expect(r.corroboratedBy).toEqual(['official_site', 'user']);
  });
});

describe('demoteIfStale', () => {
  const now = new Date('2026-07-28T00:00:00Z');

  test('fresh hours keep their confidence', () => {
    expect(demoteIfStale('reported', '2026-07-27T00:00:00Z', now)).toBe('reported');
    expect(demoteIfStale('verified', '2026-07-01T00:00:00Z', now)).toBe('verified');
  });

  // Staleness must demote WITHOUT a manual step, or the strict filter slowly
  // fills with hours nobody has checked in a year.
  test('past the threshold, any claim decays to unverified', () => {
    const old = new Date(now.getTime() - (HOURS_STALE_AFTER_DAYS + 1) * 86_400_000).toISOString();
    expect(demoteIfStale('reported', old, now)).toBe('unverified');
    expect(demoteIfStale('verified', old, now)).toBe('unverified');
  });

  test('a missing check date is treated as stale, not as fresh', () => {
    expect(demoteIfStale('verified', undefined, now)).toBe('unverified');
  });

  test('already-unverified stays unverified', () => {
    expect(demoteIfStale('unverified', '2026-07-27T00:00:00Z', now)).toBe('unverified');
  });
});
