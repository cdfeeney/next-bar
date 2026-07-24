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

test('a DENIED location explains itself with recovery steps instead of failing silently', async ({
  page,
}) => {
  await denyGeolocation(page.context());
  await page.goto('/');

  // The manual picker still works…
  await expect(page.getByRole('textbox', { name: 'Search bars' })).toBeVisible();
  // …and the block is explained, with a retry affordance (operator report:
  // iOS can silently refuse to ever show the prompt).
  await expect(page.getByText(/location is blocked for this site/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();
});

test('an UNDECIDED permission shows the primer — the real prompt fires from the tap, not on load', async ({
  page,
}) => {
  // Default context: permission state 'prompt' (never asked). The app must
  // NOT auto-fire the browser prompt on load — it primes with its own
  // value proposition and a gesture-bound button (web research: load-time
  // prompts get reflex-dismissed and iOS remembers that as a permanent
  // deny; gesture-bound asks get approved).
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: /find bars near you/i }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /share my location/i }),
  ).toBeVisible();

  // The manual path stays one tap away.
  await page.getByRole('button', { name: /pick a bar instead/i }).click();
  await expect(page.getByRole('textbox', { name: 'Search bars' })).toBeVisible();
});

test('the manual screen keeps "use my location" one tap away (no reload needed)', async ({
  page,
}) => {
  await page.goto('/');
  // Wait for the PRIMER to settle before clicking — the spinner screen has
  // its own "Pick a bar instead" whose mid-swap coordinates land on the
  // primer's "Share my location" (detachment race caught in CI).
  await expect(
    page.getByRole('heading', { name: /find bars near you/i }),
  ).toBeVisible();
  await page.getByRole('button', { name: /pick a bar instead/i }).click();
  await expect(page.getByRole('textbox', { name: 'Search bars' })).toBeVisible();
  // …and the location path is still right there.
  await expect(
    page.getByRole('button', { name: /use my location/i }),
  ).toBeVisible();
});
