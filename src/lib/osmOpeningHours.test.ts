import { describe, expect, test } from 'vitest';
import { parseOsmOpeningHours } from '@/lib/osmOpeningHours';
import { isValidWeeklyHours, resolveHours } from '@/lib/hoursResolution';

/**
 * OSM's `opening_hours` grammar is far larger than anything we need. The parser
 * handles a conservative subset and returns null for everything else, so an
 * exotic spec becomes human review rather than a confident wrong answer.
 *
 * Day numbering matches WeeklyHours / JS getDay(): 0 = Sunday … 6 = Saturday.
 */

describe('parseOsmOpeningHours — supported subset', () => {
  test('24/7 opens every day', () => {
    const h = parseOsmOpeningHours('24/7') as Record<string, { open: string; close: string }[]>;
    expect(Object.keys(h!).sort()).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    expect(h!['3']).toEqual([{ open: '00:00', close: '00:00' }]);
  });

  test('a weekday range', () => {
    const h = parseOsmOpeningHours('Mo-Fr 17:00-02:00') as Record<string, unknown>;
    expect(Object.keys(h!).sort()).toEqual(['1', '2', '3', '4', '5']);
    expect(h!['1']).toEqual([{ open: '17:00', close: '02:00' }]);
  });

  test('a range that wraps the week boundary (Sa-Su)', () => {
    const h = parseOsmOpeningHours('Sa-Su 12:00-04:00') as Record<string, unknown>;
    expect(Object.keys(h!).sort()).toEqual(['0', '6']);
  });

  test('a comma list of days', () => {
    const h = parseOsmOpeningHours('Mo,We,Fr 18:00-23:00') as Record<string, unknown>;
    expect(Object.keys(h!).sort()).toEqual(['1', '3', '5']);
  });

  test('two windows in one day', () => {
    const h = parseOsmOpeningHours('Mo 12:00-15:00,17:00-23:00') as Record<string, unknown>;
    expect(h!['1']).toEqual([
      { open: '12:00', close: '15:00' },
      { open: '17:00', close: '23:00' },
    ]);
  });

  test('several rules combine', () => {
    const h = parseOsmOpeningHours('Mo-Th 17:00-01:00; Fr-Sa 17:00-03:00') as Record<string, unknown>;
    expect(Object.keys(h!).sort()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(h!['5']).toEqual([{ open: '17:00', close: '03:00' }]);
  });

  test('an explicit day off is respected and simply omitted', () => {
    const h = parseOsmOpeningHours('Mo-Sa 17:00-02:00; Su off') as Record<string, unknown>;
    expect(Object.keys(h!).sort()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(h!['0']).toBeUndefined();
  });

  // OSM semantics: a later rule OVERRIDES an earlier one for the same day.
  test('a later rule overrides an earlier one for the same day', () => {
    const h = parseOsmOpeningHours('Mo-Su 10:00-20:00; Su 12:00-18:00') as Record<string, unknown>;
    expect(h!['0']).toEqual([{ open: '12:00', close: '18:00' }]);
    expect(h!['1']).toEqual([{ open: '10:00', close: '20:00' }]);
  });

  test('a later "off" rule closes a day an earlier rule opened', () => {
    const h = parseOsmOpeningHours('Mo-Su 10:00-20:00; Mo off') as Record<string, unknown>;
    expect(h!['1']).toBeUndefined();
    expect(Object.keys(h!)).toHaveLength(6);
  });

  test('is case and whitespace tolerant', () => {
    const h = parseOsmOpeningHours('  mo-fr   17:00-02:00  ') as Record<string, unknown>;
    expect(Object.keys(h!).sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  // PH/SH are holiday selectors with no weekday meaning. Skipping them can only
  // ever overclaim "open" on a holiday, which is the safe direction here — the
  // same asymmetry the badge uses. Rejecting the whole spec instead would throw
  // away otherwise-good weekday hours.
  test('public/school holiday rules are skipped, not fatal', () => {
    const h = parseOsmOpeningHours('Mo-Fr 17:00-02:00; PH off') as Record<string, unknown>;
    expect(Object.keys(h!).sort()).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('parseOsmOpeningHours — refuses rather than guesses', () => {
  test.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['sunrise/sunset', 'Mo-Fr sunrise-sunset'],
    ['month range', 'Jan-Mar Mo-Fr 10:00-18:00'],
    ['week selector', 'week 1-10 Mo 10:00-12:00'],
    ['easter', 'easter -2 days off'],
    ['open-ended span', 'Mo-Fr 17:00+'],
    ['a comment in brackets', 'Mo-Fr 10:00-18:00 "by appointment"'],
    ['impossible clock', 'Mo-Fr 25:00-02:00'],
    ['minutes out of range', 'Mo-Fr 12:60-02:00'],
    ['unknown day token', 'Xx-Fr 10:00-18:00'],
    ['no time at all', 'Mo-Fr'],
    ['everything closed', 'Su off'],
    ['unparseable soup', 'sometimes when we feel like it'],
  ])('returns null for %s', (_label, spec) => {
    expect(parseOsmOpeningHours(spec)).toBeNull();
  });

  test('returns null for undefined input', () => {
    expect(parseOsmOpeningHours(undefined)).toBeNull();
  });

  // A spec whose SUPPORTED half is fine but which also contains something we do
  // not understand must fail closed — a partially-understood spec is exactly the
  // plausible-but-wrong case.
  test('a mixed spec with any unsupported rule fails closed', () => {
    expect(parseOsmOpeningHours('Mo-Fr 17:00-02:00; Jan Sa 10:00-12:00')).toBeNull();
  });
});

/**
 * The two halves of H3 have to compose: anything this parser emits must be
 * something the trust ladder will accept. If the parser could produce hours that
 * isValidWeeklyHours rejects, every OSM candidate would be silently discarded
 * downstream and the corroboration path would never fire.
 */
describe('composes with the hours trust ladder', () => {
  test.each([
    '24/7',
    'Mo-Fr 17:00-02:00',
    'Sa,Su 12:00-04:00',
    'Mo 12:00-15:00,17:00-23:00',
    'Mo-Th 17:00-01:00; Fr-Sa 17:00-03:00; Su off',
  ])('output of %s is valid to the ladder', (spec) => {
    const hours = parseOsmOpeningHours(spec);
    expect(hours).not.toBeNull();
    expect(isValidWeeklyHours(hours!)).toBe(true);
  });

  // OSM alone can only ever be `reported` — it is one source. It becomes the
  // corroborating half of a `verified` claim, never the whole of one.
  test('an OSM candidate on its own is reported, not verified', () => {
    const hours = parseOsmOpeningHours('Mo-Fr 17:00-02:00')!;
    const r = resolveHours([
      { source: 'osm', hours, observedAt: '2026-07-28T00:00:00Z' },
    ]);
    expect(r.outcome).toBe('reported');
  });

  test('OSM agreeing with the venue site earns verified', () => {
    const hours = parseOsmOpeningHours('Mo-Fr 17:00-02:00')!;
    const r = resolveHours([
      { source: 'osm', hours, observedAt: '2026-07-28T00:00:00Z' },
      { source: 'official_site', hours, observedAt: '2026-07-28T00:00:00Z' },
    ]);
    expect(r.outcome).toBe('verified');
    if (r.outcome === 'verified') expect(r.corroboratedBy).toEqual(['osm', 'official_site']);
  });
});
