/**
 * rankings-score.spec.ts
 *
 * v0.5.1 coverage for the /rankings score column.
 *
 * The full pairwise flow (rate → PairwiseSheet → /rankings shows updated
 * score) is integration-pending; that e2e lands in phase 3. Here we
 * pre-seed localStorage with bar ratings that already carry pairwise
 * scores and assert /rankings renders + sorts them correctly. This
 * isolates the rankings rendering layer from the not-yet-wired
 * comparison flow.
 *
 * What this guards against:
 *   - Score-desc sort breaking
 *   - The fallback to tier-then-recency disappearing for unscored bars
 *   - The 0.0–10.0 visual column not rendering when score is present
 *   - The "Rank as you compare" hint vanishing for unscored bars
 */

import { test, expect, type Page } from '@playwright/test';

type LocalRating = {
  barId: string;
  rating: 'loved' | 'liked' | 'pass';
  ratedAt: string;
  score?: number;
};

async function seed(page: Page, ratings: LocalRating[]): Promise<void> {
  await page.goto('/');
  await page.evaluate((data) => {
    window.localStorage.setItem('next-bar:ratings:v1', JSON.stringify(data));
  }, ratings);
}

test.describe('/rankings — score column + sort', () => {
  test('renders 0.0–10.0 score for bars that have one and hides it for those that do not', async ({
    page,
  }) => {
    // Use real bar ids from src/lib/bars.ts so the rankings row actually
    // resolves a Bar and renders fully.
    await seed(page, [
      {
        barId: 'attaboy',
        rating: 'loved',
        ratedAt: '2026-05-20T00:00:00.000Z',
        score: 9.5,
      },
      {
        barId: 'death-and-co',
        rating: 'loved',
        ratedAt: '2026-05-21T00:00:00.000Z',
        // no score — should render with the hint instead
      },
    ]);

    await page.goto('/rankings');

    const cards = page.locator('article');
    await expect(cards).toHaveCount(2);

    // Scored bar first (sortRatingsByScore puts scored above unscored).
    const first = cards.first();
    await expect(first).toContainText('Attaboy');
    await expect(first.getByLabel(/score 9\.5 out of 10/i)).toBeVisible();
    await expect(first.getByText(/rank as you compare/i)).not.toBeVisible();

    const second = cards.nth(1);
    await expect(second).toContainText('Death & Co');
    await expect(second.getByText(/rank as you compare/i)).toBeVisible();
  });

  test('sorts scored bars by score descending regardless of rated-at order', async ({
    page,
  }) => {
    // Order in localStorage is intentionally inverse of score order so the
    // test fails if anything other than score-desc is the sort key.
    await seed(page, [
      {
        barId: 'attaboy',
        rating: 'loved',
        ratedAt: '2026-05-20T00:00:00.000Z',
        score: 8.2,
      },
      {
        barId: 'death-and-co',
        rating: 'loved',
        ratedAt: '2026-05-15T00:00:00.000Z',
        score: 9.7,
      },
      {
        barId: 'employees-only',
        rating: 'loved',
        ratedAt: '2026-05-10T00:00:00.000Z',
        score: 8.8,
      },
    ]);

    await page.goto('/rankings');

    const cards = page.locator('article');
    await expect(cards).toHaveCount(3);

    const headings = page.locator('article h2');
    const texts = await headings.allTextContents();
    const names = texts.map((t) => t.replace(/^\d+\.\s*/, '').trim());

    expect(names).toEqual(['Death & Co', 'Employees Only', 'Attaboy']);
  });

  test('falls back to tier-then-recency among unscored bars after scored ones', async ({
    page,
  }) => {
    await seed(page, [
      {
        barId: 'attaboy',
        rating: 'liked',
        ratedAt: '2026-05-20T00:00:00.000Z',
        // unscored Liked, newer
      },
      {
        barId: 'death-and-co',
        rating: 'loved',
        ratedAt: '2026-05-15T00:00:00.000Z',
        // unscored Loved
      },
      {
        barId: 'employees-only',
        rating: 'pass',
        ratedAt: '2026-05-22T00:00:00.000Z',
        score: 4.5,
      },
    ]);

    await page.goto('/rankings');

    const cards = page.locator('article');
    await expect(cards).toHaveCount(3);

    const headings = page.locator('article h2');
    const texts = await headings.allTextContents();
    const names = texts.map((t) => t.replace(/^\d+\.\s*/, '').trim());

    // Scored Pass-tier bar wins because score-presence trumps tier ordering.
    // Then the unscored bars sort by tier (Loved > Liked > Pass).
    expect(names).toEqual(['Employees Only', 'Death & Co', 'Attaboy']);
  });
});
