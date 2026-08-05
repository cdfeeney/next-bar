import { describe, expect, test } from 'vitest';
import { matchOsmVenue, normalizeVenueName, type OsmVenue } from '@/lib/osmMatch';

/**
 * Matching OSM nodes to our catalog is the dangerous step in H3. A wrong match
 * writes ANOTHER BAR'S HOURS onto a venue, which is worse than having no hours:
 * no hours shows nothing, wrong hours sends someone across town at 1am. So every
 * rule here is built to refuse rather than guess, and ambiguity is never resolved
 * by picking a winner.
 */

const bar = { id: 'attaboy', name: 'Attaboy', lat: 40.7188, lng: -73.9913 };

const osm = (over: Partial<OsmVenue> & { name: string }): OsmVenue => ({
  osmId: 'node/1',
  lat: 40.7188,
  lng: -73.9913,
  ...over,
});

describe('normalizeVenueName', () => {
  test('lowercases and strips punctuation', () => {
    expect(normalizeVenueName("Attaboy!")).toBe('attaboy');
    expect(normalizeVenueName('Mother’s Ruin')).toBe('mothers ruin');
  });

  test('strips leading "the"', () => {
    expect(normalizeVenueName('The Dead Rabbit')).toBe('dead rabbit');
  });

  test('strips city noise that OSM and we disagree about', () => {
    expect(normalizeVenueName('Attaboy NYC')).toBe('attaboy');
    expect(normalizeVenueName('Attaboy New York')).toBe('attaboy');
  });

  test('normalises and/&', () => {
    expect(normalizeVenueName('Smith & Mills')).toBe('smith and mills');
  });

  test('collapses whitespace', () => {
    expect(normalizeVenueName('  Dead    Rabbit  ')).toBe('dead rabbit');
  });

  // Venue-type words are NOT stripped: "Angel's Share" and "Angel's Share Bar"
  // are plausibly the same place, but "Clover Club" and "Clover" are not
  // obviously so. Stripping too aggressively invents matches.
  test('keeps meaningful words rather than over-stripping', () => {
    expect(normalizeVenueName('Clover Club')).toBe('clover club');
  });
});

describe('matchOsmVenue — accepts only confident matches', () => {
  test('exact normalised name at the same spot matches', () => {
    const r = matchOsmVenue(bar, [osm({ name: 'Attaboy' })]);
    expect(r.outcome).toBe('matched');
    if (r.outcome === 'matched') expect(r.reason).toBe('exact-name');
  });

  test('name variants that normalise equal still match', () => {
    const r = matchOsmVenue(bar, [osm({ name: 'attaboy nyc' })]);
    expect(r.outcome).toBe('matched');
  });

  test('a token-subset name matches only when very close by', () => {
    const near = matchOsmVenue(bar, [osm({ name: 'Attaboy Lounge' })]);
    expect(near.outcome).toBe('matched');
    if (near.outcome === 'matched') expect(near.reason).toBe('token-subset');
  });
});

describe('matchOsmVenue — refuses rather than guesses', () => {
  test('no candidates is no match', () => {
    expect(matchOsmVenue(bar, []).outcome).toBe('none');
  });

  test('a different bar at the same address does NOT match', () => {
    expect(matchOsmVenue(bar, [osm({ name: 'Beauty & Essex' })]).outcome).toBe('none');
  });

  // The pin-drift case. Same name far away is a DIFFERENT venue (chains, or a
  // relocated bar), and accepting it would import a distant sibling's hours.
  test('an exact name too far away does NOT match', () => {
    const farAway = osm({ name: 'Attaboy', lat: 40.79, lng: -73.95 });
    expect(matchOsmVenue(bar, [farAway]).outcome).toBe('none');
  });

  test('a token-subset name at a moderate distance does NOT match', () => {
    // Passes the exact-name radius but not the tighter subset radius.
    const driftedSubset = osm({ name: 'Attaboy Lounge', lat: 40.7198, lng: -73.9913 });
    expect(matchOsmVenue(bar, [driftedSubset]).outcome).toBe('none');
  });

  // THE important one. Multiple bars share an address all over NYC; picking a
  // winner here is how one bar gets another's hours.
  test('two qualifying candidates are AMBIGUOUS, never a coin flip', () => {
    const r = matchOsmVenue(bar, [
      osm({ osmId: 'node/1', name: 'Attaboy' }),
      osm({ osmId: 'node/2', name: 'Attaboy' }),
    ]);
    expect(r.outcome).toBe('ambiguous');
    if (r.outcome === 'ambiguous') expect(r.candidates).toHaveLength(2);
  });

  test('one qualifying candidate among non-qualifying ones still matches', () => {
    const r = matchOsmVenue(bar, [
      osm({ osmId: 'node/1', name: 'Beauty & Essex' }),
      osm({ osmId: 'node/2', name: 'Attaboy' }),
    ]);
    expect(r.outcome).toBe('matched');
    if (r.outcome === 'matched') expect(r.osm.osmId).toBe('node/2');
  });

  test('an exact match beats a subset match rather than being ambiguous', () => {
    const r = matchOsmVenue(bar, [
      osm({ osmId: 'node/sub', name: 'Attaboy Lounge' }),
      osm({ osmId: 'node/exact', name: 'Attaboy' }),
    ]);
    expect(r.outcome).toBe('matched');
    if (r.outcome === 'matched') {
      expect(r.osm.osmId).toBe('node/exact');
      expect(r.reason).toBe('exact-name');
    }
  });

  test('candidates with unusable coordinates are ignored', () => {
    const r = matchOsmVenue(bar, [osm({ name: 'Attaboy', lat: Number.NaN, lng: -73.99 })]);
    expect(r.outcome).toBe('none');
  });

  test('a nameless OSM node never matches', () => {
    expect(matchOsmVenue(bar, [osm({ name: '' })]).outcome).toBe('none');
  });
});
