/**
 * photo-card.spec.ts — the COMPACT result card (operator 2026-07-26:
 * drunk users need the next bar in 10 seconds → ~3 cards per screen).
 *
 * The card leads with a SMALL photo tile (tap → lightbox carousel); the
 * big hero/blurb/review live in the lightbox now. The NEGATIVE half
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
  await expect(cards).toHaveCount(3);
  return cards;
}

test.describe('Compact result card', () => {
  test('small photo tile, compact height (~3 per screen), lightbox on tap', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    const cards = await seedResultsFromAttaboy(page);

    // The photo is a compact tile, NOT a full-bleed hero.
    const thumb = cards.first().locator('img[data-testid="bar-visual"]');
    await expect(thumb).toBeVisible();
    await expect(thumb).toHaveAttribute('src', /\/bar-photos\//);
    const thumbBox = await thumb.boundingBox();
    const cardBox = await cards.first().boundingBox();
    expect(thumbBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(thumbBox!.width).toBeLessThan(cardBox!.width / 3);

    // 10-second rule: a card stays SHORT so ~3 fit a phone viewport.
    // (180 leaves headroom for a wrapped hours badge / OS font scaling —
    // review MED: a tight bound flakes on long "Open · until…" strings.)
    expect(cardBox!.height).toBeLessThanOrEqual(180);

    // The loud data is on the row: name + walk/ride time.
    await expect(cards.first().getByRole('heading')).toBeVisible();
    await expect(cards.first().getByText(/min (walk|by Uber)|^In /)).toBeVisible();

    // Tap the tile → the big version (lightbox carousel + hours).
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

    await expect(cards.locator('[data-testid="bar-visual"]')).toHaveCount(3);
    await expect(cards.locator('img')).toHaveCount(0);
    await expect(cards.first().getByRole('heading')).toBeVisible();
    await cards
      .first()
      .getByRole('button', { name: /See photos and hours/i })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
