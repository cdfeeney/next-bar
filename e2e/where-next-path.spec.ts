/**
 * where-next-path.spec.ts
 *
 * End-to-end: / renders the WhereNextFlow state machine — Next Bar? is the
 * app's primary surface. Pick Attaboy, click "Continue" on GpsConfirm
 * (geolocation denied in headless → no-precise-fix branch), click "Walking"
 * on RadiusSlider, click "Show me bars", see 3 result cards that do NOT
 * include Attaboy.
 */

import { test, expect } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

test.describe('Where-next path', () => {
  test('lands on /, picks Attaboy, walks through flow, sees 3 results excluding Attaboy', async ({ page }) => {
    // Home is location-first; deny geo so it falls back to the manual pick flow.
    await denyGeolocation(page.context());
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /Where are you\?/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search bars' })).toBeVisible();

    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();

    // GpsConfirm — geolocation denied in headless → single Continue button.
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible({ timeout: 12_000 });
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('group', { name: 'Search radius' })).toBeVisible();
    await page.getByRole('button', { name: 'Walking' }).click();

    // E0.1 (locked decision 2): enter the optional vibe step — Attaboy's
    // seed tags include the `pricey` DATA tag, whose chip must render as
    // the $$$ glyph via displayTag; the word "pricey" appears NOWHERE.
    await page.getByRole('button', { name: /Tweak the vibe/i }).click();
    await expect(
      page.getByRole('button', { name: 'Cocktails', exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '$$$', exact: false })).toBeVisible();
    await expect(page.getByText(/pricey/i)).toHaveCount(0);
    await page.getByRole('button', { name: 'Apply' }).click();

    await page.getByRole('button', { name: /Show me bars/i }).click();

    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(cards).toHaveCount(3);

    // B5 visual identity: every card renders the leading visual tile. Covers
    // the glyph path (photos may not be ingested yet); the tile testid is the
    // same wrapper for both photo and glyph, so this holds either way.
    await expect(cards.locator('[data-testid="bar-visual"]')).toHaveCount(3);

    await expect(
      page.locator('article').filter({ hasText: /Vibe match/i }).getByRole('heading', { name: /Attaboy/i })
    ).toHaveCount(0);
  });
});
