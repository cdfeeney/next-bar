import type { Coords, Neighborhood } from '@/types';

export const JACCARD_START = 0.25;
export const JACCARD_FLOOR = 0.10;
export const JACCARD_STEP = 0.05;
export const MIN_CANDIDATES = 3;
export const MAX_RESULTS = 3;
/**
 * QA-6 (2026-07-27): the ONE Next Bar results view surfaces 5 suggestions
 * on BOTH home entry paths (location-first auto results and the manual
 * seed-bar results). MAX_RESULTS stays 3 as the matcher's default cap for
 * small companion surfaces (Group Favorites, consensus).
 */
export const RESULTS_COUNT = 5;
/**
 * Exploration slot (B7b, "DeepSeek ε-greedy, simplified"): when a surface
 * requests at least this many results, the LAST slot is reserved for a
 * qualified long-tail pick instead of the Nth-best score. Small default
 * surfaces (MAX_RESULTS = 3) never sacrifice a slot.
 */
export const EXPLORATION_MIN_RESULTS = 10;

// Blended-ranking weights (must sum to 1 so the final score stays in [0, 1] and
// no single axis can dominate by scale). Vibe leads; proximity is a strong
// secondary; loved-taste affinity is a small tie-breaker. See src/lib/matching.ts.
export const VIBE_WEIGHT = 0.5;
export const DIST_WEIGHT = 0.4;
export const RATING_WEIGHT = 0.1;

// Proximity uses a scale-free exponential decay exp(-miles / DIST_DECAY_MILES)
// rather than pool-relative normalization (which would make a bar's rank depend
// on the other bars in the pool). 1/e at 1.5 mi ≈ the walkable/cab boundary.
export const DIST_DECAY_MILES = 1.5;

// Bumped from 180 to 365 for v0.3.1 to buy time until per-bar verification
// happens. Re-tighten in v0.3.2 once `bars.ts` has real lastVerified dates.
export const LAST_VERIFIED_HARD_FILTER_DAYS = 365;
export const LAST_VERIFIED_FRESH_DAYS = 90;

export const COARSE_ACCURACY_M = 200;
export const MAX_SNAP_MILES = 2;

// E3.2 distance chips: "Walkable" ~ a determined 25-30min walk;
// "Worth a cab" ~ a short cross-town ride. Literal types in types/index.ts
// (Radius) must match these values.
export const RADIUS_WALK = 1.5;

// Late-night ranking bias (operator 2026-07-27: "past a certain time the
// algorithm biases towards bars and clubs and away from restaurants").
// Applied on LIVE surfaces only, additive at tie-breaker scale (same
// order of magnitude as the 0.1 affinity term — it reorders near-ties,
// never buries a strong match).
export const LATE_NIGHT_START_HOUR = 22; // 10pm…
export const LATE_NIGHT_END_HOUR = 4;    // …through 3:59am
export const LATE_CLUB_BOOST = 0.06;
export const LATE_RESTAURANT_PENALTY = 0.06;
export const RADIUS_CAB = 4;
export const RADIUS_ANYWHERE = null;

// Derived from RADIUS_WALK so the card's walk/cab lead copy can never
// contradict the "Walkable" chip that surfaced the bar (review HIGH:
// after the 1 -> 1.5 bump, a 1.2mi bar under "Walkable" read "by Uber").
export const WALK_BOUNDARY_MI = RADIUS_WALK;

// E3.3 refinement (operator 2026-07-26): the open-now hard filter keeps
// bars OPENING within this window — day drinkers search before doors.
export const OPENS_SOON_WINDOW_MIN = 60;
export const WALK_MIN_PER_MILE = 20;
export const UBER_MIN_PER_MILE = 6;

// Starting centroids — verify against a map before locking.
export const NEIGHBORHOOD_CENTROIDS: Record<Neighborhood, Coords> = {
  // Manhattan
  'FiDi':         { lat: 40.7060, lng: -74.0090 },
  'LES':          { lat: 40.7170, lng: -73.9870 },
  'East Village': { lat: 40.7270, lng: -73.9840 },
  'West Village': { lat: 40.7350, lng: -74.0030 },
  'SoHo':         { lat: 40.7230, lng: -74.0000 },
  'Chelsea':      { lat: 40.7470, lng: -74.0010 },
  'Midtown':      { lat: 40.7550, lng: -73.9840 },
  "Hell's Kitchen": { lat: 40.7630, lng: -73.9920 },
  'UWS':          { lat: 40.7870, lng: -73.9750 },
  'UES':          { lat: 40.7740, lng: -73.9610 },
  'Harlem':       { lat: 40.8110, lng: -73.9450 },
  'Tribeca':      { lat: 40.7163, lng: -74.0086 },
  'Battery Park City': { lat: 40.7115, lng: -74.0158 },
  'Hamilton Heights':  { lat: 40.8252, lng: -73.9496 },
  'Flatiron':     { lat: 40.7411, lng: -73.9897 },
  // Brooklyn
  'Williamsburg': { lat: 40.7140, lng: -73.9570 },
  'Greenpoint':   { lat: 40.7300, lng: -73.9510 },
  'Bushwick':     { lat: 40.6940, lng: -73.9210 },
  'Park Slope':   { lat: 40.6720, lng: -73.9790 },
  'Fort Greene':  { lat: 40.6860, lng: -73.9740 },
  // Queens
  'Astoria':      { lat: 40.7640, lng: -73.9200 },
  'LIC':          { lat: 40.7450, lng: -73.9490 },
};

// Service area now spans lower/mid Manhattan + north/central Brooklyn.
export const SERVICE_AREA_BBOX = {
  minLat: 40.640,
  maxLat: 40.885,
  minLng: -74.030,
  maxLng: -73.890,
};
