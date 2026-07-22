import { describe, it, expect } from 'vitest';
import { isInServiceArea, snapToNeighborhoodCentroid } from '@/lib/geo';
import { haversineMiles } from '@/lib/distance';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';
import type { Coords } from '@/types';

describe('isInServiceArea', () => {
  it('returns true for a Midtown coord', () => {
    const midtown: Coords = { lat: 40.7549, lng: -73.984 };
    expect(isInServiceArea(midtown)).toBe(true);
  });

  it('returns true for a Williamsburg (Brooklyn) coord', () => {
    const williamsburg: Coords = { lat: 40.7140, lng: -73.9570 };
    expect(isInServiceArea(williamsburg)).toBe(true);
  });

  it('returns false for a coord well outside the served boroughs', () => {
    // Newark, NJ — west of the western BBox edge.
    const newark: Coords = { lat: 40.7357, lng: -74.1724 };
    expect(isInServiceArea(newark)).toBe(false);
  });

  it('returns true at the exact SW BBox corner (bounds inclusive)', () => {
    const corner: Coords = { lat: 40.640, lng: -74.030 };
    expect(isInServiceArea(corner)).toBe(true);
  });
});

describe('snapToNeighborhoodCentroid', () => {
  it('returns the nearest centroid for a coord just off Midtown', () => {
    // ~0.4mi NE of Midtown centroid (40.7550, -73.9840), well under MAX_SNAP_MILES.
    const justOffMidtown: Coords = { lat: 40.7600, lng: -73.9800 };
    const snap = snapToNeighborhoodCentroid(justOffMidtown);

    expect(snap).not.toBeNull();
    if (snap === null) return;
    expect(snap.neighborhood).toBe('Midtown');
  });

  it('snaps a Brooklyn coord to its nearest Brooklyn centroid', () => {
    // Just off the Williamsburg centroid (40.7140, -73.9570).
    const offWilliamsburg: Coords = { lat: 40.7155, lng: -73.9555 };
    const snap = snapToNeighborhoodCentroid(offWilliamsburg);

    expect(snap).not.toBeNull();
    if (snap === null) return;
    expect(snap.neighborhood).toBe('Williamsburg');
  });

  it('returns null for a coord outside the service area', () => {
    const newark: Coords = { lat: 40.7357, lng: -74.1724 };
    expect(snapToNeighborhoodCentroid(newark)).toBeNull();
  });

  it('returns null when inside the BBox but > MAX_SNAP_MILES from every centroid', () => {
    // Upper Manhattan (~Harlem/Inwood-ish). Inside BBox, > 2mi from every centroid.
    const farNorth: Coords = { lat: 40.85, lng: -73.94 };

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
