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
 *
 * Seeding rating history is what makes that DISCRIMINATING, and it is not
 * decoration. With no ratings deriveLearnedTaste yields confidence = 0, so
 * rankScore collapses to the quiz-tag jaccard and matching bars already lead
 * on the OLD path — the assertion below then passed whether or not the flag
 * reached the ranker at all. The seed scores the pick's own tags DOWN, so on
 * the normal path learned taste buries every matching bar and only the
 * explicit path can bring one back to the top.
 */

import { test, expect } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

// Same fixed clock as where-next-path.spec.ts: the live surfaces hard-filter
// KNOWN-closed bars, so counts are only deterministic under a mocked clock.
const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00');

/**
 * Bars carrying Attaboy's own tags (cocktail / speakeasy / polished), all
 * scored 1.0. N = 23, so c = 23/33 = 0.70 and A(cocktail) is strongly
 * negative: on the quiz-prior path these tags are now evidence AGAINST a bar.
 * Written through addInitScript so it is in place before the app's first read.
 */
const DISLIKED_COCKTAIL_BARS = [
  'death-and-co',
  'pdt',
  'amor-y-amargo',
  'holiday-cocktail-lounge',
  'employees-only',
  'little-branch',
  'bathtub-gin',
  'the-tippler',
  'dead-rabbit',
  'trinity-place',
  'the-campbell',
  'rum-house',
  'bar-sixtyfive',
  'owls-tail',
  'prohibition',
  'bemelmans-bar',
  'auction-house',
  'westlight',
  'pearls-social-and-billy-club',
  'the-sampler',
  'the-wayland',
  'watermark-bar',
  'broken-land',
];

const seedAntiCocktailHistory = async (
  page: import('@playwright/test').Page,
) => {
  await page.addInitScript((ids: string[]) => {
    window.localStorage.setItem(
      'next-bar:ratings:v1',
      JSON.stringify(
        ids.map((barId) => ({
          barId,
          rating: 'pass',
          ratedAt: '2026-05-01T00:00:00.000Z',
          score: 1,
        })),
      ),
    );
  }, DISLIKED_COCKTAIL_BARS);
};

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
    await seedAntiCocktailHistory(page);
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    const cards = await seedResultsFromAttaboy(page);
    // The surface pre-fills with the seed bar's OWN tags and Apply hands the
    // very same tags back (WhereNextFlow.tsx: initialTags={step.tags}), so
    // `isExplicitVibe` is the only input that changes across the click. If the
    // flag never reached the ranker this list could not move.
    const before = await cards.locator('h3').allInnerTexts();
    // With the pick's tags scored down, the normal path buries every match.
    await expect(cards.first()).toContainText('Vibe match 0/');

    await page.getByRole('button', { name: /Tweak the vibe/i }).click();
    await page.getByRole('button', { name: /^Apply$/ }).click();
    await expect(cards.first()).toBeVisible();

    // On the explicit path a MATCHING bar outranks anything the rating
    // history merely favours, so the top card cannot be a 0-tag match.
    await expect(cards.first()).not.toContainText('Vibe match 0/');
    expect(await cards.locator('h3').allInnerTexts()).not.toEqual(before);
  });
});
