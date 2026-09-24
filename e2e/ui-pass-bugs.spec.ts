import { test, expect } from './helpers/test';

/**
 * The 2026-09-23 iOS UI pass bug batch (owner-approved 2026-09-24). One
 * assertion per bug that a signed-out browser can see; the signed-in ones
 * (feed settle, own profile, landing path) are pinned in vitest.
 */
test.describe('iOS UI pass bug batch', () => {
  test('onboarding steps carry no tab bar (bug 4)', async ({ page }) => {
    await page.goto('/onboarding/age');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
  });

  test('a group thread is its own route with no tab bar (bug 5)', async ({ page }) => {
    await page.goto('/friends/groups/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText(/sign in to open a group/i)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
  });

  test('catalogue pins are drawing-only at city zoom (bug 6)', async ({ page }) => {
    await page.goto('/map');
    const icons = page.locator('.leaflet-marker-icon');
    await expect(icons.first()).toBeVisible({ timeout: 15_000 });
    // City zoom (13 at load): every catalogue dot is inert; a tap goes to the map.
    const quiet = page.locator('.leaflet-marker-icon.nb-quiet');
    expect(await quiet.count(), 'no catalogue dots rendered').toBeGreaterThan(0);
    const tappable = await quiet.evaluateAll((els) =>
      els.filter((el) => getComputedStyle(el).pointerEvents !== 'none').length,
    );
    expect(tappable, 'an 8px catalogue dot is still a tap target at city zoom').toBe(0);
  });

  test('settings carries no sample night and no install promo (bug 8)', async ({ page }) => {
    await page.goto('/settings/preferences');
    await expect(page.getByRole('heading', { name: /^Settings$/ })).toBeVisible();
    await expect(page.getByText(/sample night/i)).toHaveCount(0);
    await expect(page.getByText(/home screen for the full app/i)).toHaveCount(0);
    await expect(page.getByText(/on this build/i)).toHaveCount(0);
  });

  test('rankings empty state no longer contradicts the sync footer (bug 10)', async ({ page }) => {
    await page.goto('/rankings');
    await expect(page.getByRole('heading', { name: /Nothing here yet/i })).toBeVisible();
    await expect(page.getByText(/stay on this device/i)).toHaveCount(0);
  });
});
