/**
 * Bar → BarsTableRow inverse mapping, shared by the fixture GENERATOR
 * (generate-catalog-fixture.mts) and the DRIFT TEST
 * (catalog-fixture-drift.test.ts) so the two can never disagree.
 * Field-for-field inverse of src/lib/catalogServer.ts rowToBar, restricted
 * to CatalogRefresh's CATALOG_COLUMNS (reviews load on demand).
 */

import type { Bar } from '../../src/types';
import type { BarsTableRow } from '../../src/lib/catalogServer';

export function barToRow(b: Bar): BarsTableRow {
  return {
    id: b.id,
    name: b.name,
    lat: b.lat,
    lng: b.lng,
    tags: [...b.tags],
    neighborhood: b.neighborhood,
    price_tier: b.priceTier,
    hours: b.hours ?? null,
    blurb: b.blurb ?? '',
    address: b.address ?? '',
    place_id: b.googlePlaceId ?? null,
    business_status: b.businessStatus ?? null,
    // Legacy single-photo bars carry photoRef with no photoCount; the real
    // bars-table rows for them store photo_count=1 (0020 backfill).
    photo_count: b.photoCount ?? (b.photoRef ? 1 : 0),
    // Legacy singular photoAttribution must survive too — losing it renders
    // "Photo · Google" instead of the named author for 151 bars.
    photo_attributions:
      b.photoAttributions ?? (b.photoAttribution ? [b.photoAttribution] : null),
    reviews: null, // not in CATALOG_COLUMNS; loaded on demand
    last_verified: b.lastVerified,
    hours_source: b.hoursSource ?? null,
    hours_confidence: b.hoursConfidence ?? null,
    hours_verified_at: b.hoursVerifiedAt ?? null,
  };
}
