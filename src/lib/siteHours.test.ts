import { describe, expect, test } from 'vitest';
import { parseSiteHours } from '@/lib/siteHours';
import { isValidWeeklyHours } from '@/lib/hoursResolution';

const ld = (json: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head><body></body></html>`;

describe('parseSiteHours — tier 1, schema.org openingHoursSpecification', () => {
  test('a single spec with a dayOfWeek array', () => {
    const r = parseSiteHours(
      ld({
        '@type': 'BarOrPub',
        openingHoursSpecification: [
          {
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: ['Monday', 'Tuesday'],
            opens: '17:00',
            closes: '02:00',
          },
        ],
      }),
    );
    expect(r.outcome).toBe('parsed');
    if (r.outcome === 'parsed') {
      expect(r.tier).toBe('jsonld');
      const h = r.hours as unknown as Record<string, unknown>;
      expect(Object.keys(h).sort()).toEqual(['1', '2']);
      expect(h['1']).toEqual([{ open: '17:00', close: '02:00' }]);
    }
  });

  test('accepts schema.org day URLs and HH:MM:SS times', () => {
    const r = parseSiteHours(
      ld({
        openingHoursSpecification: {
          dayOfWeek: 'https://schema.org/Saturday',
          opens: '16:00:00',
          closes: '04:00:00',
        },
      }),
    );
    expect(r.outcome).toBe('parsed');
    if (r.outcome === 'parsed') {
      expect((r.hours as unknown as Record<string, unknown>)['6']).toEqual([
        { open: '16:00', close: '04:00' },
      ]);
    }
  });

  test('finds the venue inside an @graph', () => {
    const r = parseSiteHours(
      ld({
        '@graph': [
          { '@type': 'WebSite', name: 'irrelevant' },
          {
            '@type': 'Restaurant',
            openingHoursSpecification: [
              { dayOfWeek: 'Friday', opens: '17:00', closes: '03:00' },
            ],
          },
        ],
      }),
    );
    expect(r.outcome).toBe('parsed');
  });

  test('merges several specs into one week', () => {
    const r = parseSiteHours(
      ld({
        openingHoursSpecification: [
          { dayOfWeek: ['Monday'], opens: '12:00', closes: '15:00' },
          { dayOfWeek: ['Monday'], opens: '17:00', closes: '23:00' },
          { dayOfWeek: ['Sunday'], opens: '14:00', closes: '22:00' },
        ],
      }),
    );
    expect(r.outcome).toBe('parsed');
    if (r.outcome === 'parsed') {
      const h = r.hours as unknown as Record<string, unknown>;
      expect(h['1']).toEqual([
        { open: '12:00', close: '15:00' },
        { open: '17:00', close: '23:00' },
      ]);
      expect(Object.keys(h).sort()).toEqual(['0', '1']);
    }
  });

  test('a closed day is omitted rather than written as zero hours', () => {
    const r = parseSiteHours(
      ld({
        openingHoursSpecification: [
          { dayOfWeek: 'Monday', opens: '17:00', closes: '02:00' },
          { dayOfWeek: 'Tuesday', opens: '00:00', closes: '00:00', closed: true },
        ],
      }),
    );
    expect(r.outcome).toBe('parsed');
    if (r.outcome === 'parsed') {
      expect(Object.keys(r.hours as unknown as Record<string, unknown>)).toEqual(['1']);
    }
  });
});

describe('parseSiteHours — tier 2, schema.org openingHours text form', () => {
  // Same grammar as OSM, so it reuses the parser already proven against 1,265
  // real venues rather than growing a second dialect.
  test('an openingHours string array', () => {
    const r = parseSiteHours(ld({ '@type': 'Bar', openingHours: ['Mo-Fr 17:00-02:00'] }));
    expect(r.outcome).toBe('parsed');
    if (r.outcome === 'parsed') {
      expect(r.tier).toBe('schema-text');
      expect(Object.keys(r.hours as unknown as Record<string, unknown>).sort()).toEqual([
        '1', '2', '3', '4', '5',
      ]);
    }
  });

  test('a single openingHours string', () => {
    const r = parseSiteHours(ld({ openingHours: 'Sa,Su 14:00-28:00' }));
    expect(r.outcome).toBe('parsed');
    if (r.outcome === 'parsed') {
      expect((r.hours as unknown as Record<string, unknown>)['6']).toEqual([
        { open: '14:00', close: '04:00' },
      ]);
    }
  });

  test('tier 1 wins when a page offers both', () => {
    const r = parseSiteHours(
      ld({
        openingHours: 'Mo-Su 09:00-10:00',
        openingHoursSpecification: [{ dayOfWeek: 'Monday', opens: '17:00', closes: '02:00' }],
      }),
    );
    expect(r.outcome).toBe('parsed');
    if (r.outcome === 'parsed') {
      expect(r.tier).toBe('jsonld');
      expect((r.hours as unknown as Record<string, unknown>)['1']).toEqual([
        { open: '17:00', close: '02:00' },
      ]);
    }
  });
});

describe('parseSiteHours — refuses rather than guesses', () => {
  test('no structured data and no hours-looking text is none', () => {
    expect(parseSiteHours('<html><body><h1>Welcome</h1></body></html>').outcome).toBe('none');
  });

  test('malformed JSON-LD does not throw and does not parse', () => {
    const html = '<script type="application/ld+json">{ not json </script>';
    expect(parseSiteHours(html).outcome).toBe('none');
  });

  test('structured data with unusable times refuses', () => {
    const r = parseSiteHours(
      ld({ openingHoursSpecification: [{ dayOfWeek: 'Monday', opens: '5pm', closes: '2am' }] }),
    );
    expect(r.outcome).not.toBe('parsed');
  });

  test('an unknown day name refuses rather than defaulting', () => {
    const r = parseSiteHours(
      ld({ openingHoursSpecification: [{ dayOfWeek: 'Someday', opens: '17:00', closes: '02:00' }] }),
    );
    expect(r.outcome).not.toBe('parsed');
  });

  // The critical tier-4 behaviour: hours are clearly ON the page but only as
  // prose. Freeform text is where "5-2" becomes 05:00 instead of 17:00, so it is
  // routed to a human WITH the evidence rather than parsed.
  test('visible hours prose becomes needs_human with hints, not a guess', () => {
    const html =
      '<html><body><section><h2>Hours</h2><p>Mon–Thu 5pm–2am</p>' +
      '<p>Fri &amp; Sat 5pm–4am</p></section></body></html>';
    const r = parseSiteHours(html);
    expect(r.outcome).toBe('needs_human');
    if (r.outcome === 'needs_human') {
      expect(r.hints.join(' ')).toMatch(/5pm/i);
    }
  });

  test('needs_human hints are capped so a huge page cannot flood the queue', () => {
    const noisy = `<html><body>${'<p>Open 5pm-2am</p>'.repeat(50)}</body></html>`;
    const r = parseSiteHours(noisy);
    expect(r.outcome).toBe('needs_human');
    if (r.outcome === 'needs_human') expect(r.hints.length).toBeLessThanOrEqual(5);
  });

  test('structured data that parses beats hours prose elsewhere on the page', () => {
    const html =
      '<script type="application/ld+json">' +
      JSON.stringify({ openingHours: 'Mo-Fr 17:00-02:00' }) +
      '</script><body><p>Hours: Mon-Thu 5pm-2am</p></body>';
    const r = parseSiteHours(html);
    expect(r.outcome).toBe('parsed');
  });

  test('empty input is none', () => {
    expect(parseSiteHours('').outcome).toBe('none');
  });
});

describe('composes with the trust ladder', () => {
  test('everything it emits is valid to the ladder', () => {
    const r = parseSiteHours(
      ld({ openingHoursSpecification: [{ dayOfWeek: ['Monday', 'Friday'], opens: '17:00', closes: '02:00' }] }),
    );
    expect(r.outcome).toBe('parsed');
    if (r.outcome === 'parsed') expect(isValidWeeklyHours(r.hours)).toBe(true);
  });
});
