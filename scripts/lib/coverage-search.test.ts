import { describe, expect, it } from 'vitest';
// @ts-ignore -- the operator script intentionally remains native ESM.
import {
  candidateScore,
  gridForBbox,
  isInsideBbox,
  likelyLicenseName,
  matchesGoogleCounty,
  mergeCoverageCandidates,
  normalizeName,
  parseBbox,
  textQueries,
} from './coverage-search.mjs';

describe('coverage search geometry', () => {
  const bbox = parseBbox('40.753,-74.013,40.738,-73.997');

  it('parses and validates a north/west/south/east box', () => {
    expect(bbox).toEqual({
      north: 40.753,
      west: -74.013,
      south: 40.738,
      east: -73.997,
    });
    expect(() => parseBbox('40,-73,41,-74')).toThrow(/north > south/);
  });

  it('tiles the full box, including every edge', () => {
    const points = gridForBbox(bbox, 400);
    expect(points.length).toBeGreaterThan(20);
    expect(points).toContainEqual({ latitude: bbox.south, longitude: bbox.west });
    expect(points).toContainEqual({ latitude: bbox.north, longitude: bbox.east });
    expect(points.every((point) => isInsideBbox(point, bbox))).toBe(true);
  });

  it('keeps Manhattan results while excluding adjacent counties', () => {
    expect(matchesGoogleCounty('938 Amsterdam Ave, New York, NY 10025, USA', 'New York')).toBe(true);
    expect(matchesGoogleCounty('963 Amsterdam Ave, Manhattan, NY 10025, USA', 'New York')).toBe(true);
    expect(matchesGoogleCounty('2 W Mount Eden Ave, Bronx, NY 10452, USA', 'New York')).toBe(false);
    expect(matchesGoogleCounty('190 River Rd, Edgewater, NJ 07020, USA', 'New York')).toBe(false);
  });

  it('merges overlapping corridor files by Place ID and preserves evidence', () => {
    const merged = mergeCoverageCandidates([
      [
        {
          name: 'Bar Celona',
          placeId: 'place-1',
          tier: 'review',
          score: 3,
          sources: ['text'],
          regions: ['Chelsea'],
          reasons: ['text hit'],
          licenseMatches: [],
        },
      ],
      [
        {
          name: 'Bar Celona',
          placeId: 'place-1',
          tier: 'likely_bar',
          score: 8,
          sources: ['nearby'],
          regions: ['Hudson Yards'],
          reasons: ['bar primary type'],
          licenseMatches: [{ id: 'license-1' }],
        },
      ],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ tier: 'likely_bar', score: 8 });
    expect(merged[0].sources).toEqual(['text', 'nearby']);
    expect(merged[0].regions).toEqual(['Chelsea', 'Hudson Yards']);
    expect(merged[0].licenseMatches).toEqual([{ id: 'license-1' }]);
  });
});

describe('coverage search recall and ranking', () => {
  it('normalizes common catalog naming differences', () => {
    expect(normalizeName('The Milk & Hops')).toBe(normalizeName('Milk and Hops'));
  });

  it('builds queries for the venue classes the nearby sweep misses', () => {
    const queries = textQueries('Chelsea Manhattan');
    expect(queries).toContain('hotel bars in Chelsea Manhattan');
    expect(queries).toContain('bars inside food halls and markets in Chelsea Manhattan');
    expect(queries).toContain('gay bars in Chelsea Manhattan');
  });

  it('keeps hybrid restaurant and hotel venues in review instead of rejecting them', () => {
    const rory = candidateScore({
      displayName: { text: "Rory's Rooftop Bar" },
      primaryType: 'restaurant',
      types: ['restaurant'],
      queryHits: 1,
      websiteUri: 'https://example.com',
    });
    const gansevoort = candidateScore({
      displayName: { text: 'Gansevoort Rooftop' },
      primaryType: 'hotel',
      types: ['hotel'],
      queryHits: 2,
      websiteUri: 'https://example.com',
    });
    expect(rory.tier).toBe('likely_bar');
    expect(gansevoort.tier).toBe('likely_bar');
  });

  it('recognizes bar-like DBA names without treating every restaurant as a bar', () => {
    expect(likelyLicenseName('GADFLY BAR')).toBe(true);
    expect(likelyLicenseName('THE CANUCK TRUE NORTH')).toBe(false);
    expect(likelyLicenseName('GENERIC RESTAURANT LLC')).toBe(false);
  });

  it('recognizes Google lounge and hookah bar primary types', () => {
    for (const primaryType of ['lounge_bar', 'hookah_bar']) {
      expect(
        candidateScore({
          displayName: { text: 'Generic Venue Name' },
          primaryType,
          types: [primaryType],
          queryHits: 0,
        }).tier,
      ).toBe('likely_bar');
    }
  });

  it('treats secondary Google bar types as first-class recall evidence', () => {
    const result = candidateScore({
      displayName: { text: 'Books and Drinks' },
      primaryType: 'book_store',
      types: ['book_store', 'coffee_shop', 'bar'],
      queryHits: 0,
      userRatingCount: 50,
    });
    expect(result.tier).toBe('likely_bar');
    expect(result.reasons).toContain('bar secondary type: bar');
  });
});
