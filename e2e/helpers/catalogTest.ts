import { test as base, expect, type Route } from '@playwright/test';
import { bars } from '../../src/lib/bars';
import type { Bar } from '../../src/types';

type Row = Record<string, unknown> & { id: string };

function row(bar: Bar): Row {
  return {
    id: bar.id,
    name: bar.name,
    lat: bar.lat,
    lng: bar.lng,
    tags: bar.tags,
    neighborhood: bar.neighborhood,
    price_tier: bar.priceTier,
    hours: bar.hours ?? null,
    business_status: bar.businessStatus ?? null,
    last_verified: bar.lastVerified,
    address: bar.address,
    blurb: bar.blurb,
    place_id: bar.googlePlaceId ?? null,
    photo_count: bar.photoCount ?? (bar.photoRef ? 1 : 0),
    photo_attributions:
      bar.photoAttributions ??
      (bar.photoAttribution ? [bar.photoAttribution] : null),
    reviews: bar.reviews ?? null,
  };
}

const rows = bars.map(row).sort((a, b) => a.id.localeCompare(b.id));

function project(value: Row, columns: string[]): Row {
  return Object.fromEntries(columns.map((column) => [column, value[column]])) as Row;
}

async function fulfillCatalog(route: Route): Promise<void> {
  if (route.request().method() !== 'GET') {
    await route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
    return;
  }

  const url = new URL(route.request().url());
  const columns = (url.searchParams.get('select') ?? '*').split(',');
  const id = url.searchParams.get('id')?.replace(/^eq\./, '');
  if (id) {
    const match = rows.find((candidate) => candidate.id === id);
    await route.fulfill({
      status: match ? 200 : 406,
      contentType: 'application/json',
      body: JSON.stringify(match ? project(match, columns) : null),
    });
    return;
  }

  // supabase-js `.range(from, to)` sends a PostgREST **Range header**, not
  // offset/limit query params, and CatalogRefresh pages exactly that way.
  // Reading only the params re-served page one forever, and the caller's
  // `data.length < PAGE` loop therefore never terminated — a deterministic
  // hang for any spec whose page mounts CatalogRefresh.
  const rangeHeader = route.request().headers()['range'] ?? '';
  const range = /^(?:items=)?(\d+)-(\d+)$/.exec(rangeHeader.trim());
  const offset = range
    ? Number(range[1])
    : Number(url.searchParams.get('offset') ?? 0);
  const limit = range
    ? Number(range[2]) - Number(range[1]) + 1
    : Number(url.searchParams.get('limit') ?? 1000);
  const page = rows.slice(offset, offset + limit).map((value) => project(value, columns));
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'content-range': page.length ? `${offset}-${offset + page.length - 1}/*` : '*/*' },
    body: JSON.stringify(page),
  });
}

/** The bars-table route pattern, so callers register exactly the same one. */
export const CATALOG_ROUTE = /\/rest\/v1\/bars(\?|$)/;

/**
 * Exported for specs that build their own Supabase stub instead of using the
 * fixture below. A spec that blanket-routes `**\/rest\/v1\/**` to `[]` starves
 * CatalogRefresh, and rowsToCatalog rejects a short list (<100 rows), so the
 * app silently falls back to the tiny `coreBars` set — any assertion naming a
 * non-core bar then fails for a reason that has nothing to do with the test.
 */
export { fulfillCatalog };

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(CATALOG_ROUTE, fulfillCatalog);
    await use(page);
  },
});

export { expect };
