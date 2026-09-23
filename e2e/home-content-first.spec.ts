/**
 * home-content-first.spec.ts — NB-01 results screen (owner-approved mock v3,
 * 2026-09-23) as corrected by NB-01b: the location PRIMER stays as the first
 * screen for anyone who has not shared location (that case lives in
 * home-location-first.spec.ts); this spec pins the results screen itself.
 *
 * With permission granted the home renders in the approved order: wordmark,
 * Tweak the vibe, distance control, the "Near you" line, cards. The retired
 * header strings and the Planning chip are gone; each card carries one meta
 * line and one "Photos & hours" action, no drive line, no Maps links.
 */

import { test, expect } from './helpers/catalogTest';
import { grantGeolocation } from './helpers/geo';
import type { Locator } from '@playwright/test';

async function centreY(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box');
  return box.y + box.height / 2;
}

test.describe('Home — results screen (NB-01)', () => {
  test('granted: approved order, retired strings gone, one meta line + one action per card', async ({
    page,
    context,
  }) => {
    await grantGeolocation(context, { latitude: 40.725, longitude: -73.985 });
    await page.goto('/');

    const cards = page.getByTestId('result-card');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });

    // Retired chrome.
    await expect(page.getByText(/Your next \d+ bars?/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Night phase/i })).toHaveCount(0);
    await expect(page.getByText(/^Drive ~/)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /directions/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Maps →/ })).toHaveCount(0);

    // Order: wordmark → Tweak the vibe → distance control → Near line → cards.
    const wordmark = page.getByText('Next Bar', { exact: true }).first();
    const tweak = page.getByRole('button', { name: /tweak the vibe/i });
    const walkable = page.getByRole('button', { name: /walkable/i });
    const near = page.getByText('Near you', { exact: true });
    const ys = await Promise.all([wordmark, tweak, walkable, near, cards.first()].map(centreY));
    for (let i = 1; i < ys.length; i += 1) expect(ys[i]).toBeGreaterThan(ys[i - 1]);

    // Cards: one "Photos & hours" action each.
    const count = await cards.count();
    for (let i = 0; i < count; i += 1) {
      await expect(cards.nth(i).getByRole('button', { name: /^Photos & hours$/ })).toHaveCount(1);
    }
    await cards.first().getByRole('button', { name: /^Photos & hours$/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
