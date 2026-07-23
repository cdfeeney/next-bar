/**
 * lists-flow.spec.ts — blueprint A3 (Letterboxd-core lists).
 *
 * Happy path: create a named list, add a bar from the catalog picker,
 * remove it, and confirm the list survives a reload (localStorage).
 */

import { test, expect, type Locator } from '@playwright/test';

/**
 * WebKit (iPhone 13): `.fill()` on a controlled input can race React
 * hydration/onChange — click + pressSequentially produces real key events
 * both engines handle consistently (same footgun documented in
 * auth-page.spec.ts).
 */
async function typeInto(input: Locator, value: string): Promise<void> {
  await input.click();
  await input.pressSequentially(value);
  await expect(input).toHaveValue(value);
}

test.describe('Lists', () => {
  test('create → add bar → remove → persists across reload', async ({
    page,
  }) => {
    await page.goto('/lists');
    await expect(page.getByText(/No lists yet/i)).toBeVisible();

    // Create a list; it opens expanded.
    await typeInto(page.getByLabel('New list name'), 'Top 10 date bars');
    await page.getByRole('button', { name: /^Create$/ }).click();
    // The card header's accessible name is "<list name> <n> bars" — the
    // Delete button also contains the list name, so match the full shape.
    await expect(
      page.getByRole('button', { name: /^Top 10 date bars 0 bars$/ }),
    ).toBeVisible();
    await expect(page.getByText(/Empty so far/i)).toBeVisible();

    // Add Death & Co via the picker.
    await page.getByRole('button', { name: /Add a bar/i }).click();
    await typeInto(page.getByLabel('Search bars'), 'Death');
    await page.getByRole('button', { name: /Death & Co/i }).click();
    await page.getByRole('button', { name: /^Done$/ }).click();
    await expect(page.getByText(/1 bar\b/)).toBeVisible();
    await expect(page.getByText(/Death & Co/i)).toBeVisible();

    // Survives reload.
    await page.reload();
    const cardHeader = page.getByRole('button', {
      name: /^Top 10 date bars 1 bar$/,
    });
    await expect(cardHeader).toBeVisible();

    // Remove the bar.
    await cardHeader.click();
    await page
      .getByRole('button', { name: /Remove Death & Co/i })
      .click();
    await expect(page.getByText(/0 bars/)).toBeVisible();
  });

  test('rankings header links to lists', async ({ page }) => {
    await page.goto('/rankings');
    await page.getByRole('link', { name: /Your lists/i }).click();
    await expect(
      page.getByRole('heading', { name: /Your lists/i }),
    ).toBeVisible();
  });
});
