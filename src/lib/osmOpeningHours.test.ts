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

  // Both of these came straight out of the live NYC sweep, where they accounted
  // for the large majority of refusals — 7 of the first 8 refused specs.

  test('tolerates a space after the comma in a day list (Sa, Su)', () => {
    const h = parseOsmOpeningHours('Sa, Su 13:00-04:00') as Record<string, unknown>;
    expect(Object.keys(h!).sort()).toEqual(['0', '6']);
    expect(h!['6']).toEqual([{ open: '13:00', close: '04:00' }]);
  });

  test('tolerates spaced day lists across several rules', () => {
    const h = parseOsmOpeningHours('Mo, Tu 16:30-01:00; Fr, Sa 16:00-04:00') as Record<string, unknown>;
    expect(Object.keys(h!).sort()).toEqual(['1', '2', '5', '6']);
  });

  // OSM writes end-of-day as 24:00. It is not a real clock reading, so it is
  // normalised to 00:00, which isOpenNow already reads as "closes at midnight"
  // via its overnight-window handling.
  test('accepts 24:00 as end-of-day and normalises it to 00:00', () => {
    const h = parseOsmOpeningHours('Mo-Su 17:00-24:00') as Record<string, unknown>;
    expect(h!['1']).toEqual([{ open: '17:00', close: '00:00' }]);
  });

  test('24:00 is only valid as a CLOSING time', () => {
    expect(parseOsmOpeningHours('Mo-Fr 24:00-04:00')).toBeNull();
  });

  // REVISED after the live sweep. These two originally asserted null, on my
  // initial assumption that 24:00 was a lone special case. It is not: OSM's
  // extended-time syntax runs to 48:00 for venues open past midnight, and real
  // NYC bars use it (Union Pool tags 14:00-28:00). Refusing it discarded correct
  // hours, so closing hours 24-47 now roll over to the next day.
  test('extended closing hours past midnight roll over', () => {
    const a = parseOsmOpeningHours('Mo-Fr 17:00-25:00') as Record<string, unknown>;
    expect(a!['1']).toEqual([{ open: '17:00', close: '01:00' }]);
    const b = parseOsmOpeningHours('Mo-Fr 17:00-24:30') as Record<string, unknown>;
    expect(b!['1']).toEqual([{ open: '17:00', close: '00:30' }]);
    const c = parseOsmOpeningHours('Sa,Su 14:00-28:00') as Record<string, unknown>;
    expect(c!['6']).toEqual([{ open: '14:00', close: '04:00' }]);
  });

  test('refuses hours beyond the 48:00 extended range, and bad minutes', () => {
    expect(parseOsmOpeningHours('Mo-Fr 17:00-48:00')).toBeNull();
    expect(parseOsmOpeningHours('Mo-Fr 17:00-99:00')).toBeNull();
    expect(parseOsmOpeningHours('Mo-Fr 17:00-26:75')).toBeNull();
  });

  // "11:30-04:00" with no day selector means every day. Common, unambiguous.
  test('a bare time span with no day selector applies to every day', () => {
    const h = parseOsmOpeningHours('11:30-04:00') as Record<string, unknown>;
    expect(Object.keys(h!).sort()).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    expect(h!['3']).toEqual([{ open: '11:30', close: '04:00' }]);
  });

  test('a bare span still combines with later day-specific overrides', () => {
    const h = parseOsmOpeningHours('11:30-04:00; Su off') as Record<string, unknown>;
    expect(h!['0']).toBeUndefined();
    expect(Object.keys(h!)).toHaveLength(6);
  });

  test('handles a real spec combining both quirks', () => {
    const h = parseOsmOpeningHours(
      'Mo-We 17:00-02:00; Th 17:00-04:00; Fr, Sa 16:00-04:00; Su 16:00-24:00',
    ) as Record<string, unknown>;
    expect(Object.keys(h!).sort()).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    expect(h!['0']).toEqual([{ open: '16:00', close: '00:00' }]);
    expect(h!['6']).toEqual([{ open: '16:00', close: '04:00' }]);
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

/**
 * Comma as a RULE separator — the largest remaining source of refusals in the
 * live NYC sweep (83 matched venues). Every spec here is real, taken verbatim
 * from `scripts/osm-hours-sweep.mts`'s refusal sample.
 *
 * The whole difficulty is that a comma means two different things:
 *   `Sa,Su 12:00-04:00`              — comma inside a DAY LIST
 *   `Mo-We 17:00-02:00, Th 17:00-03:00` — comma between two RULES
 *   `Su 12:00-16:00,17:00-02:00`     — comma between two SPANS of one rule
 * Getting this wrong silently invents hours, so the day-list case is asserted
 * right alongside the new one.
 */
describe('comma-separated rules (subset expansion)', () => {
  test('Bathtub Gin — rule commas, plus a two-window Sunday', () => {
    const hours = parseOsmOpeningHours(
      'Mo-We 17:00-02:00, Th 17:00-03:00, Fr 17:00-04:00, Sa 16:00-04:00, Su 12:00-16:00,17:00-02:00',
    );
    expect(hours).not.toBeNull();
    expect(hours![1]).toEqual([{ open: '17:00', close: '02:00' }]);
    expect(hours![3]).toEqual([{ open: '17:00', close: '02:00' }]);
    expect(hours![4]).toEqual([{ open: '17:00', close: '03:00' }]);
    expect(hours![5]).toEqual([{ open: '17:00', close: '04:00' }]);
    expect(hours![6]).toEqual([{ open: '16:00', close: '04:00' }]);
    // The trailing comma here separates SPANS, not rules.
    expect(hours![0]).toEqual([
      { open: '12:00', close: '16:00' },
      { open: '17:00', close: '02:00' },
    ]);
  });

  test('Magic Hour Rooftop', () => {
    const hours = parseOsmOpeningHours(
      'Mo-Th 16:00-02:00, Fr 16:00-04:00, Sa 11:30-04:00, Su 11:30-23:00',
    );
    expect(hours).not.toBeNull();
    expect(hours![1]).toEqual([{ open: '16:00', close: '02:00' }]);
    expect(hours![5]).toEqual([{ open: '16:00', close: '04:00' }]);
    expect(hours![6]).toEqual([{ open: '11:30', close: '04:00' }]);
    expect(hours![0]).toEqual([{ open: '11:30', close: '23:00' }]);
  });

  test('Tørst — a LATER rule overrides an earlier one for the same day', () => {
    // Fr appears in both `Mo-Fr` and `Fr-Sa`. OSM semantics: last wins.
    const hours = parseOsmOpeningHours(
      'Mo-Fr 15:00-24:00, Fr-Sa 12:00-01:00, Su 12:00-24:00',
    );
    expect(hours).not.toBeNull();
    expect(hours![1]).toEqual([{ open: '15:00', close: '00:00' }]);
    expect(hours![5]).toEqual([{ open: '12:00', close: '01:00' }]);
    expect(hours![6]).toEqual([{ open: '12:00', close: '01:00' }]);
  });

  test('Sunshine Laundromat and The Ten Bells', () => {
    const laundromat = parseOsmOpeningHours(
      'Mo 08:00-19:00, Tu-Fr 08:00-02:00, Sa-Su 07:00-02:00',
    );
    expect(laundromat).not.toBeNull();
    expect(laundromat![1]).toEqual([{ open: '08:00', close: '19:00' }]);
    expect(laundromat![2]).toEqual([{ open: '08:00', close: '02:00' }]);
    expect(laundromat![0]).toEqual([{ open: '07:00', close: '02:00' }]);

    const bells = parseOsmOpeningHours('Mo-Fr 17:00-02:00, Sa-Su 15:00-02:00');
    expect(bells).not.toBeNull();
    expect(bells![1]).toEqual([{ open: '17:00', close: '02:00' }]);
    expect(bells![6]).toEqual([{ open: '15:00', close: '02:00' }]);
  });

  test('a comma inside a DAY LIST is still a day list, not a new rule', () => {
    const hours = parseOsmOpeningHours('Sa,Su 12:00-04:00');
    expect(hours).not.toBeNull();
    expect(hours![6]).toEqual([{ open: '12:00', close: '04:00' }]);
    expect(hours![0]).toEqual([{ open: '12:00', close: '04:00' }]);
    // Monday must NOT have been invented.
    expect(hours![1]).toBeUndefined();

    const spaced = parseOsmOpeningHours('Sa, Su 13:00-04:00');
    expect(spaced).not.toBeNull();
    expect(spaced![6]).toEqual([{ open: '13:00', close: '04:00' }]);
    expect(spaced![0]).toEqual([{ open: '13:00', close: '04:00' }]);
    expect(spaced![1]).toBeUndefined();
  });

  test('a three-token day list followed by a rule comma', () => {
    const hours = parseOsmOpeningHours('Mo,Tu,We 17:00-23:00, Th-Sa 17:00-02:00');
    expect(hours).not.toBeNull();
    expect(hours![1]).toEqual([{ open: '17:00', close: '23:00' }]);
    expect(hours![3]).toEqual([{ open: '17:00', close: '23:00' }]);
    expect(hours![4]).toEqual([{ open: '17:00', close: '02:00' }]);
    expect(hours![6]).toEqual([{ open: '17:00', close: '02:00' }]);
    expect(hours![5]).toEqual([{ open: '17:00', close: '02:00' }]);
  });

  test('comma rules mixed with semicolon rules and an off marker', () => {
    const hours = parseOsmOpeningHours('Mo-We 17:00-02:00, Th-Sa 17:00-04:00; Su off');
    expect(hours).not.toBeNull();
    expect(hours![1]).toEqual([{ open: '17:00', close: '02:00' }]);
    expect(hours![4]).toEqual([{ open: '17:00', close: '04:00' }]);
    expect(hours![0]).toBeUndefined();
  });

  test('STILL REFUSES the open-ended `+` suffix rather than guessing', () => {
    // The Back Room. `02:00+` means "and possibly later" — reading it as a hard
    // 02:00 close would let the badge say CLOSED while the bar is open, which is
    // the one direction the open-now gate refuses to be wrong in.
    expect(
      parseOsmOpeningHours('Mo-We 18:00-02:00+;Th-Fr 18:00-03:00+;Su 18:00-02:00+'),
    ).toBeNull();
  });

  test('a malformed segment still fails the WHOLE spec closed', () => {
    expect(parseOsmOpeningHours('Mo-We 17:00-02:00, Th sometimes')).toBeNull();
    expect(parseOsmOpeningHours('Mo-We 17:00-02:00, Th 99:00-02:00')).toBeNull();
  });
});

describe('comma rules followed by a day LIST', () => {
  test('Lions Head Tavern — new rule opens with a bare day token', () => {
    // `Sa` alone cannot continue the completed `Mo-Fr 12:00-02:00`, so it must
    // begin the next rule's day list.
    const hours = parseOsmOpeningHours('Mo-Fr 12:00-02:00, Sa,Su 11:00-02:00');
    expect(hours).not.toBeNull();
    expect(hours![1]).toEqual([{ open: '12:00', close: '02:00' }]);
    expect(hours![5]).toEqual([{ open: '12:00', close: '02:00' }]);
    expect(hours![6]).toEqual([{ open: '11:00', close: '02:00' }]);
    expect(hours![0]).toEqual([{ open: '11:00', close: '02:00' }]);
  });

  test('a leading day list is still NOT split (regression guard)', () => {
    // Nothing precedes `Sa`, so there is no completed rule and no new rule.
    const hours = parseOsmOpeningHours('Sa,Su 12:00-04:00');
    expect(hours![6]).toEqual([{ open: '12:00', close: '04:00' }]);
    expect(hours![0]).toEqual([{ open: '12:00', close: '04:00' }]);
    expect(hours![1]).toBeUndefined();
  });
});
