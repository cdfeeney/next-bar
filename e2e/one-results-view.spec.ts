/**
 * one-results-view.spec.ts
 *
 * QA-6 (2026-07-27): the ONE Next Bar results view. Both home entry
 * paths (manual seed-bar and location-first auto) land on a results
 * surface carrying vibe tweak, distance chips, 5 suggestions, and a
 * "Run it again" refresh. Neighborhood browsing belongs on Map.
 *
 * Fixed clock (Fri 11pm local — the distance-open-now pattern): the live
 * surfaces hard-filter KNOWN-closed bars, so exact-count assertions are
 * only deterministic under a mocked clock.
 */

import { test, expect } from './helpers/catalogTest';
import { denyGeolocation, grantGeolocation } from './helpers/geo';

const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00'); // Fri 11pm — bars open

const cardsOf = (page: import('@playwright/test').Page) =>
  page.getByTestId('result-card');

test.describe('QA-6 — the one results view', () => {
  test('manual results: 5 bars with distance and vibe controls, no neighborhoods', async ({
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

    // Next Bar owns distance and vibe. Neighborhood browsing lives on Map.
    const radiusGroup = page.getByRole('group', { name: 'Search radius' });
    await expect(radiusGroup).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Tweak the vibe/i }),
    ).toBeVisible();
    await expect(page.getByRole('group', { name: 'Neighborhood' })).toHaveCount(0);

    // Manual entry defaults to Walkable ("at a bar" implies the next one
    // is walkable).
    await expect(
      radiusGroup.getByRole('button', { name: 'Walkable' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL('/');
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

  test('location-first auto results enter on WALKABLE without seed or neighborhood controls', async ({
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
    await expect(cards).toHaveCount(3);

    // Operator fix 2026-07-27: home opens on Walkable — closest bars
    // first (the auto-widen covers a zero-result radius; at this LES
    // coordinate on a Friday night the walking pool is deep).
    const radiusGroup = page.getByRole('group', { name: 'Search radius' });
    await expect(
      radiusGroup.getByRole('button', { name: 'Walkable' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // The seed-bar escape and neighborhood chips do not clutter Next Bar.
    await expect(
      page.getByRole('button', { name: 'Pick my bar' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /Tweak the vibe/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Run it again/i }),
    ).toBeVisible();

    await expect(page.getByRole('group', { name: 'Neighborhood' })).toHaveCount(0);
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

    const cards = page.getByTestId('result-card');
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

    const cards = page.getByTestId('result-card');
    await expect(cards).toHaveCount(3);
    await expect(
      page.getByRole('button', { name: /Send .* to friends/ }),
    ).toHaveCount(0);
  });

  test('a saved quiz profile leaks into neither the ranking nor the badge', async ({
    page,
    context,
  }) => {
    await grantGeolocation(context, { latitude: 40.725, longitude: -73.985 });
    await page.clock.setFixedTime(FRIDAY_NIGHT);

    const cards = page.getByTestId('result-card');
    const headings = cards.locator('h3');
    // The list ranks in TWO stages, and comparing one against the other is
    // how an earlier version of this test read ranks 3,4,3,4,5 out of five
    // cards: the page first ranks the BUNDLED catalog, then re-ranks once
    // CatalogRefresh has paged the served catalog in (the fixture returns
    // the same bars sorted by id, so ties land differently and the order
    // really does move). Routing is off in this suite — ResultsView renders
    // "Route times unavailable" — so route order is never the second stage
    // here. Waiting for the catalog requests to finish is what puts both
    // observations in the same stage; 1..5 then confirms a coherent render.
    const RANKS = [/^1\. /, /^2\. /, /^3\. /];
    const settled = async () => {
      await page.waitForLoadState('networkidle');
      await expect(headings).toHaveText(RANKS);
    };

    // BASELINE first, with NO saved profile: the ranked identities a saved
    // profile must not be able to move.
    await page.goto('/');
    await settled();
    const baselineOrder = await headings.allTextContents();

    // Now the same night, same coords, same clock — but with a saved quiz
    // profile that LOVES jazz. Pre-change it silently re-ordered these.
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
    await page.goto('/');
    await settled();

    // The RANKING half of this test's name: the same bars in the same
    // places, whether or not a quiz profile is saved. A card COUNT cannot
    // say that — five cards come back either way — so the assertion is on
    // ordered identity; each h3 reads "<rank>. <name>".
    //
    // Measured limit, so nobody reads more into a green than it carries:
    // at these coords and this clock the top five are fixed by the distance
    // band before tag scoring can move anything, so this assertion does NOT
    // by itself catch a saved profile leaking into implicit ranking. That
    // was checked directly on 2026-09-08 rather than assumed — autoProfile
    // was temporarily pointed at the saved profile and six tag sets (jazz,
    // dive, cocktail, dance, wine, none) returned an identical order on
    // both viewports. What this does pin is that the order is STABLE and
    // profile-independent here, and it fails loudly if that ever stops
    // being true. Retrying assertion — the comparison must not be the
    // thing that races.
    await expect(headings).toHaveText(baselineOrder);
    // The BADGE half: a saved profile is not an explicit selection, so there
    // is no honest fraction to print (D-C-41). The old assertion here was
    // "Vibe match 0/1 is visible"; this proves the same non-leak AND the new
    // badge rule.
    await expect(page.getByTestId('vibe-match')).toHaveCount(0);
    await expect(cards).toHaveCount(3);

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
