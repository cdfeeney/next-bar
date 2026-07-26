/**
 * where-next-path.spec.ts
 *
 * End-to-end: / renders the WhereNextFlow state machine — Next Bar? is
 * the app's primary surface.
 *
 * E2.1 COLLAPSED FLOW (EPICS-v0.6): pick a bar → results DIRECTLY. The
 * `confirmGps` and `pickRadius` steps are DELETED — this spec carries
 * the goal's acceptance-6 NEGATIVE assertions that the deleted screens
 * never render. Radius fine-tune + vibe tweak live on the results
 * surface.
 */

import { test, expect } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

test.describe('Where-next path (E2.1 collapsed)', () => {
  test('picks Attaboy and lands on results in ONE step; deleted screens never render', async ({
    page,
  }) => {
    // Home is location-first; deny geo so it falls back to the manual pick flow.
    await denyGeolocation(page.context());
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /Where are you\?/i })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();

    // ONE tap → results. No interstitials.
    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(cards).toHaveCount(3);
    await expect(cards.locator('[data-testid="bar-visual"]')).toHaveCount(3);
    await expect(
      page.locator('article').filter({ hasText: /Vibe match/i }).getByRole('heading', { name: /Attaboy/i }),
    ).toHaveCount(0);

    // ACCEPTANCE 6 — the deleted steps NEVER rendered on the way here:
    // confirmGps's Continue button and the pickRadius interstitial
    // heading are gone from the flow entirely.
    await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
    await expect(page.getByText(/How far you wanna go/i)).toHaveCount(0);

    // The radius fine-tune lives ON the results surface (walking default),
    // and changing it re-ranks in place — the URL and screen never change.
    const radiusGroup = page.getByRole('group', { name: 'Search radius' });
    await expect(radiusGroup).toBeVisible();
    await radiusGroup.getByRole('button', { name: 'Anywhere' }).click();
    await expect(cards).toHaveCount(3);
    await expect(page).toHaveURL('/');
  });

  test('vibe tweak from results: glyph chips (E0.1), applies, and returns to results', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.goto('/');

    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();
    await expect(
      page.locator('article').filter({ hasText: /Vibe match/i }).first(),
    ).toBeVisible();

    // Enter the vibe surface from RESULTS (there is no pre-results stop).
    await page.getByRole('button', { name: /Tweak the vibe/i }).click();
    // E0.1: Attaboy's `pricey` DATA tag renders as the $$$ glyph; the
    // word "pricey" appears nowhere.
    await expect(
      page.getByRole('button', { name: 'Cocktails', exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '$$$', exact: false })).toBeVisible();
    await expect(page.getByText(/pricey/i)).toHaveCount(0);

    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(
      page.locator('article').filter({ hasText: /Vibe match/i }),
    ).toHaveCount(3);
  });
});
