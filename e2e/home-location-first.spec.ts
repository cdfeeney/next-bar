/**
 * home-location-first.spec.ts
 *
 * The home screen ("/") is location-first:
 *  1. With a location fix, it auto-suggests bars immediately — no bar-picking.
 *  2. Without a fix (denied), it falls back to the manual "pick a bar" flow.
 *  3. The bottom nav shows an enlarged "Next Bar?" action in the center.
 */

import { test, expect } from './helpers/catalogTest';
import { denyGeolocation, grantGeolocation } from './helpers/geo';

test.describe('Home — location-first', () => {
  test('auto-suggests bars from your location, no bar-picking needed', async ({
    page,
    context,
  }) => {
    await grantGeolocation(context, { latitude: 40.725, longitude: -73.985 });
    await page.goto('/');

    // Suggestions render straight away, ranked from the user's location
    // (NB-01: the "Your next N bars" headline is gone; the location line
    // and the cards are the evidence).
    await expect(page.getByTestId('result-card').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Near you', { exact: true })).toBeVisible();

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

  test('bottom nav keeps Next Bar? in the center and marks it current on /', async ({
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
    await expect(links.nth(3)).toHaveText(/Social/i);
    await expect(links.nth(4)).toHaveText(/Account/i);

    // V10-08: HIG tab bar - five equal slots, no raised pill. The current tab
    // is marked by aria-current + tint, not by size.
    await expect(links.nth(2)).toHaveAttribute('aria-current', 'page');
    await expect(links.nth(0)).not.toHaveAttribute('aria-current', 'page');

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

// An UNDECIDED permission no longer shows a primer wall (NB-01, owner
// 2026-09-23): with a saved neighbourhood the home opens on results, without
// one it opens on the picker, and "Use my location" is the gesture-bound tap
// in both — covered by e2e/home-content-first.spec.ts. The browser prompt
// still never fires on load.
test('the manual screen keeps "use my location" one tap away (no reload needed)', async ({
  page,
}) => {
  await page.goto('/');
  // Nothing saved → the picker is the home screen itself.
  await expect(page.getByRole('textbox', { name: 'Search bars' })).toBeVisible({ timeout: 15_000 });
  // …and the location path is right there.
  await expect(
    page.getByRole('button', { name: /use my location/i }),
  ).toBeVisible();
});
