/**
 * rating-and-nav.spec.ts
 *
 * Coverage after QA5-S1 (operator 2026-07-26): ranking entry moved OFF
 * result cards — the per-card "Rank it →" link is gone, so this spec now
 * covers only the bottom nav. The /rankings?add=<barId> deep-link flow
 * (tier sheet arming, Pass exclusion, list landing) is exercised by
 * pairwise-flow.spec.ts, which navigates to the deep link directly.
 *
 * Removed here (operator 2026-07-26, ranking entry moved off result
 * cards): the two "Rank it" click tests (quiz result + Where-next
 * results) and the Pass-deep-link test that started from a card.
 */

import { test, expect } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

test.describe('Bottom nav', () => {
  test.beforeEach(async ({ page }) => {
    // Home is location-first; deny geo so `/` deterministically lands on the
    // manual pick-a-bar flow these tests drive.
    await denyGeolocation(page.context());
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.clear();
      // Re-ack the 21+ age gate (H1) — the config storageState seeded it,
      // and clearing storage must not resurface the overlay mid-test.
      window.localStorage.setItem('next-bar:age-ack:v1', '1');
    });
  });

  test('bottom nav switches between the 5 app tabs', async ({ page }) => {
    await page.goto('/');

    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav).toBeVisible();

    await nav.getByRole('link', { name: 'Map' }).click();
    await expect(page).toHaveURL(/\/map$/);

    await nav.getByRole('link', { name: 'Rankings' }).click();
    await expect(page).toHaveURL(/\/rankings$/);

    await nav.getByRole('link', { name: 'Friends' }).click();
    await expect(page).toHaveURL(/\/friends$/);

    await nav.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);

    await nav.getByRole('link', { name: 'Next Bar?' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
