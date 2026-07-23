/**
 * home-location-first.spec.ts
 *
 * The home screen ("/") is location-first:
 *  1. With a location fix, it auto-suggests bars immediately — no bar-picking.
 *  2. Without a fix (denied), it falls back to the manual "pick a bar" flow.
 *  3. The bottom nav shows an enlarged "Next Bar?" action in the center.
 */

import { test, expect } from '@playwright/test';
import { denyGeolocation, grantGeolocation } from './helpers/geo';

test.describe('Home — location-first', () => {
  test('auto-suggests bars from your location, no bar-picking needed', async ({
    page,
    context,
  }) => {
    await grantGeolocation(context, { latitude: 40.725, longitude: -73.985 });
    await page.goto('/');

    // Suggestions render straight away, ranked from the user's location.
    await expect(page.getByRole('heading', { name: /Your next/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Using your location/i)).toBeVisible();
    expect(await page.locator('article').count()).toBeGreaterThan(0);

    // The manual seed prompt is NOT the surface shown when we can locate you.
    await expect(
      page.getByRole('heading', { name: /Where are you\?/i }),
    ).toHaveCount(0);
  });

  test('falls back to pick-a-bar when location is denied', async ({ page }) => {
    await denyGeolocation(page.context());
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: /Where are you\?/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('bottom nav shows an enlarged Next Bar? action in the center', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.goto('/');

    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav).toBeVisible();

    const links = nav.getByRole('link');
    await expect(links).toHaveCount(5);
    // Center (index 2) is the primary action.
    await expect(links.nth(0)).toHaveText(/Map/i);
    await expect(links.nth(1)).toHaveText(/Rankings/i);
    await expect(links.nth(2)).toHaveText(/Next Bar\?/i);
    await expect(links.nth(3)).toHaveText(/Friends/i);
    await expect(links.nth(4)).toHaveText(/Settings/i);

    // The center action is visibly enlarged vs a sibling tab.
    const primaryBox = await links.nth(2).boundingBox();
    const siblingBox = await links.nth(0).boundingBox();
    expect(primaryBox && siblingBox).toBeTruthy();
    expect(primaryBox!.height).toBeGreaterThan(siblingBox!.height);

    // And it routes home.
    await links.nth(2).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
