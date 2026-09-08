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
    }).filter(Boolean);
    return route.fulfill({ json: { routes, checked: body.ids.length, limited: false, incomplete: false } });
  });
  await page.goto('/');
  await page.addStyleTag({ content: `html { font-size: ${textSize}%; }` });
  await expect(page.locator('article').filter({ hasText: 'Vibe match' }).first()).toContainText('Distance Fixture');
  await expect(page.getByText('Catalog refresh unavailable — showing the emergency set.')).toHaveCount(0);
  if (coarse) await expect(page.getByText('Approximate — based on Chelsea', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calculate travel times' })).toHaveCount(0);
  const cards = page.locator('article').filter({ hasText: 'Vibe match' });
  await expect(cards).toHaveCount(5);
  await expect(cards.first()).toContainText('Walk ~10 min');
  await expect(cards.first()).toContainText('Drive ~5 min');
  await expect(cards.nth(3)).toContainText('Walk ~16 min');
  await expect(cards.nth(4)).toContainText('Walk ~22 min');
  await expect(page.getByRole('heading', { name: 'A little farther away' })).toBeVisible();
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
  await expect(page.getByText('Travel times expired. Walkable is not confirmed.')).toBeVisible();
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
  await expect(page.getByText('Route times unavailable. These suggestions are not confirmed within a 15-minute walk.')).toBeVisible();
  const cards = page.locator('article').filter({ hasText: 'Vibe match' });
  await expect(cards).toHaveCount(5);
  await expect(cards.first()).toContainText('Walk time unavailable');
  await expect(cards.first()).toContainText('Drive time unavailable');
  await expect(cards.filter({ hasText: /~\d+ min/ })).toHaveCount(0);
  expect(posts).toBe(0);
});
