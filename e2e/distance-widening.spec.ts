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

  test('NARROWING forgets the dealt-hand exclusions (santa: Codex pin, re-scoped by g-d3f8d912)', async ({
    page,
  }) => {
    await grantGeolocation(page.context(), SOUTH_SLOPE);
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');
    const radiusGroup = page.getByRole('group', { name: 'Search radius' });
    await expect(radiusGroup).toBeVisible({ timeout: 15_000 });

    // The nearest bars, dealt at the Walkable default — these names are
    // the discriminator at the end.
    await expect(cardsOf(page).first()).toBeVisible();
    const walkableHand = await cardNames(page);
    expect(walkableHand.length).toBeGreaterThan(0);

    // Widen to Anywhere, then deal the NEXT batch: shownIds now holds the
    // walkable hand AND the widened hand — maximal stale-exclusion state.
    // (g-d3f8d912 re-scoped the original pin: a WIDENING tap now keeps
    // shownIds as the fresh-hand seen set, so the widened hand is five
    // NEW names; the forget-on-narrow semantics below are unchanged.)
    await radiusGroup.getByRole('button', { name: 'Anywhere' }).click();
    await expect(cardsOf(page).first()).toBeVisible();
    await expect
      .poll(async () => {
        const widened = await cardNames(page);
        if (widened.length === 0) return -1;
        return widened.filter((n) => walkableHand.includes(n)).length;
      })
      .toBe(0);
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

    // NARROW to CAB — chosen precisely so the empty-rank recovery CANNOT
    // fire and fake the result (santa: Codex): the cab pool here holds ~30
    // bars, so even with stale exclusions the rank is non-empty and the
    // recovery path (which also clears shownIds) stays dormant. The
    // walkable-hand bars are the nearest bars and sit inside cab range, so:
    //   clear ran   → they are dealt again at cab;
    //   clear gone  → they are still in shownIds → excluded → absent,
    //                 with no recovery to hide it.
    await radiusGroup.getByRole('button', { name: 'Worth a cab' }).click();
    await expect
      .poll(async () => {
        const cab = await cardNames(page);
        if (cab.length === 0) return -1;
        return walkableHand.filter((n) => cab.includes(n)).length;
      })
      .toBe(walkableHand.length);
  });
});

/**
 * Union Square: densely surrounded — the walkable hand is a full five, and
 * under pure-proximity ranking those same five would win again at any wider
 * radius. That density is exactly what makes it the discriminator for the
 * fresh-hand rule (g-d3f8d912): old behavior re-deals the nearest five;
 * the rule demands newly-eligible-first.
 */
const UNION_SQUARE = { latitude: 40.7359, longitude: -73.9911 };

test.describe('widening deals a fresh hand (g-d3f8d912)', () => {
  test('Worth a cab prefers newly eligible bars over the walkable hand; refresh then cycles unseen', async ({
    page,
  }) => {
    await grantGeolocation(page.context(), UNION_SQUARE);
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');

    const radiusGroup = page.getByRole('group', { name: 'Search radius' });
    await expect(radiusGroup).toBeVisible({ timeout: 15_000 });
    await expect(
      radiusGroup.getByRole('button', { name: 'Walkable' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(cardsOf(page).first()).toBeVisible();
    const walkable = await cardNames(page);
    // Dense-origin premise (mirror of the sparse premise above).
    expect(walkable.length).toBe(5);

    await radiusGroup.getByRole('button', { name: 'Worth a cab' }).click();
    await expect(
      radiusGroup.getByRole('button', { name: 'Worth a cab' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // The fresh hand: with hundreds of bars newly eligible in the
    // 1.5–4 mi ring, the widened hand contains NONE of the walkable five
    // (they are "seen" and the unseen pool easily fills the count), and
    // the newly-eligible preference is visible in the card copy — beyond
    // WALK_BOUNDARY_MI the lead line reads "min by Uber", so a hand of
    // re-dealt walkable bars could never produce one (acceptance 1, 2, 7).
    await expect
      .poll(async () => {
        const widened = await cardNames(page);
        if (widened.length === 0) return 'empty';
        const reused = widened.filter((n) => walkable.includes(n)).length;
        const uberCards = await cardsOf(page)
          .filter({ hasText: /min by Uber/i })
          .count();
        return `reused=${reused} uber>0=${uberCards > 0}`;
      })
      .toBe('reused=0 uber>0=true');
    const widened = await cardNames(page);

    // Refresh after the widened deal resumes the classic cycle: the next
    // batch excludes BOTH the walkable hand and the widened hand
    // (acceptance 2, 3, 5 — reuse only as fallback, reruns deterministic).
    await page.getByRole('button', { name: /Run it again/i }).click();
    await expect
      .poll(async () => {
        const next = await cardNames(page);
        if (next.length === 0) return -1;
        return next.filter((n) => widened.includes(n) || walkable.includes(n))
          .length;
      })
      .toBe(0);
  });
});
