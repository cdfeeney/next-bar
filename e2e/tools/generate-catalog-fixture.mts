/**
 * Generates e2e/fixtures/catalog-rows.json: the BUNDLED static catalog
 * inverse-mapped to `bars` table rows (the exact PostgREST shape
 * CatalogRefresh fetches). Serving THESE rows from the loopback fixture
 * makes the post-swap catalog identical to the pre-swap fallback, so specs
 * that reference real bar names behave the same on both sides of the swap
 * marker — with zero non-loopback traffic.
 *
 * Run with:  npx tsx e2e/tools/generate-catalog-fixture.mts
 * (tsx resolves the '@' alias; the committed JSON is what e2e helpers read,
 * so Playwright never needs the alias.)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { bars as staticBars } from '../../src/lib/bars';
import type { Bar } from '../../src/types';
import type { BarsTableRow } from '../../src/lib/catalogServer';

function barToRow(b: Bar): BarsTableRow {
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
    // bars-table rows for them store photo_count=1 (0020 backfill), and the
    // map-lightbox single-photo test depends on exactly that.
    photo_count: b.photoCount ?? (b.photoRef ? 1 : 0),
    photo_attributions: b.photoAttributions ?? null,
    reviews: null, // not in CATALOG_COLUMNS; loaded on demand
    last_verified: b.lastVerified,
    hours_source: b.hoursSource ?? null,
    hours_confidence: b.hoursConfidence ?? null,
    hours_verified_at: b.hoursVerifiedAt ?? null,
  };
}

const rows = staticBars.map(barToRow);
const outDir = path.join(process.cwd(), 'e2e', 'fixtures');
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'catalog-rows.json');
writeFileSync(outPath, JSON.stringify(rows));
console.log(`wrote ${rows.length} rows -> ${outPath}`);
