/**
 * photo-card.spec.ts — the full-bleed HERO result card (QA5-S1, operator
 * 2026-07-26: the E2.3 photo-first hero returns, with SMALL overlay text).
 *
 * The card LEADS with a 16/10 photo hero spanning the card's full width;
 * name + neighborhood + $ sit on a bottom gradient overlay inside the
 * hero; tapping the hero opens the lightbox carousel. The NEGATIVE half
 * proves the fallback: with every /bar-photos request blocked, cards
 * degrade to the glyph tile — no broken images.
 */

import { test, expect } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

async function seedResultsFromAttaboy(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
  await page.getByRole('button', { name: /Attaboy/ }).click();
  const cards = page.locator('article').filter({ hasText: /Vibe match/i });
  await expect(cards).toHaveCount(5);
  return cards;
}

test.describe('Hero result card', () => {
  test('full-bleed 16/10 hero with overlay identity; tap opens lightbox', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    const cards = await seedResultsFromAttaboy(page);

    // The photo is a FULL-BLEED hero — it spans (approximately) the whole
    // card width, not a small side tile.
    const hero = cards.first().locator('img[data-testid="bar-visual"]');
    await expect(hero).toBeVisible();
    await expect(hero).toHaveAttribute('src', /\/bar-photos\//);
    const heroBox = await hero.boundingBox();
    const cardBox = await cards.first().boundingBox();
    expect(heroBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    // ≈ card width (the card's own border is the only chrome around it).
    expect(heroBox!.width).toBeGreaterThanOrEqual(cardBox!.width - 4);

    // The identity heading renders ON the hero: visible, and its box sits
    // inside the hero's bounds (bottom gradient overlay).
    const heading = cards.first().getByRole('heading');
    await expect(heading).toBeVisible();
    const headingBox = await heading.boundingBox();
    expect(headingBox).not.toBeNull();
    expect(headingBox!.y).toBeGreaterThanOrEqual(heroBox!.y);
    expect(headingBox!.y + headingBox!.height).toBeLessThanOrEqual(
      heroBox!.y + heroBox!.height + 1,
    );
    expect(headingBox!.x).toBeGreaterThanOrEqual(heroBox!.x);

    // The meta line below keeps the loud walk/ride time.
    await expect(cards.first().getByText(/min (walk|by Uber)|In /)).toBeVisible();

    // Tap the hero → lightbox (carousel + hours).
    await cards
      .first()
      .getByRole('button', { name: /See photos and hours/i })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
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
