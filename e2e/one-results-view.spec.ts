/**
 * one-results-view.spec.ts
 *
 * QA-6 (2026-07-27): the ONE Next Bar results view. Both home entry
 * paths (manual seed-bar and location-first auto) land on a results
 * surface carrying the SAME control set: vibe tweak, distance chips, an
 * OPTIONAL neighborhood picker, 5 suggestions, and a "Run it again"
 * refresh that deals the next batch.
 */

import { test, expect } from '@playwright/test';
import { denyGeolocation, grantGeolocation } from './helpers/geo';

const cardsOf = (page: import('@playwright/test').Page) =>
  page.locator('article').filter({ hasText: /Vibe match/i });

test.describe('QA-6 — the one results view', () => {
  test('manual results: 5 bars, full control set, hood override re-ranks in place', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.goto('/');

    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();

    // 5 suggestions (manual was 3 before QA-6).
    const cards = cardsOf(page);
    await expect(cards).toHaveCount(5);

    // The whole control set on ONE surface.
    await expect(
      page.getByRole('group', { name: 'Search radius' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Tweak the vibe/i }),
    ).toBeVisible();
    const hoodGroup = page.getByRole('group', { name: 'Neighborhood' });
    await expect(hoodGroup).toBeVisible();

    // Anchor chip is the default; picking a hood re-ranks IN PLACE (the
    // URL and screen never change) and the location label says so.
    await expect(
      hoodGroup.getByRole('button', { name: 'Near here' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await hoodGroup
      .getByRole('button', { name: 'Williamsburg', exact: true })
      .click();
    await expect(page.getByText('In Williamsburg')).toBeVisible();
    // Hood + walking radius + the live open-now filter is a legitimately
    // thin pool at some hours — results render (capped at 5), never an
    // exact count (that assertion is clock-dependent; caught on WebKit).
    await expect
      .poll(async () => cards.count())
      .toBeGreaterThan(0);
    expect(await cards.count()).toBeLessThanOrEqual(5);
    await expect(page).toHaveURL('/');

    // Tapping the selected hood again returns to the anchor (optional,
    // never traps).
    await hoodGroup
      .getByRole('button', { name: 'Williamsburg', exact: true })
      .click();
    await expect(page.getByText('In Williamsburg')).toHaveCount(0);
  });

  test('run it again deals a fresh batch — no bar from the first five repeats', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.goto('/');

    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();

    const cards = cardsOf(page);
    await expect(cards).toHaveCount(5);
    // Widen to Anywhere so the pool is deep enough that the next deal is
    // guaranteed to be 5 entirely-new bars.
    await page
      .getByRole('group', { name: 'Search radius' })
      .getByRole('button', { name: 'Anywhere' })
      .click();
    await expect(cards).toHaveCount(5);

    const firstBatch = await cards.locator('h3').allTextContents();
    await page.getByRole('button', { name: /Run it again/i }).click();

    await expect
      .poll(async () => {
        const next = await cards.locator('h3').allTextContents();
        return next.filter((name) => firstBatch.includes(name)).length;
      })
      .toBe(0);
    await expect(cards).toHaveCount(5);
  });

  test('location-first auto results carry the same controls: hood chips, distance chips, refresh', async ({
    page,
    context,
  }) => {
    await grantGeolocation(context, { latitude: 40.725, longitude: -73.985 });
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: /Your next/i }),
    ).toBeVisible({ timeout: 15_000 });
    const cards = cardsOf(page);
    await expect(cards).toHaveCount(5);

    // Same control set as the manual surface.
    await expect(
      page.getByRole('group', { name: 'Search radius' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Tweak the vibe/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Run it again/i }),
    ).toBeVisible();

    const hoodGroup = page.getByRole('group', { name: 'Neighborhood' });
    await expect(
      hoodGroup.getByRole('button', { name: 'Near me' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // Hood override wins over the geo anchor and says so. Count stays
    // relaxed — hood + walking + open-now is clock-dependent (see the
    // manual test above).
    await hoodGroup
      .getByRole('button', { name: 'Greenpoint', exact: true })
      .click();
    await expect(page.getByText('In Greenpoint')).toBeVisible();
    await expect
      .poll(async () => cards.count())
      .toBeGreaterThan(0);
  });
});
