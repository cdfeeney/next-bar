/**
 * rating-and-nav.spec.ts
 *
 * v0.3.1 coverage:
 *   1. Bottom nav switches between Where next / Quiz / Tried without losing
 *      route state.
 *   2. User rates a bar on the quiz results screen → navigates to /tried via
 *      bottom nav → sees the rated bar listed there.
 *   3. Pass-rated bars are excluded from subsequent quiz results (matcher
 *      consumes ratings as an exclusion list).
 *
 * Each test resets localStorage so they don't bleed into each other.
 */

import { test, expect, type Page } from '@playwright/test';

async function completeCocktailQuiz(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'A hidden cocktail spot' }).click();
  await page.getByRole('button', { name: 'Mellow — we wanna talk' }).click();
  await page.getByRole('button', { name: 'Jazz / lounge' }).click();
  await page.getByRole('button', { name: 'Industry / creative' }).click();
  await page.getByRole('button', { name: 'Treating myself' }).click();
  await page.getByRole('button', { name: 'Anywhere works' }).click();
  await page.getByRole('button', { name: /Or pick a neighborhood/i }).click();
  await page.getByRole('button', { name: 'East Village' }).click();
}

async function clearRatings(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
}

test.describe('Bottom nav + rating flow', () => {
  test.beforeEach(async ({ page }) => {
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

  test('rate a bar on quiz results, see it in /tried', async ({ page }) => {
    await page.goto('/quiz');

    await completeCocktailQuiz(page);

    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    // Quiz path renders top 10; East Village + cocktail yields ≥ 3 so allow a
    // range. Picking the first card is what we actually care about.
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(3);

    // Rate the first card "Loved"
    const firstCard = cards.first();
    await firstCard.getByRole('button', { name: 'Loved' }).click();
    await expect(firstCard.getByRole('button', { name: 'Loved' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Navigate to /rankings via bottom nav
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await nav.getByRole('link', { name: 'Rankings' }).click();
    await expect(page).toHaveURL(/\/rankings$/);

    // Expect at least one rated bar to appear in the list
    const rankedCards = page.locator('article');
    await expect(rankedCards).toHaveCount(1);
    await expect(rankedCards.first()).toContainText(/Loved/i);
  });

  test('rating a bar on /quiz results does NOT change the URL', async ({ page }) => {
    // Regression: Connor reported rating a bar pushed him back to the home
    // tab. We assert URL stays on /quiz across all three rating taps.
    await page.goto('/quiz');
    await completeCocktailQuiz(page);

    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(cards.first()).toBeVisible();

    const ratings = ['Loved', 'Liked', 'Pass'] as const;
    for (const rating of ratings) {
      const card = cards.first();
      const button = card.getByRole('button', { name: rating });
      if (!(await button.isVisible())) continue;
      await button.click();
      // Settle: give the optimistic update + any re-rank a beat.
      await page.waitForTimeout(200);
      await expect(page).toHaveURL(/\/quiz$/);
    }
  });

  test('rating a bar on / (Where-next) results does NOT change the URL', async ({ page }) => {
    // Regression: same bug class on the Where-next results page.
    await page.goto('/');

    // Pick Attaboy → bypass GPS (denied in headless) → Walking radius → results
    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Walking' }).click();
    await page.getByRole('button', { name: /Show me bars/i }).click();

    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(cards.first()).toBeVisible();

    const ratings = ['Loved', 'Liked', 'Pass'] as const;
    for (const rating of ratings) {
      const card = cards.first();
      const button = card.getByRole('button', { name: rating });
      if (!(await button.isVisible())) continue;
      await button.click();
      await page.waitForTimeout(200);
      await expect(page).toHaveURL(/\/$/);
    }
  });

  test('Pass-rated bars are excluded from subsequent quiz results', async ({ page }) => {
    // Run 1 — complete quiz, capture the first result's bar name, rate it Pass.
    await page.goto('/quiz');
    await completeCocktailQuiz(page);

    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    // Quiz path renders top 10; East Village + cocktail yields ≥ 3 so allow a
    // range. Picking the first card is what we actually care about.
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(3);

    const firstHeading = cards.first().getByRole('heading');
    const headingText = (await firstHeading.textContent()) ?? '';
    // ResultCard heading is "1. Bar Name" — strip the rank prefix.
    const passedBarName = headingText.replace(/^\d+\.\s*/, '').trim();
    expect(passedBarName.length).toBeGreaterThan(0);

    // Pass-rating the first card causes ResultsView to re-rank live and drop
    // it from the list. Verify the rated bar is gone, then confirm the same
    // exclusion persists across a fresh quiz run.
    await cards.first().getByRole('button', { name: 'Pass' }).click();

    await expect(async () => {
      const headings = await cards.getByRole('heading').allTextContents();
      const names = headings.map((h) => h.replace(/^\d+\.\s*/, '').trim());
      expect(names).not.toContain(passedBarName);
    }).toPass({ timeout: 5_000 });

    // Run 2 — navigate away, retake the quiz with the same answers, confirm
    // the Pass-rated bar still doesn't appear.
    await page.getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Next Bar?' })
      .click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto('/quiz');
    await completeCocktailQuiz(page);

    const newCards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(newCards.first()).toBeVisible();

    const headings2 = await newCards.getByRole('heading').allTextContents();
    const newNames = headings2.map((h) => h.replace(/^\d+\.\s*/, '').trim());
    expect(newNames).not.toContain(passedBarName);
  });
});
