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
import { barToRow } from './catalogFixtureMap';

const rows = staticBars.map(barToRow);
const outDir = path.join(process.cwd(), 'e2e', 'fixtures');
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'catalog-rows.json');
writeFileSync(outPath, JSON.stringify(rows));
console.log(`wrote ${rows.length} rows -> ${outPath}`);
