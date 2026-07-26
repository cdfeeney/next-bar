/**
 * a11y-mobile.spec.ts
 *
 * Mobile accessibility checks on the home page (Next Bar? — BarPicker is
 * the app's primary surface):
 *   1. No horizontal scroll (scrollWidth ≤ innerWidth + 1px tolerance)
 *   2. All visible buttons have bounding box height ≥ 44px
 */

import { test, expect } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

test.describe('Mobile a11y — home page', () => {
  // Home is location-first; deny geo so it falls back to the pick-a-bar surface.
  test.beforeEach(async ({ page }) => {
    await denyGeolocation(page.context());
  });

  test('no horizontal scroll on home page', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /Where are you\?/i }),
    ).toBeVisible();

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(hasHorizontalScroll).toBe(false);
  });

  test('all visible buttons are at least 44px tall', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /Where are you\?/i }),
    ).toBeVisible();

    // ONE in-page pass instead of per-button Playwright round-trips: the
    // home BarPicker lists the whole catalog (400+ buttons at 406 bars),
    // and serial boundingBox calls blew the test budget as the catalog
    // grew (night-3 M5). Same coverage — every rendered button — O(1)
    // protocol round trips at any catalog size.
    const offenders = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll('button'))) {
        const rect = el.getBoundingClientRect();
        if (rect.height === 0 || rect.width === 0) continue; // hidden
        if (rect.height < 44) {
          bad.push(
            `"${(el.textContent ?? '').trim().slice(0, 40)}" height ${rect.height}px`,
          );
        }
      }
      return bad;
    });
    expect(offenders, 'buttons under 44px').toEqual([]);
  });
});
