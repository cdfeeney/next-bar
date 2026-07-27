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

    // The compact escape appears exactly ONCE (operator: minimal text).
    await expect(
      page.getByRole('button', { name: 'Pick my bar' }),
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

  test('PLANNING phase: every card carries a Send share; at night it does not', async ({
    page,
    context,
  }) => {
    await grantGeolocation(context, { latitude: 40.725, longitude: -73.985 });
    // Friday 2pm derives 'planning' with no override; daytime open-now
    // still leaves bars near LES.
    await page.clock.setFixedTime(new Date('2026-07-24T14:00:00'));
    await page.goto('/');

    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect.poll(async () => cards.count()).toBeGreaterThan(0);
    const sends = page.getByRole('button', { name: /^Send .* to friends$/ });
    expect(await sends.count()).toBe(await cards.count());
  });

  test('at NIGHT (out phase) the Send share is absent', async ({
    page,
    context,
  }) => {
    await grantGeolocation(context, { latitude: 40.725, longitude: -73.985 });
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(cards).toHaveCount(5);
    await expect(
      page.getByRole('button', { name: /Send .* to friends/ }),
    ).toHaveCount(0);
  });

  test('default home ranking is pure proximity — saved quiz vibes only apply via Tweak the vibe', async ({
    page,
    context,
  }) => {
    await grantGeolocation(context, { latitude: 40.725, longitude: -73.985 });
    // A saved quiz profile that LOVES jazz — pre-change it silently
    // re-ordered the default results; now it must not.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'next-bar:profile:v1',
        JSON.stringify({
          tags: ['jazz', 'live'],
          archetype: 'test',
          preferredNeighborhoods: [],
          savedAt: '2026-07-24T12:00:00.000Z',
        }),
      );
    });
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(cards).toHaveCount(5);
    // Pure proximity: with no vibe tags in play the badge reads 0/1 for
    // every card (jaccard vs an empty profile) — the saved jazz profile
    // did NOT leak into the default ranking.
    await expect(cards.first().getByText(/Vibe match 0\//)).toBeVisible();

    // The saved profile still PRE-FILLS the tweak surface (it moved, it
    // did not disappear): Sound axis shows Jazz already active.
    await page.getByRole('button', { name: /Tweak the vibe/i }).click();
    // Sound holds the seeded picks, so it's the axis that AUTO-opens —
    // clicking it again would collapse it.
    await expect(
      page
        .getByRole('group', { name: 'Sound vibes' })
        .getByRole('button', { name: 'Jazz' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
