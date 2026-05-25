/**
 * a11y-mobile.spec.ts
 *
 * Mobile accessibility checks on the home page (Next Bar? — BarPicker is
 * the app's primary surface):
 *   1. No horizontal scroll (scrollWidth ≤ innerWidth + 1px tolerance)
 *   2. All visible buttons have bounding box height ≥ 44px
 */

import { test, expect } from '@playwright/test';

test.describe('Mobile a11y — home page', () => {
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

    const buttons = page.getByRole('button');
    const count = await buttons.count();

    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);

      const isVisible = await btn.isVisible();
      if (!isVisible) continue;

      const box = await btn.boundingBox();
      if (box === null) continue;
      if (box.height === 0) continue;

      expect(
        box.height,
        `Button "${await btn.textContent()}" has height ${box.height}px — expected ≥ 44px`,
      ).toBeGreaterThanOrEqual(44);
    }
  });
});
