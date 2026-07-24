/**
 * rating-and-nav.spec.ts
 *
 * Coverage after the U2-3 restructure (operator decision 2026-07-25:
 * suggestion cards are for deciding, ranking lives on /rankings):
 *   1. Bottom nav switches between the 5 app tabs.
 *   2. "Rank it →" on a quiz result deep-links to /rankings with the tier
 *      sheet armed for THAT bar; picking a tier lands it in the list.
 *   3. Same deep link works from the Where-next results on /.
 *   4. Pass-rating via the deep-link flow excludes the bar from subsequent
 *      quiz results (matcher consumes ratings as an exclusion list).
 *
 * Each test resets localStorage so they don't bleed into each other.
 */

import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

async function completeCocktailQuiz(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'A hidden cocktail spot' }).click();
  await page.getByRole('button', { name: 'Mellow — we wanna talk' }).click();
  await page.getByRole('button', { name: 'Jazz / lounge' }).click();
  await page.getByRole('button', { name: 'Industry / creative' }).click();
  await page.getByRole('button', { name: 'On a date' }).click();
  await page.getByRole('button', { name: 'Treating myself' }).click();
  await page.getByRole('button', { name: 'Anywhere works' }).click();
  await page.getByRole('button', { name: /Or pick a neighborhood/i }).click();
  await page.getByRole('button', { name: 'East Village' }).click();
}

async function clearRatings(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    // Re-ack the 21+ age gate (H1) — the config storageState seeded it,
    // and clearing storage must not resurface the overlay mid-test.
    window.localStorage.setItem('next-bar:age-ack:v1', '1');
  });
}

/** First result card's bar name, with the "1. " rank prefix stripped. */
async function firstCardBarName(page: Page): Promise<string> {
  const cards = page.locator('article').filter({ hasText: /Vibe match/i });
  await expect(cards.first()).toBeVisible();
  const headingText =
    (await cards.first().getByRole('heading').textContent()) ?? '';
  const name = headingText.replace(/^\d+\.\s*/, '').trim();
  expect(name.length).toBeGreaterThan(0);
  return name;
}

test.describe('Bottom nav + rating flow', () => {
  test.beforeEach(async ({ page }) => {
    // Home is location-first; deny geo so `/` deterministically lands on the
    // manual pick-a-bar flow these tests drive.
    await denyGeolocation(page.context());
    await clearRatings(page);
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

  test('"Rank it" on a quiz result opens the tier sheet on /rankings for that bar; Loved lands it in the list', async ({
    page,
  }) => {
    await page.goto('/quiz');
    await completeCocktailQuiz(page);

    const barName = await firstCardBarName(page);
    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    expect(await cards.count()).toBeGreaterThanOrEqual(3);

    // U2-3: cards no longer carry rating buttons — ranking is a deep link.
    await expect(
      cards.first().getByRole('button', { name: 'Loved' }),
    ).toHaveCount(0);
    await cards.first().getByRole('link', { name: /Rank it/i }).click();

    // Lands on /rankings with the tier sheet already open for THAT bar.
    await expect(page).toHaveURL(/\/rankings/);
    // Scope to the tier SHEET — the rankings filter pills also say "Loved".
    const sheet = page.getByRole('dialog');
    await expect(sheet).toContainText(`How was ${barName}?`);
    await sheet.getByRole('button', { name: /^Loved/ }).click();

    // Tier pick must not navigate anywhere (URL-hygiene class from the
    // pre-U2-3 specs, ported).
    await expect(page).toHaveURL(/\/rankings$/);

    // First-ever rating → no comparison peers → straight into the list.
    const rankedCards = page.locator('article');
    await expect(rankedCards).toHaveCount(1);
    await expect(rankedCards.first()).toContainText(barName);
    await expect(rankedCards.first()).toContainText(/Loved/i);
  });

  test('"Rank it" works from the Where-next results on /', async ({ page }) => {
    await page.goto('/');

    // Pick Attaboy → bypass GPS (denied in headless) → Walking radius → results
    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Walking' }).click();
    await page.getByRole('button', { name: /Show me bars/i }).click();

    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(cards.first()).toBeVisible();
    const barName = await firstCardBarName(page);

    await cards.first().getByRole('link', { name: /Rank it/i }).click();
    await expect(page).toHaveURL(/\/rankings/);
    // Tier sheet is armed for the same bar (scoped: filter pills also say Liked).
    const sheet = page.getByRole('dialog');
    await expect(sheet).toContainText(`How was ${barName}?`);
    await expect(sheet.getByRole('button', { name: /^Liked/ })).toBeVisible();
  });

  test('Pass via the deep-link flow excludes the bar from subsequent quiz results', async ({
    page,
  }) => {
    // Run 1 — complete quiz, capture the first result's bar name.
    await page.goto('/quiz');
    await completeCocktailQuiz(page);
    const passedBarName = await firstCardBarName(page);

    // Rank it → /rankings tier sheet → Pass.
    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await cards.first().getByRole('link', { name: /Rank it/i }).click();
    await expect(page).toHaveURL(/\/rankings/);
    const sheet = page.getByRole('dialog');
    await expect(sheet).toContainText(`How was ${passedBarName}?`);
    await sheet.getByRole('button', { name: /^Pass/ }).click();
    // The pass landed: rankings shows it under the Pass filter state.
    await expect(page.locator('article').first()).toContainText(passedBarName);

    // Run 2 — retake the quiz with the same answers; the passed bar must
    // not appear (matcher exclusion).
    await page.goto('/quiz');
    await completeCocktailQuiz(page);

    const newCards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(newCards.first()).toBeVisible();
    const headings = await newCards.getByRole('heading').allTextContents();
    const names = headings.map((h) => h.replace(/^\d+\.\s*/, '').trim());
    expect(names).not.toContain(passedBarName);
  });
});
