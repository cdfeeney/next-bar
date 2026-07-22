import type { Coords, Neighborhood } from '@/types';

export const JACCARD_START = 0.25;
export const JACCARD_FLOOR = 0.10;
export const JACCARD_STEP = 0.05;
export const MIN_CANDIDATES = 3;
export const MAX_RESULTS = 3;

// Bumped from 180 to 365 for v0.3.1 to buy time until per-bar verification
// happens. Re-tighten in v0.3.2 once `bars.ts` has real lastVerified dates.
export const LAST_VERIFIED_HARD_FILTER_DAYS = 365;
export const LAST_VERIFIED_FRESH_DAYS = 90;

export const COARSE_ACCURACY_M = 200;
export const MAX_SNAP_MILES = 2;
export const GPS_CONFIRM_MILES = 0.124;

export const RADIUS_WALK = 1;
export const RADIUS_SHORT_UBER = 3;
export const RADIUS_ANYWHERE = null;

export const WALK_BOUNDARY_MI = 1;
export const WALK_MIN_PER_MILE = 20;
export const UBER_MIN_PER_MILE = 6;

// Starting centroids — verify against a map before locking.
export const NEIGHBORHOOD_CENTROIDS: Record<Neighborhood, Coords> = {
  // Manhattan
  'FiDi':         { lat: 40.7060, lng: -74.0090 },
  'LES':          { lat: 40.7170, lng: -73.9870 },
  'East Village': { lat: 40.7270, lng: -73.9840 },
  'West Village': { lat: 40.7350, lng: -74.0030 },
  'Chelsea':      { lat: 40.7470, lng: -74.0010 },
  'Midtown':      { lat: 40.7550, lng: -73.9840 },
  'UWS':          { lat: 40.7870, lng: -73.9750 },
  'UES':          { lat: 40.7740, lng: -73.9610 },
  // Brooklyn
  'Williamsburg': { lat: 40.7140, lng: -73.9570 },
  'Greenpoint':   { lat: 40.7300, lng: -73.9510 },
  'Bushwick':     { lat: 40.6940, lng: -73.9210 },
  'Park Slope':   { lat: 40.6720, lng: -73.9790 },
};

// Service area now spans lower/mid Manhattan + north/central Brooklyn.
export const SERVICE_AREA_BBOX = {
  minLat: 40.640,
  maxLat: 40.885,
  minLng: -74.030,
  maxLng: -73.890,
};

/** @deprecated Use `SERVICE_AREA_BBOX`. */
export const MANHATTAN_BBOX = SERVICE_AREA_BBOX;
