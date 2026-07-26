/**
 * photo-card.spec.ts — E2.3 photo-first result card (R7).
 *
 * The card LEADS with the bar's full-bleed photo when one exists: the
 * name/neighborhood/price ride a gradient overlay ON the image and the
 * photo tap opens the lightbox. The NEGATIVE half proves the fallback:
 * with every /bar-photos request blocked (photo-less bar simulation),
 * cards degrade to the compact glyph-tile header — no broken images, no
 * empty hero band.
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

test.describe('E2.3 photo-first result card', () => {
  test('card leads with the full-bleed photo; overlay identity; photo opens the lightbox; CTA >=56px (R4)', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    const cards = await seedResultsFromAttaboy(page);

    // R7: the visual identity on a photo card is the full-bleed <img>
    // (16/10 hero), not the 56px tile.
    const hero = cards.first().locator('img[data-testid="bar-visual"]');
    await expect(hero).toBeVisible();
    await expect(hero).toHaveAttribute('src', /\/bar-photos\//);
    const heroBox = await hero.boundingBox();
    const cardBox = await cards.first().boundingBox();
    expect(heroBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    // Full-bleed: the hero spans the card's full inner width (rounded
    // corners clip it, so allow a couple px).
    expect(Math.abs(heroBox!.width - cardBox!.width)).toBeLessThan(4);

    // Identity rides the photo: the card heading (rank + name) sits ON
    // the hero, inside the same relative wrapper as the image.
    const heading = cards.first().getByRole('heading').first();
    await expect(heading).toBeVisible();
    const headingBox = await heading.boundingBox();
    expect(headingBox).not.toBeNull();
    // Overlay = heading vertically inside the hero's box.
    expect(headingBox!.y).toBeGreaterThan(heroBox!.y);
    expect(headingBox!.y + headingBox!.height).toBeLessThanOrEqual(
      heroBox!.y + heroBox!.height + 2,
    );

    // R4: the card CTAs are >=56px touch targets.
    const rankIt = cards.first().getByRole('link', { name: /Rank it/i });
    const rankBox = await rankIt.boundingBox();
    expect(rankBox).not.toBeNull();
    expect(rankBox!.height).toBeGreaterThanOrEqual(56);

    // Tapping the photo opens the lightbox (carousel + hours surface).
    await cards
      .first()
      .getByRole('button', { name: /See photos and hours/i })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('photo-fallback NEGATIVE: with photos unavailable the glyph tile renders — no broken hero, no images at all', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    // Simulate photo-less bars: every local photo request fails, which
    // must flip each card to the compact glyph-tile fallback.
    await page.route('**/bar-photos/**', (route) => route.abort());
    const cards = await seedResultsFromAttaboy(page);

    // Every card still carries its visual identity (the glyph tile)...
    await expect(cards.locator('[data-testid="bar-visual"]')).toHaveCount(3);
    // ...but as the compact tile, not a hero image: zero <img> elements
    // survive in the cards (hero unmounted AND tile fell back to glyph).
    await expect(cards.locator('img')).toHaveCount(0);

    // The heading left the overlay: it renders as regular card text and
    // the card remains fully usable (lightbox still opens from the tile).
    await expect(cards.first().getByRole('heading').first()).toBeVisible();
    await cards
      .first()
      .getByRole('button', { name: /See photos and hours/i })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
