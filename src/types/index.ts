export type Coords = { lat: number; lng: number };

// Service-area neighborhoods. Manhattan shipped first; Brooklyn added in the
// catalog-expansion pass; Hell's Kitchen/SoHo/Harlem + Queens + Fort Greene
// in the new-neighborhoods pass (2026-07-24 — NYC has ~3-4.5k dedicated
// bars; these were the highest-density unserved areas). `ManhattanNeighborhood`
// is kept as a back-compat alias so existing imports keep working — it now
// spans three boroughs.
export type Neighborhood =
  // Manhattan
  | 'FiDi'
  | 'LES'
  | 'East Village'
  | 'West Village'
  | 'SoHo'
  | 'Chelsea'
  | 'Midtown'
  | "Hell's Kitchen"
  | 'UWS'
  | 'UES'
  | 'Harlem'
  // Manhattan expansion 2026-07-27 (operator: recover boundary-rejected venues)
  | 'Tribeca'
  | 'Battery Park City'
  | 'Hamilton Heights'
  | 'Flatiron'
  | 'Greenwich Village'
  | 'NoHo'
  | 'Hudson Square'
  | 'Gramercy'
  | 'Kips Bay'
  | 'East Harlem'
  | 'Morningside Heights'
  | 'Washington Heights'
  | 'Inwood'
  | 'Chinatown'
  // Brooklyn
  | 'Williamsburg'
  | 'Greenpoint'
  | 'Bushwick'
  | 'Park Slope'
  | 'Fort Greene'
  | 'Gowanus'
  // Queens
  | 'Astoria'
  | 'LIC'
  | 'Ridgewood';

/** @deprecated Use `Neighborhood`. Alias kept for back-compat; spans Manhattan + Brooklyn + Queens. */
export type ManhattanNeighborhood = Neighborhood;

export type VibeTag =
  | 'dive' | 'cocktail' | 'wine' | 'beer' | 'dance' | 'lounge' | 'speakeasy' | 'pub' | 'rooftop' | 'garden' | 'club' | 'restaurant-bar'
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

/** One Google review snippet stored by the monthly `--reviews` ingest pass
 * (scripts/refresh-places.mjs). Text is an excerpt (≤200 chars); author is the
 * required Google attribution; rating is the reviewer's 1–5 stars. */
export type BarReview = {
  text: string;
  author: string;
  rating: number;
};

/** A per-bar patch produced by the Google Places refresh job (keyed by bar id).
 * Overlaid onto the curated catalog at load time so the hand-authored bar files
 * stay clean and the machine-generated data can be regenerated wholesale.
 * NOTE: the wrong-venue guard this comment used to describe no longer runs in
 * bars.ts. It moved into scripts/refresh-places.mjs (enforced at the single point
 * where the sidecar is serialised) when coordinates stopped being persisted — a
 * patch resolving outside the service area is now discarded before it is written,
 * rather than shipped and filtered on read. */
export type PlacePatch = {
  /**
   * NO COORDINATES HERE, deliberately.
   *
   * `lat`/`lng` were removed 2026-07-29. Google's terms permit caching them for
   * at most 30 consecutive days and this sidecar is a generated file committed to
   * git and shipped to every client, so anything stored here outlives that window
   * by construction. Coordinates now come from OpenStreetMap (migrations
   * 0029-0032) and live in the catalog files and the bars table, where no expiry
   * applies. Only place_id is exempt from Google's caching restrictions, which is
   * why it is the one Google-derived field that remains.
   *
   * The wrong-venue bbox guard that used to run on these coordinates at runtime
   * now runs at GENERATION time in scripts/refresh-places.mjs — an out-of-area
   * match is discarded before it is ever written.
   */
  googlePlaceId?: string;
  businessStatus?: BusinessStatus;
  hours?: WeeklyHours;
  /** Places photo resource name (places/{id}/photos/{ref}); presence means a
   * local photo was ingested to public/bar-photos/<barId>.jpg. */
  photoRef?: string;
  photoCount?: number;
  photoAttributions?: string[];
  /** Photo author attribution (Google policy: must render when photo shown). */
  photoAttribution?: string;
  /** Up to 3 review snippets from the monthly `--reviews` pass. */
  reviews?: BarReview[];
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
  photoRef?: string;
  photoAttribution?: string;
  /** Carousel photo count (photos-multi ingest) — files are <id>.jpg,
   * <id>-2.jpg … <id>-N.jpg. Photo resource names live in
   * scripts/data/photo-refs.json (ingest bookkeeping, NOT bundled — they
   * pushed the edge OG function past Vercel's 1MB limit). */
  photoCount?: number;
  /** Per-photo author attributions, index-aligned by photo order ('' = unknown). */
  photoAttributions?: string[];
  reviews?: BarReview[];
  /** Where `hours` came from. Google's Places policy permits storing the
   * place_id indefinitely and nothing else beyond narrow exceptions —
   * opening hours are NOT covered — so Google-derived hours are marked
   * 'unverified' and must not drive the strict Open-now filter. */
  hoursSource?: HoursSource;
  hoursConfidence?: HoursConfidence;
  hoursVerifiedAt?: string;
};

export type HoursSource =
  | 'google'
  | 'venue'
  | 'nextbar'
  | 'user'
  | 'official_site'
  /** OpenStreetMap `opening_hours`, ODbL-licensed. Its own source rather than
   *  being folded into 'user' or 'official_site': OSM is neither our users nor
   *  the venue, and provenance that lies is the thing this schema exists to
   *  prevent. Attribution obligations follow the data. */
  | 'osm';

export type HoursConfidence = 'unverified' | 'reported' | 'verified';

// E3.2: distance as intent, not units — "Walkable" / "Worth a cab" chips
// (values live in constants.ts: RADIUS_WALK / RADIUS_CAB) plus the
// "Anywhere" escape (R5).
export type Radius =
  | { kind: 'walking';  maxMiles: 1.5 }
  | { kind: 'cab';      maxMiles: 4 }
  | { kind: 'anywhere'; maxMiles: null };

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
