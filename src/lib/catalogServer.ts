import type { Bar, Neighborhood, VibeTag, WeeklyHours } from '@/types';
import { TAG_VOCABULARY } from '@/lib/catalog';
import { SERVICE_AREA_BBOX, NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';

/**
 * bars-table row → Bar mapping + BOUNDARY VALIDATION (0019 swap, mass-
 * import prerequisite). The table is storage; the app-side vocabulary and
 * service-area bbox stay authoritative — a corrupt or half-imported row
 * must degrade to "not in the catalog", never to a crash or a bar in the
 * Atlantic. Design: docs/BARS-TABLE-SCHEMA.md.
 */

export type BarsTableRow = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  tags: string[];
  neighborhood: string;
  price_tier: number;
  hours: WeeklyHours | null;
  blurb: string;
  address: string;
  place_id: string | null;
  business_status: string | null;
  photo_count: number;
  photo_attributions: string[] | null;
  reviews: Bar['reviews'] | null;
  last_verified: string;
  hours_source?: string | null;
  hours_confidence?: string | null;
  hours_verified_at?: string | null;
};

// Must stay in step with HoursSource in src/types and with the
// bars_hours_source_check constraint (migration 0024). A value missing here is
// silently remapped to 'google'/'unverified' on read, so an omission would make
// a genuinely first-party row look Google-derived and untrustworthy.
const HOURS_SOURCES = new Set([
  'google', 'venue', 'nextbar', 'user', 'official_site', 'osm',
]);
const HOURS_CONFIDENCE = new Set(['unverified', 'reported', 'verified']);

const KNOWN_TAGS: ReadonlySet<string> = new Set(TAG_VOCABULARY);
const KNOWN_HOODS: ReadonlySet<string> = new Set(
  Object.keys(NEIGHBORHOOD_CENTROIDS),
);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function inBbox(lat: number, lng: number): boolean {
  return (
    lat >= SERVICE_AREA_BBOX.minLat &&
    lat <= SERVICE_AREA_BBOX.maxLat &&
    lng >= SERVICE_AREA_BBOX.minLng &&
    lng <= SERVICE_AREA_BBOX.maxLng
  );
}

/** Map + validate one row; null = reject (logged by the caller). */
export function rowToBar(row: BarsTableRow): Bar | null {
  if (
    typeof row?.id !== 'string' ||
    !/^[a-z0-9-]{1,60}$/.test(row.id) ||
    typeof row.name !== 'string' ||
    row.name.length === 0 ||
    typeof row.lat !== 'number' ||
    typeof row.lng !== 'number' ||
    !inBbox(row.lat, row.lng) ||
    !KNOWN_HOODS.has(row.neighborhood) ||
    typeof row.price_tier !== 'number' ||
    row.price_tier < 1 ||
    row.price_tier > 4 ||
    typeof row.last_verified !== 'string' ||
    !DATE_RE.test(row.last_verified)
  ) {
    return null;
  }
  // Unknown tags are DROPPED, not fatal (0008 tolerance): the import may
  // carry vocabulary the app hasn't shipped yet.
  const tags = (Array.isArray(row.tags) ? row.tags : []).filter((t) =>
    KNOWN_TAGS.has(t),
  ) as VibeTag[];
  return {
    id: row.id,
    name: row.name,
    neighborhood: row.neighborhood as Neighborhood,
    address: row.address ?? '',
    lat: row.lat,
    lng: row.lng,
    priceTier: row.price_tier as Bar['priceTier'],
    tags,
    blurb: row.blurb ?? '',
    lastVerified: row.last_verified,
    ...(row.hours ? { hours: row.hours } : {}),
    ...(row.place_id ? { googlePlaceId: row.place_id } : {}),
    ...(row.business_status
      ? { businessStatus: row.business_status as Bar['businessStatus'] }
      : {}),
    ...(row.photo_count > 0 ? { photoCount: row.photo_count } : {}),
    ...(row.photo_attributions
      ? { photoAttributions: row.photo_attributions }
      : {}),
    ...(row.reviews ? { reviews: row.reviews } : {}),
    // Unknown/absent provenance is treated as UNVERIFIED, not as missing:
    // a row with hours but no source is legacy Google data, and defaulting
    // it to trusted is the failure mode this whole column exists to stop.
    ...(row.hours
      ? {
          hoursSource: (HOURS_SOURCES.has(row.hours_source ?? '')
            ? row.hours_source
            : 'google') as Bar['hoursSource'],
          hoursConfidence: (HOURS_CONFIDENCE.has(row.hours_confidence ?? '')
            ? row.hours_confidence
            : 'unverified') as Bar['hoursConfidence'],
        }
      : {}),
    ...(row.hours_verified_at ? { hoursVerifiedAt: row.hours_verified_at } : {}),
  };
}

/**
 * Map + validate a fetched row set. The whole batch is REJECTED (null)
 * when it is empty or implausibly small versus the static fallback — a
 * truncated fetch must never shrink the catalog under the user.
 */
export function rowsToCatalog(
  rows: BarsTableRow[],
  staticCount: number,
): Bar[] | null {
  const mapped = rows.map(rowToBar).filter((b): b is Bar => b !== null);
  if (mapped.length < Math.min(staticCount, 100)) return null;
  const ids = new Set(mapped.map((b) => b.id));
  if (ids.size !== mapped.length) return null; // dup ids = corrupt import
  return mapped;
}
