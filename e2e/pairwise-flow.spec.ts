/**
 * pairwise-flow.spec.ts
 *
 * v0.5.1 — end-to-end coverage for the pairwise comparison flow in
 * signed-out (local) mode. Signed-in / server-mode pairwise lands in a
 * follow-up.
 *
 * What this covers:
 *   - PairwiseSheet does NOT appear on the first Loved rating (no peer).
 *   - Rating a second bar Loved opens the sheet.
 *   - Picking the just-rated bar marks it winner; /rankings reflects the
 *     new score-driven sort.
 *   - Skip dismisses the sheet without recording a comparison.
 *   - The sheet does NOT open for tier="pass" (Q2 decision).
 *
 * Uses the quiz flow because that's the path where RatingControl (and
 * thus the new PairwiseSheet integration) actually renders inside
 * ResultCard. /rankings and /tried don't expose rating buttons.
 */

import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

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

async function clearStorage(page: Page): Promise<void> {
  // Home is location-first; deny geo so `/` settles instantly to the manual
  // surface instead of hanging on the async "Finding bars near you…" spinner.
  await denyGeolocation(page.context());
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
}

test.describe('Pairwise prompt — local mode', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
  });

  test('does NOT appear on the first Loved rating (no peer)', async ({ page }) => {
    await page.goto('/quiz');
    await completeCocktailQuiz(page);

    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(cards.first()).toBeVisible();

    await cards.first().getByRole('button', { name: 'Loved' }).click();
    // Small settle window — the prompt would have opened by now if it
    // were going to. We expect it NOT to.
    await page.waitForTimeout(300);
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('appears on the second Loved rating; picking the just-rated bar updates /rankings', async ({
    page,
  }) => {
    await page.goto('/quiz');
    await completeCocktailQuiz(page);

    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(2);

    const nameOf = async (i: number) =>
      (await cards.nth(i).getByRole('heading').textContent())
        ?.replace(/^\d+\.\s*/, '')
        .trim();

    // Rate first card Loved — no peer yet, no prompt.
    const firstName = await nameOf(0);
    expect(firstName).toBeTruthy();
    await cards.nth(0).getByRole('button', { name: 'Loved' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Loving the first bar re-ranks the list live (loved-affinity term), so the
    // "second" bar must be re-read from the CURRENT order — pick the first card
    // that isn't the one we already Loved.
    let secondName: string | undefined;
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const n = await nameOf(i);
      if (n && n !== firstName) {
        secondName = n;
        await cards.nth(i).getByRole('button', { name: 'Loved' }).click();
        break;
      }
    }
    expect(secondName).toBeTruthy();
    expect(secondName).not.toBe(firstName);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/which did you love more\?/i);
    // Both bars should be referenced in the sheet.
    await expect(dialog).toContainText(firstName as string);
    await expect(dialog).toContainText(secondName as string);

    // Pick the just-rated (second) bar — it's the accent option, rendered
    // first inside the dialog.
    await dialog.getByText(secondName as string).click();
    await expect(dialog).not.toBeVisible();

    // One comparison should be recorded with second as winner.
    const stored = await page.evaluate(() =>
      window.localStorage.getItem('next-bar:pairwise:v1'),
    );
    expect(stored).not.toBeNull();
    const comparisons = JSON.parse(stored as string);
    expect(comparisons).toHaveLength(1);

    // /rankings sorts by score; the winner should come first.
    await page.goto('/rankings');
    const rankCards = page.locator('article');
    await expect(rankCards).toHaveCount(2);
    const headings = await page.locator('article h2').allTextContents();
    const names = headings.map((t) => t.replace(/^\d+\.\s*/, '').trim());
    expect(names[0]).toBe(secondName);
    expect(names[1]).toBe(firstName);
  });

  test('Skip dismisses the sheet without recording a comparison', async ({ page }) => {
    await page.goto('/quiz');
    await completeCocktailQuiz(page);

    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await cards.nth(0).getByRole('button', { name: 'Loved' }).click();
    await cards.nth(1).getByRole('button', { name: 'Loved' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: /skip/i }).click();
    await expect(dialog).not.toBeVisible();

    const stored = await page.evaluate(() =>
      window.localStorage.getItem('next-bar:pairwise:v1'),
    );
    if (stored !== null) {
      expect(JSON.parse(stored)).toEqual([]);
    }
  });

  test('does NOT open for tier="pass"', async ({ page }) => {
    await page.goto('/quiz');
    await completeCocktailQuiz(page);

    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await cards.nth(0).getByRole('button', { name: 'Pass' }).click();
    // First Pass-rated card — re-rank may push it off; tap the new first.
    const passButton = cards.first().getByRole('button', { name: 'Pass' });
    if (await passButton.isVisible()) {
      await passButton.click();
    }
    await page.waitForTimeout(300);
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});
