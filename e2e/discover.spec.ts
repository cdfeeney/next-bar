/**
 * discover.spec.ts — /discover is ARCHIVED and redirects to /map (goal
 * g-12d33864).
 *
 * This file used to cover the Tinder-style swipe stack (QA5-S3): save/skip
 * writes into next-bar:list:want-to-go:v1, advance-on-commit, and persistence
 * across a reload. That surface was archived for the current product, so the
 * spec was RE-POINTED rather than deleted: the route still exists as a public
 * URL, and a redirect that silently breaks is exactly the kind of regression a
 * deleted spec stops catching. `git log --follow -- e2e/discover.spec.ts`
 * recovers the swipe coverage if the surface is ever revived.
 *
 * Both the positive (you end up on /map) and the negative (no 404, and no trace
 * of the old surface renders) are asserted, per CLAUDE.md.
 */

import { test, expect } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

test.describe('/discover is archived', () => {
  test.beforeEach(async ({ context }) => {
    // Deterministic: no geo prompt. /map renders the full catalog without one.
    await denyGeolocation(context);
  });

  test('a direct request lands on /map, not a 404', async ({ page }) => {
    const response = await page.goto('/discover');

    // The redirect is served, not errored. Next's redirect() answers 307 and
    // Playwright follows it, so the final response must be a success.
    expect(response?.status()).toBeLessThan(400);

    await expect(page).toHaveURL(/\/map$/);
    await expect(page.getByRole('heading', { name: /^Find Bar$/ })).toBeVisible();

    // NEGATIVE: none of the archived surface survives the redirect.
    await expect(page.getByRole('heading', { name: /^Discover$/ })).toHaveCount(0);
    await expect(page.getByTestId('discover-card')).toHaveCount(0);
  });

  test('the map offers no route back to /discover', async ({ page }) => {
    await page.goto('/map');
    await expect(page.getByRole('heading', { name: /^Find Bar$/ })).toBeVisible();

    // The "Discover →" link used to sit under the search box. Its removal is
    // the acceptance criterion — a redirect alone would still leave a link that
    // bounces the user straight back to the page they were already on.
    await expect(page.locator('a[href="/discover"]')).toHaveCount(0);
  });
});
