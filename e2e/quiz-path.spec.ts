/**
 * quiz-path.spec.ts
 *
 * End-to-end: navigate directly to /quiz, complete the 6-question vibe quiz,
 * pick a neighborhood on the LocationPrompt (avoids the geolocation popup),
 * and confirm 3 result cards render with "Vibe match" text.
 *
 * Quiz route is /quiz (post Beli-style restructure — home / is Where-next).
 *
 * Quiz answers (cocktail-leaning):
 *   Q1  "A hidden cocktail spot"       → speakeasy, cocktail, polished
 *   Q2  "Mellow — we wanna talk"       → chill
 *   Q3  "Jazz / lounge"                → jazz, lounge
 *   Q4  "Industry / creative"          → industry, cocktail
 *   Q5  "Treating myself"              → pricey, cocktail
 *   Q6  "Anywhere works"               → preferredNeighborhoods = []
 * Combined tags: speakeasy, cocktail, polished, chill, jazz, lounge, industry, pricey
 * On LocationPrompt we pick "East Village" — 4 bars match at Jaccard ≥ 0.10.
 */

import { test, expect, type Page } from '@playwright/test';

async function completeQuiz(page: Page): Promise<void> {
  await expect(page.getByText('Friday, 11pm. What sounds good?')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'A hidden cocktail spot' }).click();

  await expect(page.getByText('What energy are you bringing?')).toBeVisible();
  await page.getByRole('button', { name: 'Mellow — we wanna talk' }).click();

  await expect(page.getByText('Soundtrack of the night?')).toBeVisible();
  await page.getByRole('button', { name: 'Jazz / lounge' }).click();

  await expect(page.getByText('Who do you wanna be around?')).toBeVisible();
  await page.getByRole('button', { name: 'Industry / creative' }).click();

  await expect(page.getByText('Spending vibe tonight?')).toBeVisible();
  await page.getByRole('button', { name: 'Treating myself' }).click();

  await expect(page.getByText('Any neighborhoods you love?')).toBeVisible();
  await page.getByRole('button', { name: 'Anywhere works' }).click();
}

async function reachQuizResults(page: Page): Promise<void> {
  await page.goto('/quiz');
  await completeQuiz(page);

  await expect(page.getByRole('button', { name: /Or pick a neighborhood/i })).toBeVisible();
  await page.getByRole('button', { name: /Or pick a neighborhood/i }).click();

  await expect(page.getByRole('button', { name: 'East Village' })).toBeVisible();
  await page.getByRole('button', { name: 'East Village' }).click();

  await expect(
    page.locator('article').filter({ hasText: /Vibe match/i }).first(),
  ).toBeVisible();
}

test.describe('Quiz path', () => {
  test('navigates to /quiz, completes 6-question quiz, picks neighborhood, sees 3 result cards', async ({ page }) => {
    await reachQuizResults(page);

    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    // Quiz path shows top 10. East Village + cocktail-leaning currently
    // yields fewer than 10 candidates (5 East Village bars total), so just
    // assert at least 3 cards render.
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(10);
  });

  test('results show a subtle dismissible install nudge, not the full marketing CTA', async ({ page }) => {
    await reachQuizResults(page);

    // The subtle nudge is present...
    const nudge = page.getByTestId('install-nudge');
    await expect(nudge).toBeVisible();
    await expect(nudge).toContainText('Add Next Bar to your home screen');

    // ...but the heavy AppStoreCta marketing block must NOT bleed into this
    // functional flow (it belongs only on /install + Settings).
    await expect(page.getByText('Install now · App Store coming')).toHaveCount(0);

    // Dismissing hides it and persists so it never nags again.
    await page.getByRole('button', { name: 'Dismiss install prompt' }).click();
    await expect(nudge).toHaveCount(0);
    const dismissed = await page.evaluate(() =>
      window.localStorage.getItem('next-bar:install-nudge-dismissed:v1'),
    );
    expect(dismissed).toBe('1');
  });
});
