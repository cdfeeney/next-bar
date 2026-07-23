/**
 * share-card.spec.ts — blueprint B3 (shareable pick cards).
 *
 * The recipient-side share page must render logged-out with the pick card
 * and app CTA, 404 unknown bars, and the vote result screen must offer the
 * share button (share-sheet/clipboard behavior itself is engine-gated, so
 * we assert presence, not the native sheet).
 */

import { test, expect } from '@playwright/test';

test.describe('Shareable pick cards', () => {
  test('share page renders the pick card and app CTA', async ({ page }) => {
    await page.goto('/share/death-and-co');

    await expect(page.getByText(/Tonight's pick/i)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Death & Co/i }),
    ).toBeVisible();
    await expect(page.getByText(/East Village/i)).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Get Next Bar/i }),
    ).toBeVisible();
  });

  test('unknown bar id 404s', async ({ page }) => {
    const response = await page.goto('/share/not-a-real-bar');
    expect(response?.status()).toBe(404);
  });

  test('vote result screen offers the share button', async ({ page }) => {
    await page.goto('/friends/consensus');
    await page.getByRole('button', { name: /Put it to a vote/i }).click();
    await expect(page.getByText(/Tonight's pick/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Share the pick/i }),
    ).toBeVisible();
  });
});
