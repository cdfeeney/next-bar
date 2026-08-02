/**
 * distance-widening.spec.ts (goal g-f81ccdfc)
 *
 * Walkable → Cab → Anywhere must RE-RUN candidate discovery and ranking
 * from the wider radius — not re-filter the batch already in hand. The
 * behavioral proof: with a real location fix, widening surfaces at least
 * one bar that the walkable batch did not contain (candidates outside the
 * old radius genuinely enter the pool), the URL stays stable (in-place
 * re-rank, no navigation), and narrowing back re-runs again.
 *
 * The unit layer (matching.test.ts, same goal) pins the fixture-level
 * property that a far-but-perfect bar can WIN at the wider radius and that
 * a wide run after a narrow run equals a cold wide run.
 *
 * Location: a fixed LES point with granted permission — without coords the
 * radius filter is a documented no-op and this spec would prove nothing.
 */

import { test, expect, type Page } from '@playwright/test';
import { grantGeolocation } from './helpers/geo';

const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00');

/**
 * South Slope/Greenwood origin: exactly TWO catalog bars sit inside the
 * 1.5mi walkable disc (probed against the real catalog; pinned by the
 * companion invariant in matching.test.ts's fixture layer and re-derived
 * here from the rendered hand being < 5 cards). The auto surface ranks by
 * PURE PROXIMITY (documented operator decision: no silent quiz-profile
 * influence), so an already-full walkable hand can legitimately survive
 * widening — a sparse origin is the profile-independent discriminator:
 * Anywhere must introduce names the walkable pool cannot contain, by set
 * arithmetic alone. (Two earlier fixture attempts — dense LES, seeded
 * profile at UES — were undiscriminating for exactly these reasons.)
 */
const SOUTH_SLOPE = { latitude: 40.64, longitude: -74.0 };

const cardsOf = (page: Page) =>
  page.locator('article').filter({ hasText: /Vibe match/i });

async function cardNames(page: Page): Promise<string[]> {
  const names = await cardsOf(page).getByRole('heading').allInnerTexts();
  return names.map((n) => n.replace(/^\d+\.\s*/, '').trim());
}

test.describe('distance widening re-runs the pick (g-f81ccdfc)', () => {
  test('Anywhere surfaces bars the walkable batch could not contain; URL stays put', async ({
    page,
  }) => {
    await grantGeolocation(page.context(), SOUTH_SLOPE);
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    // Location-first flow lands on results at the Walkable default.
    const radiusGroup = page.getByRole('group', { name: 'Search radius' });
    await expect(radiusGroup).toBeVisible({ timeout: 15_000 });
    await expect(
      radiusGroup.getByRole('button', { name: 'Walkable' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(cardsOf(page).first()).toBeVisible();
    const walkable = await cardNames(page);
    // The sparse-origin premise: fewer bars exist within walking distance
    // than a full hand. If the catalog ever densifies this area, this
    // failure is the pointer to pick a new sparse origin.
    expect(walkable.length).toBeLessThan(5);
    expect(walkable.length).toBeGreaterThan(0);

    const urlBefore = page.url();
    await radiusGroup.getByRole('button', { name: 'Anywhere' }).click();
    await expect(
      radiusGroup.getByRole('button', { name: 'Anywhere' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // In-place re-rank: same URL, same surface.
    expect(page.url()).toBe(urlBefore);
    await expect(cardsOf(page).first()).toBeVisible();

    // THE re-run proof: at least one suggestion was NOT in the walkable
    // batch. A re-filter of the in-hand batch can only ever shrink it —
    // it can never introduce a bar the narrow pool didn't contain.
    await expect
      .poll(async () => {
        const anywhere = await cardNames(page);
        return anywhere.filter((n) => !walkable.includes(n)).length;
      })
      .toBeGreaterThan(0);

    // Filter/ranking semantics preserved: still a full hand of cards.
    expect((await cardNames(page)).length).toBeGreaterThan(0);

    // Narrowing back re-runs again (not a cached copy of the old batch):
    // assert by round-trip equality of the SET of walkable names
    // (deterministic under the fixed clock and fixed location).
    await radiusGroup.getByRole('button', { name: 'Walkable' }).click();
    await expect
      .poll(async () => (await cardNames(page)).sort().join('|'))
      .toBe([...walkable].sort().join('|'));
  });

  test('a radius change FORGETS the dealt-hand exclusions (santa: Codex — pins setShownIds([]))', async ({
    page,
  }) => {
    await grantGeolocation(page.context(), SOUTH_SLOPE);
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');
    const radiusGroup = page.getByRole('group', { name: 'Search radius' });
    await expect(radiusGroup).toBeVisible({ timeout: 15_000 });

    // Full hand at Anywhere, then deal the NEXT batch: shownIds now holds
    // the first hand — the narrow-run pagination state the goal says must
    // not bias a widened (or any re-radiused) run.
    await radiusGroup.getByRole('button', { name: 'Anywhere' }).click();
    await expect(cardsOf(page).first()).toBeVisible();
    const firstHand = await cardNames(page);
    expect(firstHand.length).toBe(5);
    await page.getByRole('button', { name: /Run it again/i }).click();
    // Non-empty AND disjoint (santa: Codex — a poll that accepts an empty
    // second hand proves nothing): the deal really excluded the first hand.
    await expect
      .poll(async () => {
        const second = await cardNames(page);
        if (second.length === 0) return -1;
        return second.filter((n) => firstHand.includes(n)).length;
      })
      .toBe(0);

    // Switch to CAB — chosen precisely so the empty-rank recovery CANNOT
    // fire and fake the result (santa: Codex): the cab pool here holds ~30
    // bars, so even with stale exclusions the rank is non-empty and the
    // recovery path (which also clears shownIds) stays dormant. The five
    // nearest bars all sit inside cab range, so:
    //   clear ran   → cab hand == the first Anywhere hand (nearest five);
    //   clear gone  → first hand still excluded → cab hand != first hand,
    //                 with no recovery to hide it.
    await radiusGroup.getByRole('button', { name: 'Worth a cab' }).click();
    await expect
      .poll(async () => (await cardNames(page)).sort().join('|'))
      .toBe([...firstHand].sort().join('|'));
  });
});
