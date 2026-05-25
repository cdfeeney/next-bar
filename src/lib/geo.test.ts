import { describe, it, expect } from 'vitest';
import { isInsideManhattan, snapToNeighborhoodCentroid } from '@/lib/geo';
import { haversineMiles } from '@/lib/distance';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';
import type { Coords } from '@/types';

describe('isInsideManhattan', () => {
  it('returns true for a Midtown coord', () => {
    const midtown: Coords = { lat: 40.7549, lng: -73.984 };
    expect(isInsideManhattan(midtown)).toBe(true);
  });

  it('returns false for a Brooklyn coord (below the southern BBox edge)', () => {
    const brooklyn: Coords = { lat: 40.65, lng: -73.95 };
    expect(isInsideManhattan(brooklyn)).toBe(false);
  });

  it('returns true at the exact SW BBox corner (bounds inclusive)', () => {
    const corner: Coords = { lat: 40.700, lng: -74.030 };
    expect(isInsideManhattan(corner)).toBe(true);
  });
});

describe('snapToNeighborhoodCentroid', () => {
  it('returns the nearest centroid for a coord just off Midtown', () => {
    // ~0.4mi NE of Midtown centroid (40.7550, -73.9840), well under MAX_SNAP_MILES.
    const justOffMidtown: Coords = { lat: 40.7600, lng: -73.9800 };
    const snap = snapToNeighborhoodCentroid(justOffMidtown);

    expect(snap).not.toBeNull();
    // Non-null narrowing
    if (snap === null) return;
    expect(snap.neighborhood).toBe('Midtown');
  });

  it('returns null for a Brooklyn coord (outside the Manhattan BBox)', () => {
    const brooklyn: Coords = { lat: 40.65, lng: -73.95 };
    expect(snapToNeighborhoodCentroid(brooklyn)).toBeNull();
  });

  it('returns null when inside the BBox but > MAX_SNAP_MILES from every centroid', () => {
    // Upper Manhattan (~Harlem/Inwood-ish). Inside BBox, > 2mi from every
    // centroid (the northernmost is UWS at 40.787 — this coord is ~4.7mi away).
    const farNorth: Coords = { lat: 40.85, lng: -73.94 };

    // Sanity-check the fixture: every centroid must be > 2mi away, otherwise
    // the test would be asserting the wrong branch.
    for (const key of Object.keys(NEIGHBORHOOD_CENTROIDS) as Array<
      keyof typeof NEIGHBORHOOD_CENTROIDS
    >) {
      const miles = haversineMiles(farNorth, NEIGHBORHOOD_CENTROIDS[key]);
      expect(miles).toBeGreaterThan(2);
    }

    expect(snapToNeighborhoodCentroid(farNorth)).toBeNull();
  });

  it('returns a miles field equal to haversineMiles(input, returnedCentroid)', () => {
    const justOffMidtown: Coords = { lat: 40.7600, lng: -73.9800 };
    const snap = snapToNeighborhoodCentroid(justOffMidtown);

    expect(snap).not.toBeNull();
    if (snap === null) return;
    const expected = haversineMiles(justOffMidtown, snap.centroid);
    expect(snap.miles).toBeCloseTo(expected, 6);
  });

  it('returns a centroid matching the NEIGHBORHOOD_CENTROIDS entry for the snapped neighborhood', () => {
    const justOffMidtown: Coords = { lat: 40.7600, lng: -73.9800 };
    const snap = snapToNeighborhoodCentroid(justOffMidtown);

    expect(snap).not.toBeNull();
    if (snap === null) return;
    expect(snap.centroid).toEqual(NEIGHBORHOOD_CENTROIDS[snap.neighborhood]);
  });
});
