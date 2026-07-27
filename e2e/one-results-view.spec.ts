/**
 * one-results-view.spec.ts
 *
 * QA-6 (2026-07-27): the ONE Next Bar results view. Both home entry
 * paths (manual seed-bar and location-first auto) land on a results
 * surface carrying the SAME control set: vibe tweak, distance chips, an
 * OPTIONAL neighborhood picker, 5 suggestions, and a "Run it again"
 * refresh that deals the next batch.
 *
 * Fixed clock (Fri 11pm local — the distance-open-now pattern): the live
 * surfaces hard-filter KNOWN-closed bars, so exact-count assertions are
 * only deterministic under a mocked clock.
 */

import { test, expect } from '@playwright/test';
import { denyGeolocation, grantGeolocation } from './helpers/geo';

const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00'); // Fri 11pm — bars open

const cardsOf = (page: import('@playwright/test').Page) =>
  page.locator('article').filter({ hasText: /Vibe match/i });

test.describe('QA-6 — the one results view', () => {
  test('manual results: 5 bars, full control set, hood override re-ranks in place', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();

    // 5 suggestions (manual was 3 before QA-6).
    const cards = cardsOf(page);
    await expect(cards).toHaveCount(5);

    // The whole control set on ONE surface.
    const radiusGroup = page.getByRole('group', { name: 'Search radius' });
    await expect(radiusGroup).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Tweak the vibe/i }),
    ).toBeVisible();
    const hoodGroup = page.getByRole('group', { name: 'Neighborhood' });
    await expect(hoodGroup).toBeVisible();

    // Manual entry defaults to Walkable ("at a bar" implies the next one
    // is walkable); the anchor chip is the default hood state.
    await expect(
      radiusGroup.getByRole('button', { name: 'Walkable' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      hoodGroup.getByRole('button', { name: 'Near here' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // Picking a hood re-ranks IN PLACE (the URL and screen never change),
    // says so in the location label, and WIDENS the radius to Anywhere —
    // "In Williamsburg" means the whole hood, not a 1.5mi disc around its
    // centroid.
    await hoodGroup
      .getByRole('button', { name: 'Williamsburg', exact: true })
      .click();
    await expect(page.getByText('In Williamsburg')).toBeVisible();
    await expect(
      radiusGroup.getByRole('button', { name: 'Anywhere' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(cards).toHaveCount(5);
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
    await page.clock.setFixedTime(FRIDAY_NIGHT);
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

  test('location-first auto results enter on WALKABLE (closest first) with the full control set', async ({
    page,
    context,
  }) => {
    await grantGeolocation(context, { latitude: 40.725, longitude: -73.985 });
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: /Your next/i }),
    ).toBeVisible({ timeout: 15_000 });
    const cards = cardsOf(page);
    await expect(cards).toHaveCount(5);

    // Operator fix 2026-07-27: home opens on Walkable — closest bars
    // first (the auto-widen covers a zero-result radius; at this LES
    // coordinate on a Friday night the walking pool is deep).
    const radiusGroup = page.getByRole('group', { name: 'Search radius' });
    await expect(
      radiusGroup.getByRole('button', { name: 'Walkable' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // The escape appears exactly ONCE (the bottom duplicate is deleted).
    await expect(
      page.getByRole('button', { name: /Not at these bars/i }),
    ).toHaveCount(1);
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

    // Hood override wins over the geo anchor and says so.
    await hoodGroup
      .getByRole('button', { name: 'Greenpoint', exact: true })
      .click();
    await expect(page.getByText('In Greenpoint')).toBeVisible();
    await expect(cards).toHaveCount(5);
  });
});
