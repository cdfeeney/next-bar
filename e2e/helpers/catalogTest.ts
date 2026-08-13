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

  const offset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Number(url.searchParams.get('limit') ?? 1000);
  const page = rows.slice(offset, offset + limit).map((value) => project(value, columns));
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'content-range': page.length ? `${offset}-${offset + page.length - 1}/*` : '*/*' },
    body: JSON.stringify(page),
  });
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(/\/rest\/v1\/bars(\?|$)/, fulfillCatalog);
    await use(page);
  },
});

export { expect };
