/**
 * photo-card.spec.ts — the full-bleed HERO result card (QA5-S1, operator
 * 2026-07-26: the E2.3 photo-first hero returns, with SMALL overlay text).
 *
 * Thin discovery cards begin with a glyph; tapping one lazily loads the
 * photo carousel and details. The negative half proves blocked photo files
 * still degrade cleanly with no broken images.
 */

import { test, expect } from './helpers/catalogTest';
import { denyGeolocation } from './helpers/geo';

// Fixed clock — same rationale as where-next-path (open-now filter makes
// live-clock counts nondeterministic).
const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00');

test('retired cached photo URLs return 404', async ({ request }) => {
  const response = await request.get('/bar-photos/attaboy.webp');
  expect(response.status()).toBe(404);
});

/**
 * The legacy re-hosted Google photo files (src/lib/mediaPolicy.ts,
 * `legacy-google-cached`) are the non-compliant state Phase 1 exists to stop.
 * playwright.config.ts pins NEXT_PUBLIC_LEGACY_PHOTOS=0 for the server under
 * test, so this guard asserts the shipped policy unconditionally.
 *
 * It used to branch on the ambient flag and accept a visible /bar-photos/
 * carousel as a pass. That inverted the guard: on the operator's machine, whose
 * .env.local sets the flag, the one test protecting the no-photo-cache policy
 * asserted that the cache WAS being served. A guard that passes in the state it
 * exists to forbid is not a guard.
 */
async function seedResultsFromAttaboy(page: import('@playwright/test').Page) {
  await page.clock.setFixedTime(FRIDAY_NIGHT);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
  await page.getByRole('button', { name: /Attaboy/ }).click();
  const cards = page.getByTestId('result-card');
  await expect(cards).toHaveCount(5);
  return cards;
}

test.describe('Hero result card', () => {
  test('thin card opens a lazily loaded photo lightbox', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    const cards = await seedResultsFromAttaboy(page);

    // Discovery stays thin: photo metadata is absent until the bar opens.
    await expect(
      cards.first().locator('img[data-testid="bar-visual"]'),
    ).toHaveCount(0);

    // Identity remains visible while the card uses its glyph fallback.
    const heading = cards.first().getByRole('heading');
    await expect(heading).toBeVisible();

    // Without an activated route service, never substitute straight-line minutes.
    await expect(cards.first().getByText('Walk time unavailable')).toBeVisible();
    await expect(cards.first().getByText('Drive time unavailable')).toBeVisible();

    // Tap the hero → lightbox (carousel + hours).
    await cards
      .first()
      .getByRole('button', { name: /See photos and hours/i })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Places UI Kit owns its media; V7 must not render cached app-owned images.
    await expect(dialog.locator('img')).toHaveCount(0);
    // State the forbidden thing directly, so a regression that re-introduces the
    // re-hosted cache fails on the policy rather than on an incidental count.
    await expect(dialog.locator('img[src^="/bar-photos/"]')).toHaveCount(0);
    await expect(dialog.getByRole('heading', { name: 'Hours' })).toBeVisible();
  });

  test('photo-fallback NEGATIVE: blocked photos degrade to glyph tiles, zero imgs', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.route('**/bar-photos/**', (route) => route.abort());
    const cards = await seedResultsFromAttaboy(page);

    await expect(cards.locator('[data-testid="bar-visual"]')).toHaveCount(5);
    await expect(cards.locator('img')).toHaveCount(0);
    await expect(cards.first().getByRole('heading')).toBeVisible();
    await cards
      .first()
      .getByRole('button', { name: /See photos and hours/i })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
