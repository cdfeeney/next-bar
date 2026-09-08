import { test, expect } from './helpers/test';
import { grantGeolocation } from './helpers/geo';

// Browser integration uses synthetic public coordinates; no provider/DB writes.
const rows = Array.from({ length: 100 }, (_, i) => ({
  id: `distance-fixture-${i}`, name: `Distance Fixture ${i}`, lat: 40.75 + i / 1000, lng: -73.99,
  tags: ['pub'], neighborhood: 'Chelsea', price_tier: 2, hours: null,
  place_id: null, business_status: 'OPERATIONAL', last_verified: '2026-09-06',
}));

for (const { textSize, coarse } of [{ textSize: 100, coarse: false }, { textSize: 200, coarse: false }, { textSize: 100, coarse: true }]) {
test(`street travel cards at ${textSize}% text (${coarse ? 'approximate' : 'precise'} origin): automatic calculation, expiry and directions`, async ({ page }) => {
  await page.clock.install();
  const origin = coarse ? { lat: 40.747, lng: -74.001 } : { lat: 40.751, lng: -73.99 };
  await grantGeolocation(page.context(), coarse
    ? { latitude: 40.7471, longitude: -74.0011, accuracy: 1000 }
    : { latitude: origin.lat, longitude: origin.lng });
  await page.route('**/rest/v1/bars?*', route => route.fulfill({ json: rows }));
  let posts = 0;
  await page.route('**/api/travel', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { enabled: true } });
    posts++;
    const body = route.request().postDataJSON();
    expect(body.origin).toEqual(origin);
    expect(body.ids.length).toBeLessThanOrEqual(15);
    const routes = body.ids.slice(0, 5).map((id: string, i: number) => {
      const bar = rows.find(b => b.id === id)!;
      if (!bar) return null; // The emergency catalog can render before refresh.
      return { id, destination: { lat: bar.lat, lng: bar.lng },
        walking: { seconds: [600, 800, 900, 901, 1320][i], meters: 1000 + i * 100 },
        driving: { seconds: 300, meters: 2000 } };
    }).filter((r: { walking: { seconds: number } } | null) => r && r.walking.seconds <= 900);
    return route.fulfill({ json: { routes, checked: body.ids.length, limited: false, incomplete: false } });
  });
  await page.goto('/');
  await page.addStyleTag({ content: `html { font-size: ${textSize}%; }` });
  await expect(page.getByTestId('result-card').first()).toContainText('Distance Fixture');
  await expect(page.getByText('Catalog refresh unavailable — showing the emergency set.')).toHaveCount(0);
  if (coarse) await expect(page.getByText('Approximate — based on Chelsea', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calculate travel times' })).toHaveCount(0);
  const cards = page.getByTestId('result-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText('Walk ~10 min');
  await expect(cards.first()).toContainText('Drive ~5 min');
  await expect(page.getByRole('heading', { name: 'A little farther away' })).toHaveCount(0);
  const explanation = page.getByText('Times are estimates; driving excludes traffic and pickup waits.', { exact: true });
  await expect(explanation).toBeHidden();
  await expect(page.getByRole('link', { name: 'openrouteservice', exact: true })).toBeVisible();
  await page.getByText('About travel times', { exact: true }).click();
  await expect(explanation).toBeVisible();
  await page.getByText('About travel times', { exact: true }).click();
  await expect(explanation).toBeHidden();
  const initialPosts = posts;
  expect(initialPosts).toBeGreaterThanOrEqual(1);
  expect(initialPosts).toBeLessThanOrEqual(2);
  const href = await cards.first().getByRole('link', { name: 'Walk Maps' }).getAttribute('href');
  const url = new URL(href!);
  expect(url.searchParams.get('origin')).toBe(`${origin.lat},${origin.lng}`);
  expect(url.searchParams.get('travelmode')).toBe('walking');
  const drive = new URL((await cards.first().getByRole('link', { name: 'Drive directions' }).getAttribute('href'))!);
  expect(drive.searchParams.get('destination')).toBe(url.searchParams.get('destination'));
  expect(drive.searchParams.get('origin')).toBe(url.searchParams.get('origin'));
  expect(drive.searchParams.get('travelmode')).toBe('driving');
  const layout = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(layout.content).toBeLessThanOrEqual(layout.width + 1);
  await page.clock.fastForward(120_001);
  await expect(page.getByText('Travel times expired. This travel band could not be confirmed.')).toBeVisible();
  await expect(cards.filter({ hasText: /~\d+ min/ })).toHaveCount(0);
  expect(posts).toBe(initialPosts);
  await page.getByRole('button', { name: 'Recalculate from this starting point' }).click();
  await expect(cards.first()).toContainText('Walk ~10 min');
  expect(posts).toBe(initialPosts + 1);
  // Existing details action remains usable and carries the same private origin.
  await cards.first().getByRole('button', { name: /See photos and hours/ }).click();
  await expect(page.getByRole('link', { name: 'View on Maps' })).toHaveAttribute('href', href!);
});
}

test('routing disabled never invents minutes or transmits a location', async ({ page }) => {
  await grantGeolocation(page.context(), { latitude: 40.751, longitude: -73.99 });
  await page.route('**/rest/v1/bars?*', route => route.fulfill({ json: rows }));
  let posts = 0;
  await page.route('**/api/travel', route => {
    if (route.request().method() === 'POST') posts++;
    return route.fulfill({ json: { enabled: false } });
  });
  await page.goto('/');
  await expect(page.getByText('Route times unavailable. Walkable and cab results need a confirmed walking route.')).toBeVisible();
  const cards = page.getByTestId('result-card');
  await expect(cards).toHaveCount(0);
  await expect(cards.filter({ hasText: /~\d+ min/ })).toHaveCount(0);
  expect(posts).toBe(0);
});

/**
 * D-C-40 / V8-R-NXT-008 — travel selections recompute the search.
 *
 * The HOME surface ranks with no tags and no rating history
 * (WhereNextFlow's autoProfile), so the cascade scores every bar equally and
 * falls through to its last tie-breaker, exact miles. Before this coverage
 * existed, Walkable, Worth a cab and Anywhere all re-derived the same nearest
 * five and the chips were decorative here. The seeded path
 * (distance-open-now.spec.ts) ranks on the seed bar's own tags and never had
 * that collapse, which is why it stayed green throughout.
 *
 * The catalog spans the three existing scopes. One degree of latitude is
 * ~69 miles, so the offset names the band and no new threshold is invented.
 */
const bandOrigin = { lat: 40.751, lng: -73.99 };
const at = (id: string, name: string, miles: number) => ({
  id, name, lat: bandOrigin.lat + miles / 69, lng: bandOrigin.lng,
  tags: ['pub'], neighborhood: 'Chelsea', price_tier: 2, hours: null,
  place_id: null, business_status: 'OPERATIONAL', last_verified: '2026-09-06',
});
// rowsToCatalog rejects a catalog under 100 rows outright, so the walk band
// carries the filler: 90 bars inside RADIUS_WALK, then the two outer bands.
const bandRows = [
  ...Array.from({ length: 80 }, (_, i) => ({ ...at(`closed-${i}`, `Closed ${i}`, 0.2), business_status: 'CLOSED_PERMANENTLY' })),
  ...Array.from({ length: 10 }, (_, i) => at(`near-${i}`, `Near ${i}`, 0.05 + i * 0.01)),
  ...Array.from({ length: 5 }, (_, i) => at(`cab-${i}`, `Cab ${i}`, 2.5 + i * 0.1)),
  ...Array.from({ length: 5 }, (_, i) => at(`far-${i}`, `Far ${i}`, 8 + i * 0.1)),
];
/**
 * Route payload for whatever the client actually asked about. The BUNDLED
 * catalog renders before the Supabase refresh lands, so the first search can
 * ask about bars this fixture has never heard of — answering only for the ones
 * it knows keeps that transient state from reading as a routing failure.
 */
const isBandBar = (id: string) => bandRows.some((row) => row.id === id);
const bandRoutes = (ids: string[], band: string) => ({
  routes: ids.filter(isBandBar).filter(id => band === 'walkable' ? id.startsWith('near-') : band === 'cab' ? id.startsWith('cab-') : id.startsWith('far-')).slice(0, 5).map((id) => {
    const bar = bandRows.find((row) => row.id === id)!;
    return {
      id, destination: { lat: bar.lat, lng: bar.lng },
      walking: { seconds: id.startsWith('near-') ? 600 : 1800, meters: 1000 }, driving: { seconds: 300, meters: 2000 },
    };
  }),
  checked: ids.length, limited: false, incomplete: false,
});
/** The most recent search that ran against this fixture's catalog. */
const lastBandSearch = (posted: string[][]) =>
  posted.filter((ids) => ids.every(isBandBar)).slice(-1)[0];
const headings = (cards: import('@playwright/test').Locator) => cards.locator('h3');
// Exact headings, not substrings: /Near 1/ also matches "Near 10".
const top = (label: string, from = 0) =>
  Array.from({ length: 5 }, (_, i) => `${i + 1}. ${label} ${from + i}`);
const NEAR_TOP = top('Near');
const CAB_TOP = top('Cab');
const FAR_TOP = top('Far');

async function seedBandCatalog(page: import('@playwright/test').Page) {
  await grantGeolocation(page.context(), {
    latitude: bandOrigin.lat, longitude: bandOrigin.lng,
  });
  await page.route('**/rest/v1/bars?*', (route) => route.fulfill({ json: bandRows }));
}

test('each travel selection returns only its own band and refresh preserves it', async ({ page }) => {
  await seedBandCatalog(page);
  const posted: string[][] = [];
  await page.route('**/api/travel', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { enabled: true } });
    const ids = route.request().postDataJSON().ids as string[];
    posted.push(ids);
    return route.fulfill({ json: bandRoutes(ids, route.request().postDataJSON().band) });
  });
  await page.goto('/');
  const cards = page.getByTestId('result-card');
  await expect(cards).toHaveCount(5);
  const group = page.getByRole('group', { name: 'Search radius' });
  await expect(headings(cards)).toHaveText(NEAR_TOP);

  await group.getByRole('button', { name: 'Worth a cab' }).click();
  await expect(headings(cards)).toHaveText(CAB_TOP);
  expect(lastBandSearch(posted)).toContain('near-0');
  expect(lastBandSearch(posted).some((id) => id.startsWith('far-'))).toBe(false);

  await group.getByRole('button', { name: 'Anywhere' }).click();
  await expect(headings(cards)).toHaveText(FAR_TOP);
  expect(lastBandSearch(posted).every(id => id.startsWith('far-'))).toBe(true);

  // Returning to a selection returns its own results, not the last ones shown.
  await group.getByRole('button', { name: 'Walkable' }).click();
  await expect(headings(cards)).toHaveText(NEAR_TOP);

  // History refresh deals the NEXT batch of the CURRENT selection: the bars
  // already shown do not come back wearing fresh route times.
  await page.getByRole('button', { name: '↻ Run it again' }).click();
  await expect(headings(cards)).toHaveText(top('Near', 5));
});

test('a rapid selection change is never overwritten by the previous selection answering late', async ({ page }) => {
  await seedBandCatalog(page);
  const gate: { release: (() => void) | null } = { release: null };
  await page.route('**/api/travel', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { enabled: true } });
    const ids = route.request().postDataJSON().ids as string[];
    // Hold the cab search open so Anywhere can overtake it mid-flight.
    if (route.request().postDataJSON().band === 'cab') {
      await new Promise<void>((resolve) => { gate.release = resolve; });
    }
    return route.fulfill({ json: bandRoutes(ids, route.request().postDataJSON().band) });
  });
  await page.goto('/');
  const cards = page.getByTestId('result-card');
  const group = page.getByRole('group', { name: 'Search radius' });
  await expect(cards).toHaveCount(5);

  await group.getByRole('button', { name: 'Worth a cab' }).click();
  await expect.poll(() => gate.release !== null).toBe(true);
  await group.getByRole('button', { name: 'Anywhere' }).click();
  await expect(headings(cards)).toHaveText(FAR_TOP);

  gate.release!();
  // The abandoned cab answer must not replace what Anywhere is showing.
  await expect(headings(cards)).toHaveText(FAR_TOP);
  await expect(cards.first()).toContainText('Walk ~30 min');
  await expect(group.getByRole('button', { name: 'Anywhere' })).toHaveAttribute('aria-pressed', 'true');
});

test('a selection whose routing fails says so instead of carrying the last selection forward', async ({ page }) => {
  await seedBandCatalog(page);
  await page.route('**/api/travel', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { enabled: true } });
    const ids = route.request().postDataJSON().ids as string[];
    if (ids.some((id) => id.startsWith('far-'))) return route.fulfill({ status: 500, body: 'nope' });
    return route.fulfill({ json: bandRoutes(ids, route.request().postDataJSON().band) });
  });
  await page.goto('/');
  const cards = page.getByTestId('result-card');
  await expect(cards.first()).toContainText('Walk ~10 min');

  await page.getByRole('group', { name: 'Search radius' })
    .getByRole('button', { name: 'Anywhere' }).click();
  await expect(page.getByText('Travel times unavailable. This travel band could not be confirmed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recalculate from this starting point' })).toBeVisible();
  // The failed selection still shows ITS OWN band, with no minutes invented
  // and none inherited from the selection that did resolve.
  await expect(headings(cards)).toHaveText(FAR_TOP);
  await expect(cards.filter({ hasText: /~\d+ min/ })).toHaveCount(0);
});
