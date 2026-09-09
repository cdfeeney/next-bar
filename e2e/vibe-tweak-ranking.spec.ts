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

import { test, expect } from './helpers/catalogTest';
import { denyGeolocation } from './helpers/geo';

// Same fixed clock as where-next-path.spec.ts: the live surfaces hard-filter
// KNOWN-closed bars, so counts are only deterministic under a mocked clock.
// Explicit offset: a timezone-free literal is host-local and pins a different
// night on a UTC runner (V9-11; same species fixed for night-out.spec.ts in 9a5e6fa).
const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00-04:00');

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

/**
 * The ranked list settles in TWO phases, so a snapshot taken at first paint is
 * not the list the user ends up looking at.
 *
 * The page paints from the BUNDLED catalog, then a live
 * `/rest/v1/bars` read lands and the ranker runs again over the fuller set.
 * Measured on this branch: the card list is up at +47ms, the REST response
 * arrives at +749ms, and the ranking changes at +846ms - positions 4 and 5
 * swap (Katana Kitten enters, Amor y Amargo leaves) while the top three hold.
 *
 * `cards.first()` becomes visible during phase one, so awaiting it proves the
 * list is PAINTED, not that it is FINAL, and any snapshot taken then is a
 * snapshot of the wrong list. That is what failed the cancel test 2 runs in 3,
 * always with that same 4/5 swap: a reload the test straddled, read as Cancel
 * quietly mutating the ranking.
 *
 * Waiting a fixed interval would only move the race. Waiting for the response
 * itself is the actual event, so it is what this waits for.
 */
const gotoHomeWithCatalog = async (
  page: import('@playwright/test').Page,
): Promise<void> => {
  const catalogLoaded = page.waitForResponse(
    (response) =>
      response.url().includes('/rest/v1/bars') && response.status() === 200,
    { timeout: 20_000 },
  );
  await page.goto('/');
  await catalogLoaded;
};

/**
 * Belt to the catalog gate's braces: returns only once the ranking has read
 * the SAME across three consecutive polls.
 *
 * Two was not enough, and the measurement in `gotoHomeWithCatalog` above says
 * why: the REST response lands at +749ms but the re-rank it triggers does not
 * commit until +846ms. Two reads 250ms apart can therefore both fall inside
 * that ~100ms window, settle on the phase-one list, and hand back a snapshot
 * the page is about to replace — after which the cancel test reads the
 * catalog's own second phase as Cancel quietly mutating the ranking, with the
 * exact 4-and-5 swap this file's header already describes. Three reads span
 * 500ms, comfortably past that gap.
 *
 * Measured 2026-08-22 on iPhone 13: 1 failure in 3 repeats with two reads,
 * green with three. This is the guard being tightened, not the assertion being
 * relaxed — `toEqual(before)` is untouched.
 */
const SETTLE_READS = 3;

const settledRanking = async (
  cards: import('@playwright/test').Locator,
): Promise<string[]> => {
  let previous: string[] | null = null;
  let agreements = 0;
  await expect
    .poll(
      async () => {
        const current = await cards.locator('h3').allInnerTexts();
        agreements =
          previous !== null && JSON.stringify(current) === JSON.stringify(previous)
            ? agreements + 1
            : 0;
        previous = current;
        return agreements >= SETTLE_READS - 1;
      },
      { timeout: 15_000, intervals: [250, 250, 250, 500, 500, 1000] },
    )
    .toBe(true);
  return previous ?? [];
};

const seedResultsFromAttaboy = async (page: import('@playwright/test').Page) => {
  await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
  await page.getByRole('button', { name: /Attaboy/ }).click();
  const cards = page.getByTestId('result-card');
  await expect(cards.first()).toBeVisible();
  await settledRanking(cards);
  return cards;
};

test.describe('Tweak the vibe — ranking', () => {
  test('opening the surface and cancelling leaves the ranking untouched', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await gotoHomeWithCatalog(page);

    const cards = await seedResultsFromAttaboy(page);
    const before = await settledRanking(cards);
    expect(before.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: /Tweak the vibe/i }).click();
    await expect(
      page.getByRole('heading', { name: /Tweak the vibe/i }),
    ).toBeVisible();
    await page.getByRole('button', { name: /^Cancel$/ }).click();

    // Same bars, same order — Cancel is not a quiet Apply.
    await expect(cards.first()).toBeVisible();
    expect(await settledRanking(cards)).toEqual(before);
    await expect(page).toHaveURL('/');
  });

  test('an APPLIED pick leads the page with a bar that matches it', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await seedAntiCocktailHistory(page);
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await gotoHomeWithCatalog(page);

    const cards = await seedResultsFromAttaboy(page);
    // The surface pre-fills with the seed bar's OWN tags and Apply hands the
    // very same tags back (WhereNextFlow.tsx: initialTags={step.tags}), so
    // `isExplicitVibe` is the only input that changes across the click. If the
    // flag never reached the ranker this list could not move.
    const before = await settledRanking(cards);
    // Nothing is APPLIED yet — the seed bar's own tags are inference, not
    // instruction — so no card carries a match badge (D-C-41), and with the
    // pick's tags scored down the normal path buries every match.
    await expect(page.getByTestId('vibe-match')).toHaveCount(0);

    await page.getByRole('button', { name: /Tweak the vibe/i }).click();
    await page.getByRole('button', { name: /^Apply$/ }).click();
    await expect(cards.first()).toBeVisible();

    // Applying makes the pick explicit: every surviving card now carries a
    // badge, and every one of them is eligible, so none can read 0/N.
    await expect(cards.first().getByTestId('vibe-match')).toBeVisible();
    await expect(cards.first()).not.toContainText(/Vibe match 0\//);
    expect(await settledRanking(cards)).not.toEqual(before);
  });
});
