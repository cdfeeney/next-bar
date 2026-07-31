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

  test('the SERVER answers 307 to /map — not a client-side bounce', async ({
    request,
  }) => {
    // Asserted on the UN-FOLLOWED response, deliberately. Checking only that we
    // end up on /map with a <400 status would pass for a client component that
    // calls router.replace('/map') after hydration — which would violate the
    // server-redirect requirement, ship the client bundle we just archived, and
    // flash the old surface. This is the assertion that can tell them apart.
    // The Location header is the load-bearing half. A `redirect('/map')` page
    // component ALSO answers 307, but with no Location — Next prerenders it as
    // an HTML document that navigates itself, which browsers follow and curl,
    // crawlers and link checkers do not. Asserting the header is what forced
    // the redirect into next.config.js where it belongs.
    const res = await request.get('/discover', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toMatch(/\/map$/);
  });

  test('a direct request lands on /map, not a 404', async ({ page }) => {
    const response = await page.goto('/discover');
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
