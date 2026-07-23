/**
 * map-interaction.spec.ts
 *
 * Behavioral coverage for the /map fixes:
 *  1. Bars render as markers on the map.
 *  2. Single-finger drag pans the map (gesture-handling is OFF on this full
 *     view, so default Leaflet one-pointer dragging is active).
 *  3. "Use my location" grabs geolocation and plots the user marker.
 */

import { test, expect } from '@playwright/test';

// NYC — inside the curated bar region, so a fix lands among the markers.
const NYC = { latitude: 40.725, longitude: -73.985, accuracy: 20 };
// A rough fix far from any curated neighborhood → classifies as granted_coarse
// (accuracy > 200m and no neighborhood snap), where coords resolve to null.
const COARSE_FAR = { latitude: 51.5074, longitude: -0.1278, accuracy: 3000 };

test.describe('/map interaction', () => {
  test('renders bar markers', async ({ page }) => {
    await page.goto('/map');
    await expect(page.getByRole('heading', { name: /^Map$/ })).toBeVisible();
    // Leaflet attribution confirms the map booted.
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });
    // Bars are plotted as Leaflet marker icons.
    const markers = page.locator('.leaflet-marker-icon');
    await expect(markers.first()).toBeVisible({ timeout: 15_000 });
    expect(await markers.count()).toBeGreaterThan(0);
  });

  test('single-finger pan is enabled (no gesture-handling lock) and pans', async ({
    page,
  }) => {
    await page.goto('/map');
    const container = page.locator('.leaflet-container');
    await expect(container).toBeVisible({ timeout: 15_000 });

    // Gesture-handling (two-finger lock) must be OFF on the full map view.
    await expect(container).not.toHaveClass(/leaflet-gesture-handling/);

    // A single-pointer drag should move the tile pane (i.e. the map pans).
    const pane = page.locator('.leaflet-map-pane');
    const before = await pane.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    const box = await container.boundingBox();
    if (!box) throw new Error('no map bounding box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 120, cy - 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await pane.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    expect(after).not.toBe(before);
  });

  test('"Use my location" plots the user location', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(NYC);
    await page.goto('/map');

    await page.getByRole('button', { name: /Use my location/i }).click();

    await expect(page.getByText(/Showing your location on the map/i)).toBeVisible(
      { timeout: 15_000 },
    );
    // The button flips to the update affordance once located.
    await expect(
      page.getByRole('button', { name: /Update my location/i }),
    ).toBeVisible();
  });

  test('a too-rough location explains itself instead of silently no-op-ing', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(COARSE_FAR);
    await page.goto('/map');

    await page.getByRole('button', { name: /Use my location/i }).click();

    // The coarse outcome must surface a message, not leave the button in a
    // silent gap between "locating" and "failed".
    await expect(page.getByText(/too rough to pin exactly/i)).toBeVisible({
      timeout: 15_000,
    });
    // No "you are here" claim, since coords are null for a coarse fix.
    await expect(
      page.getByText(/Showing your location on the map/i),
    ).toHaveCount(0);
  });
});
