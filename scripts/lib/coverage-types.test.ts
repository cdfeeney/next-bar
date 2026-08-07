import { describe, expect, it } from 'vitest';
// @ts-ignore -- the operator scripts intentionally remain native ESM.
import {
  NEARBY_INCLUDED_TYPES,
  TEXT_ONLY_TYPE_COVERAGE,
  assertTypeCoverage,
  hybridTypesRequestedFromNearby,
  unsupportedTypeFromError,
} from './coverage-types.mjs';
// @ts-ignore
import { BAR_TYPES } from './coverage-search.mjs';

describe('nearby type universe', () => {
  it('reaches every modelled bar type through exactly one lane', () => {
    expect(() => assertTypeCoverage()).not.toThrow();
    for (const type of BAR_TYPES) {
      const requestable = NEARBY_INCLUDED_TYPES.includes(type);
      const textCovered = type in TEXT_ONLY_TYPE_COVERAGE;
      expect(requestable || textCovered).toBe(true);
    }
  });

  it('requests far more than the five types the sweep used to send', () => {
    // The old list was ['bar','pub','wine_bar','night_club','bar_and_grill'].
    // Recall was capped at that universe no matter how the geography was
    // subdivided.
    for (const legacy of ['bar', 'pub', 'wine_bar', 'night_club', 'bar_and_grill']) {
      expect(NEARBY_INCLUDED_TYPES).toContain(legacy);
    }
    expect(NEARBY_INCLUDED_TYPES.length).toBeGreaterThan(15);
  });

  it('requests the hybrid hosts that carry the known misses', () => {
    // Book Club Bar / Liz's Book Bar (book_store), Gran Torino, Beco,
    // Zum Schneider, Taqueria St. Marks (restaurant), rooftop bars (hotel).
    for (const host of ['restaurant', 'hotel', 'book_store', 'cafe']) {
      expect(NEARBY_INCLUDED_TYPES).toContain(host);
    }
    expect(hybridTypesRequestedFromNearby().length).toBeGreaterThan(3);
  });

  it('stays inside the 50-type request limit', () => {
    expect(NEARBY_INCLUDED_TYPES.length).toBeLessThanOrEqual(50);
    expect(new Set(NEARBY_INCLUDED_TYPES).size).toBe(NEARBY_INCLUDED_TYPES.length);
  });

  it('names the offending type when Google rejects the request', () => {
    expect(
      unsupportedTypeFromError(
        'Invalid value at \'included_types[7]\' (TYPE_ENUM), "dance_hall"',
        NEARBY_INCLUDED_TYPES,
      ),
    ).toContain('dance_hall');
    expect(unsupportedTypeFromError('Deadline exceeded', NEARBY_INCLUDED_TYPES)).toEqual([]);
  });
});
