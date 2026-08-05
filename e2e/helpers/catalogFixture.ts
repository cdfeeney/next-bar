/**
 * Loopback fixtures (goal g-5dd241b6): serve the app's outbound data needs
 * from inside the test, so the whole suite passes under the network fence
 * with ZERO non-loopback requests.
 *
 *  - installCatalogFixture: answers CatalogRefresh's paged
 *    `/rest/v1/bars` reads with the committed bundled-catalog rows
 *    (e2e/fixtures/catalog-rows.json — regenerate via
 *    e2e/tools/generate-catalog-fixture.mts). Post-swap content is therefore
 *    identical to the static fallback, and the `data-catalog-swapped`
 *    marker still commits for specs that wait on it. Honors supabase-js
 *    paging (Range header, offset/limit params) with a stable id order so
 *    the paging loop terminates exactly like PostgREST's.
 *  - installTileStub: answers Leaflet's basemap tile fetches with a 1x1
 *    transparent PNG so /map renders (and stays console-clean) offline.
 *  - installLoopbackFixtures: both.
 *
 * These do NOT weaken what the specs prove: paging semantics, ordering, and
 * row shape mirror PostgREST; specs asserting >1000-row paging pass a
 * synthetic row set via `rows` and still exercise the app's real loop.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page, Route } from '@playwright/test';

type Row = Record<string, unknown> & { id: string };

let bundledRows: Row[] | null = null;

/** The committed bundled-catalog rows (403 at generation time). */
export function loadBundledRows(): Row[] {
  if (!bundledRows) {
    bundledRows = JSON.parse(
      readFileSync(path.join(__dirname, '..', 'fixtures', 'catalog-rows.json'), 'utf8'),
    ) as Row[];
  }
  return bundledRows;
}

/** Parse supabase-js paging: Range header first, offset/limit params second. */
function parseRange(route: Route): { from: number; to: number } {
  const headers = route.request().headers();
  const range = headers['range'];
  const m = range?.match(/^(\d+)-(\d+)$/);
  if (m) return { from: Number(m[1]), to: Number(m[2]) };
  const url = new URL(route.request().url());
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Number(url.searchParams.get('limit') ?? 1000);
  return { from: offset, to: offset + limit - 1 };
}

export async function installCatalogFixture(
  page: Page,
  opts: { rows?: Row[] } = {},
): Promise<void> {
  // Sorted by id ASC once — CatalogRefresh orders by id and pages on it;
  // stable order is what makes the pages non-overlapping.
  const sorted = [...(opts.rows ?? loadBundledRows())].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  await page.route('**/rest/v1/bars**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
      return;
    }
    const { from, to } = parseRange(route);
    const slice = sorted.slice(from, to + 1);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'content-range': `${from}-${from + slice.length - 1}/*`,
      },
      body: JSON.stringify(slice),
    });
  });
}

// Smallest valid transparent 1x1 PNG.
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export async function installTileStub(page: Page): Promise<void> {
  await page.route('**/*.basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );
}

/** The standard pair for any spec that renders the catalog or the map. */
export async function installLoopbackFixtures(page: Page): Promise<void> {
  await installCatalogFixture(page);
  await installTileStub(page);
}

/**
 * Synthetic >1000-row set for paging-cap specs: the bundled rows plus
 * clones with distinct ids, all valid per rowToBar (real hoods/bbox/dates
 * survive the clone).
 */
export function syntheticRows(total: number): Row[] {
  const base = loadBundledRows();
  const out: Row[] = [...base];
  let i = 0;
  while (out.length < total) {
    const src = base[i % base.length];
    out.push({ ...src, id: `${src.id}-syn${out.length}` });
    i++;
  }
  return out.slice(0, total);
}
