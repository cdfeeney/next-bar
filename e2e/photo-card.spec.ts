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

/**
 * The legacy re-hosted Google photo files are behind a kill switch
 * (src/lib/mediaPolicy.ts). It is OFF by default — CI has no .env.local — and
 * ON for anyone whose .env.local still sets it, which is what the operator's
 * machine ships. The lightbox therefore renders zero images in one state and
 * the cached carousel in the other, so assert the policy that has to hold in
 * BOTH rather than the one that happens to hold in CI: the app never hotlinks
 * Google, and attribution is always on screen. playwright.config.ts loads
 * .env.local so this reads the same value the server was built with.
 */
const legacyPhotosEnabled = process.env.NEXT_PUBLIC_LEGACY_PHOTOS === '1';

async function seedResultsFromAttaboy(page: import('@playwright/test').Page) {
  await page.clock.setFixedTime(FRIDAY_NIGHT);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
  await page.getByRole('button', { name: /Attaboy/ }).click();
  const cards = page.locator('article').filter({ hasText: /Vibe match/i });
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

    // The meta line below keeps the loud walk/ride time.
    await expect(cards.first().getByText(/min (walk|by Uber)|In /)).toBeVisible();

    // Tap the hero → lightbox (carousel + hours).
    await cards
      .first()
      .getByRole('button', { name: /See photos and hours/i })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Places UI Kit owns its media; V7 must not render cached app-owned images.
    const images = dialog.locator('img');
    if (legacyPhotosEnabled) {
      await expect(images.first()).toBeVisible();
      const sources = await images.evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLImageElement).getAttribute('src') ?? ''),
      );
      // Re-encoded files served from our own domain — never a Google CDN URL.
      for (const src of sources) expect(src).toMatch(/^\/bar-photos\//);
      await expect(dialog.getByText(/· Google$/)).toBeVisible();
    } else {
      await expect(images).toHaveCount(0);
    }
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
