/**
 * vibe-tweak-ranking.spec.ts
 *
 * The Tweak-the-vibe RANKING contract, on the real surface.
 *
 * An APPLIED pick ranks on the explicit 80/20 path (src/lib/matching.ts,
 * EXPLICIT_VIBE_WEIGHT); merely OPENING the surface must change nothing. The
 * weighting arithmetic itself is pinned deterministically in
 * src/lib/matching.explicitVibe.test.ts — what these two carry is that the
 * flag reaches the ranker at all, and that Cancel never activates it.
 */

import { test, expect } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

// Same fixed clock as where-next-path.spec.ts: the live surfaces hard-filter
// KNOWN-closed bars, so counts are only deterministic under a mocked clock.
const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00');

const seedResultsFromAttaboy = async (page: import('@playwright/test').Page) => {
  await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
  await page.getByRole('button', { name: /Attaboy/ }).click();
  const cards = page.locator('article').filter({ hasText: /Vibe match/i });
  await expect(cards.first()).toBeVisible();
  return cards;
};

test.describe('Tweak the vibe — ranking', () => {
  test('opening the surface and cancelling leaves the ranking untouched', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    const cards = await seedResultsFromAttaboy(page);
    const before = await cards.locator('h3').allInnerTexts();
    expect(before.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: /Tweak the vibe/i }).click();
    await expect(
      page.getByRole('heading', { name: /Tweak the vibe/i }),
    ).toBeVisible();
    await page.getByRole('button', { name: /^Cancel$/ }).click();

    // Same bars, same order — Cancel is not a quiet Apply.
    await expect(cards.first()).toBeVisible();
    expect(await cards.locator('h3').allInnerTexts()).toEqual(before);
    await expect(page).toHaveURL('/');
  });

  test('an APPLIED pick leads the page with a bar that matches it', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    const cards = await seedResultsFromAttaboy(page);
    await page.getByRole('button', { name: /Tweak the vibe/i }).click();
    await page.getByRole('button', { name: /^Apply$/ }).click();

    // On the explicit path a MATCHING bar outranks anything the rating
    // history merely favours, so the top card cannot be a 0-tag match.
    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).not.toContainText('Vibe match 0/');
  });
});
