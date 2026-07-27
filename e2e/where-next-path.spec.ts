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

// Fixed clock (Fri 11pm local): the live results surfaces hard-filter
// KNOWN-closed bars, so exact-count assertions are only deterministic
// under a mocked clock (a Sunday-morning run sees 4, not 5).
const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00');

test.describe('Where-next path (E2.1 collapsed)', () => {
  test('picks Attaboy and lands on results in ONE step; deleted screens never render', async ({
    page,
  }) => {
    // Home is location-first; deny geo so it falls back to the manual pick flow.
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /Where are you\?/i })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();

    // ONE tap → results. No interstitials. QA-6: 5 suggestions everywhere.
    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(cards).toHaveCount(5);
    await expect(cards.locator('[data-testid="bar-visual"]')).toHaveCount(5);
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
    await expect(cards).toHaveCount(5);
    await expect(page).toHaveURL('/');
  });

  test('E2.2 axis vibe surface: six axes, one open at a time, glyphs (E0.1), and the pick is CACHED for the night', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();
    await expect(
      page.locator('article').filter({ hasText: /Vibe match/i }).first(),
    ).toBeVisible();

    // Enter the vibe surface from RESULTS (there is no pre-results stop).
    await page.getByRole('button', { name: /Tweak the vibe/i }).click();

    // Six axis rows, progressive disclosure: exactly one expanded at a
    // time (the first axis holding a seeded pick opens initially).
    for (const axis of ['Drink', 'Energy', 'Setting', 'Scene', 'Sound', 'Spend']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${axis}`) })).toBeVisible();
    }
    const expanded = page.locator('button[aria-expanded="true"]');
    await expect(expanded).toHaveCount(1);

    // Open Spend: Attaboy's `pricey` DATA tag renders as an ACTIVE $$$
    // glyph chip (E0.1); the word "pricey" appears nowhere. Opening a
    // second axis closes the first (still exactly one expanded).
    await page.getByRole('button', { name: /^Spend/ }).click();
    await expect(expanded).toHaveCount(1);
    const spendGroup = page.getByRole('group', { name: 'Spend vibes' });
    const triple = spendGroup.getByRole('button', { name: '$$$', exact: false }).first();
    await expect(triple).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/pricey/i)).toHaveCount(0);

    // Drop $$$ from tonight's vibe and apply.
    await triple.click();
    await expect(triple).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(
      page.locator('article').filter({ hasText: /Vibe match/i }).first(),
    ).toBeVisible();

    // NIGHT CACHE (locked decision 3): start a NEW search from the same
    // seed bar — its own tags would restore $$$, but tonight's cached
    // pick pre-fills instead, so $$$ is still off. Pre-fills, never
    // locks: the chip remains tappable.
    await page.getByRole('button', { name: /Pick a different bar/i }).click();
    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();
    await page.getByRole('button', { name: /Tweak the vibe/i }).click();
    await page.getByRole('button', { name: /^Spend/ }).click();
    await expect(
      page.getByRole('group', { name: 'Spend vibes' }).getByRole('button', { name: '$$$', exact: false }).first(),
    ).toHaveAttribute('aria-pressed', 'false');
  });
});
