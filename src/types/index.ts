export type Coords = { lat: number; lng: number };

// Service-area neighborhoods. Manhattan shipped first; Brooklyn added in the
// catalog-expansion pass. `ManhattanNeighborhood` is kept as a back-compat
// alias so existing imports keep working — it now spans both boroughs.
export type Neighborhood =
  // Manhattan
  | 'FiDi'
  | 'LES'
  | 'East Village'
  | 'West Village'
  | 'Chelsea'
  | 'Midtown'
  | 'UWS'
  | 'UES'
  // Brooklyn
  | 'Williamsburg'
  | 'Greenpoint'
  | 'Bushwick'
  | 'Park Slope';

/** @deprecated Use `Neighborhood`. Alias kept for back-compat; spans Manhattan + Brooklyn. */
export type ManhattanNeighborhood = Neighborhood;

export type VibeTag =
  | 'dive' | 'cocktail' | 'wine' | 'beer' | 'dance' | 'lounge' | 'speakeasy' | 'pub' | 'rooftop' | 'garden'
  | 'chill' | 'buzzy' | 'loud'
  | 'locals' | 'post-work' | 'date' | 'tourist' | 'industry'
  | 'rough' | 'polished' | 'romantic' | 'instagrammable' | 'old-nyc' | 'trendy'
  | 'indie' | 'hiphop' | 'house' | 'jazz' | 'live'
  | 'cheap' | 'mid' | 'pricey' | 'splurge';

export type VibeProfile = {
  tags: VibeTag[];
  archetype: string;
  preferredNeighborhoods: Neighborhood[];
};

/** A single open→close window, 24h "HH:MM" local (NYC) time. A close earlier
 * than open means it runs past midnight (e.g. { open: '18:00', close: '02:00' }). */
export type TimeRange = { open: string; close: string };

/** Weekly opening hours keyed by day-of-week, 0 = Sunday … 6 = Saturday.
 * A missing/empty day means closed that day. Populated by the Places refresh
 * job; "open now" is computed client-side from this + the current NYC time so
 * no per-view API calls are needed. */
export type WeeklyHours = Partial<Record<number, TimeRange[]>>;

export type BusinessStatus = 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY';

/** A per-bar patch produced by the Google Places refresh job (keyed by bar id).
 * Overlaid onto the curated catalog at load time so the hand-authored bar files
 * stay clean and the machine-generated data can be regenerated wholesale. */
export type PlacePatch = {
  lat?: number;
  lng?: number;
  googlePlaceId?: string;
  businessStatus?: BusinessStatus;
  hours?: WeeklyHours;
};

export type Bar = {
  id: string;
  name: string;
  neighborhood: Neighborhood;
  address: string;
  lat: number;
  lng: number;
  priceTier: 1 | 2 | 3 | 4;
  tags: VibeTag[];
  blurb: string;
  igHandle?: string;
  lastVerified: string;
  // Optional, populated by the Google Places weekly-refresh job (scripts/refresh-places.mjs).
  googlePlaceId?: string;
  businessStatus?: BusinessStatus;
  hours?: WeeklyHours;
};

export type Radius =
  | { kind: 'walking';   maxMiles: 1 }
  | { kind: 'shortUber'; maxMiles: 3 }
  | { kind: 'anywhere';  maxMiles: null };

export type SearchMode = 'quiz' | 'whereNext';

export type AccuracyBand = 'precise' | 'coarse' | 'snapped' | 'unknown';

export type GeoState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'granted_precise';  coords: Coords; accuracyMeters: number }
  | { status: 'granted_coarse';   coords: Coords; accuracyMeters: number }
  | { status: 'granted_snapped';  coords: Coords; accuracyMeters: number; snappedTo: ManhattanNeighborhood }
  | { status: 'denied' }
  | { status: 'unavailable' };
