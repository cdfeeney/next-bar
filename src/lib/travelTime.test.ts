import { describe, it, expect } from 'vitest';
import { directionsHref, matchesTravelBand, isWalkable, leadCopy, routeCopy } from '@/lib/travelTime';

describe('street route display', () => {
  it('uses raw seconds for Walkable and never rounds a longer walk down to 15', () => {
    expect(isWalkable({ seconds: 900, meters: 1100 })).toBe(true);
    expect(isWalkable({ seconds: 901, meters: 1100 })).toBe(false);
    expect(isWalkable({ seconds: 1320, meters: 1700 })).toBe(false);
    expect(routeCopy({ seconds: 901, meters: 1100 }, 'walking')).toBe('Walk ~16 min · 0.7 mi');
    expect(routeCopy({ seconds: 300, meters: 3218.688 }, 'driving')).toBe('Drive ~5 min · 2.0 mi');
  });
  it('does not infer minutes or walkability from unknown or straight-line distances', () => {
    expect(isWalkable(null)).toBe(false);
    expect(isWalkable({ seconds: NaN, meters: 20 })).toBe(false);
    expect(routeCopy(null, 'walking')).toBe('Walk time unavailable');
    expect(routeCopy(undefined, 'driving')).toBe('Drive time unavailable');
    expect(leadCopy(0.7).text).toBe('0.7 mi straight-line');
    expect(leadCopy(null, 'Chelsea').text).toBe('In Chelsea');
  });
  it('pins Maps to the same coordinates and explicit mode, without name ambiguity', () => {
    const origin = { lat: 40.75, lng: -74 };
    const destination = { lat: 40.7542853, lng: -73.9953313 };
    for (const mode of ['walking', 'driving'] as const) {
      const url = new URL(directionsHref(origin, destination, mode));
      expect(url.searchParams.get('origin')).toBe('40.75,-74');
      expect(url.searchParams.get('destination')).toBe('40.7542853,-73.9953313');
      expect(url.searchParams.get('travelmode')).toBe(mode);
    }
    expect(new URL(directionsHref(undefined, destination, 'walking')).searchParams.has('origin')).toBe(false);
  });
});

it('separates the route boundary, cab edge, and unknown routes without overlapping bands', () => {
  const origin = { lat: 40.75, lng: -74 };
  const near = { lat: 40.76, lng: -74 };
  const far = { lat: 40.85, lng: -74 };
  const bands = ['walkable', 'cab', 'anywhere'] as const;
  const admitted = (destination: typeof near, seconds: number | null) => bands.filter(band =>
    matchesTravelBand(origin, destination, seconds === null ? null : { seconds, meters: 1500 }, band));
  expect(admitted(near, 900)).toEqual(['walkable']);
  expect(admitted(near, 901)).toEqual(['cab']);
  expect(admitted(near, null)).toEqual([]);
  expect(admitted(far, 5000)).toEqual(['anywhere']);
  expect(admitted(far, null)).toEqual(['anywhere']);
});
