/**
 * distance-open-now.spec.ts — E3.2 distance chips + E3.3 open-now hard
 * filter.
 *
 * E3.2: the manual-results radius control is two intent chips —
 * "Walkable" / "Worth a cab" — plus the "Anywhere" escape (R5). Walkable
 * is the default; tapping re-ranks live without changing the screen.
 *
 * E3.3: bars KNOWN closed at the (fixed) clock never render on the live
 * results surface — the negative asserts no closed-state hours badge
 * ("Opens…"/"Closed…") survives the filter, while a late-evening clock
 * still shows "Open ·" badges (positive control). No-hours bars are
 * allowed to stay, so the surface can never be filtered to a dead end
 * by missing data.
 */

import { test, expect } from './helpers/catalogTest';
import { denyGeolocation } from './helpers/geo';
import { bars } from '../src/lib/bars';
import { haversineMiles } from '../src/lib/distance';
import { RADIUS_CAB, RADIUS_WALK } from '../src/lib/constants';

const LATE_EVENING = new Date('2026-07-24T23:00:00'); // Fri 11pm — bars open
const EARLY_MORNING = new Date('2026-07-27T09:00:00'); // Mon 9am — bars closed

/**
 * Pin the app to its BUNDLED catalog for this spec.
 *
 * Every distance assertion below resolves a rendered card's heading against
 * `bars` from src/lib — but CatalogRefresh replaces that bundle with the full
 * Supabase `bars` table after hydration, and the served catalog is far larger
 * than the bundled core. A card sourced only from the server then resolves to
 * `undefined`, and the `!` below used to hand that straight to haversineMiles:
 * on 2026-08-18 the gate failed with `Cannot read properties of undefined
 * (reading 'lat')` at src/lib/distance.ts:8, naming product code for what was
 * a test-fixture mismatch, on "Lobby Bar at Hotel Chelsea" — a venue that
 * exists in the database and nowhere in src/.
 *
 * Whether it fired at all depended on whether the swap beat the assertion, so
 * the spec was only reliable in the degraded no-Supabase state. Blocking the
 * fetch makes the rendered set exactly the set this spec can reason about, in
 * every environment. The distance assertions keep their full strength; what
 * goes away is the race, not the coverage. Catalog SIZE is another spec's
 * subject — this one is about the radius chips.
 *
 * E3.3 must NOT use this. Its subject is LIVE open/closed badges, and the
 * bundled core carries no hours: pinning it renders no "Open ·" badge at all
 * and the positive control fails 6/6 (measured 2026-08-18). Register the route
 * per test, not in the shared seed.
 */
async function pinBundledCatalog(page: import('@playwright/test').Page) {
  await page.route('**/rest/v1/bars*', (route) => route.abort());
}

async function seedResultsFromAttaboy(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
  await page.getByRole('button', { name: /Attaboy/ }).click();
  const cards = page.getByTestId('result-card');
  await expect(cards.first()).toBeVisible();
  return cards;
}

async function expectDistanceBand(
  cards: import('@playwright/test').Locator,
  minExclusive: number | null,
  maxInclusive: number | null,
) {
  const seed = bars.find((bar) => bar.id === 'attaboy')!;
  for (const heading of await cards.locator('h3').allTextContents()) {
    const name = heading.replace(/^\d+\.\s*/, '');
    const bar = bars.find((candidate) => candidate.name === name);
    // Name the mismatch here. Passing an undefined bar on produced a TypeError
    // inside src/lib/distance.ts, which reads as a product defect and says
    // nothing about which card the suite could not account for.
    expect(bar, `rendered card ${JSON.stringify(name)} is not in the bundled catalog`).toBeDefined();
    const miles = haversineMiles(seed, bar!);
    if (minExclusive !== null) expect(miles).toBeGreaterThan(minExclusive);
    if (maxInclusive !== null) expect(miles).toBeLessThanOrEqual(maxInclusive);
  }
}

test.describe('E3.2 distance chips', () => {
  test('Walkable default; Worth a cab and Anywhere re-rank in place; no slider units', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(LATE_EVENING);
    await pinBundledCatalog(page);
    const cards = await seedResultsFromAttaboy(page);

    const group = page.getByRole('group', { name: 'Search radius' });
    await expect(group).toBeVisible();

    // Two intent chips + the escape; walking is the default (R5/R8).
    const walkable = group.getByRole('button', { name: 'Walkable' });
    const cab = group.getByRole('button', { name: 'Worth a cab' });
    const anywhere = group.getByRole('button', { name: 'Anywhere' });
    await expect(walkable).toHaveAttribute('aria-pressed', 'true');
    await expect(cab).toHaveAttribute('aria-pressed', 'false');
    await expect(anywhere).toHaveAttribute('aria-pressed', 'false');
    await expectDistanceBand(cards, null, RADIUS_WALK);

    // The deleted vocabulary never renders.
    await expect(group.getByText(/Short Uber|Walking/)).toHaveCount(0);

    const walkBatch = await cards.locator('h3').allTextContents();
    await cab.click();
    await expect(cab).toHaveAttribute('aria-pressed', 'true');
    await expect(walkable).toHaveAttribute('aria-pressed', 'false');
    // Cab admits a wider taste-ranked pool, including nearby bars, even when
    // route times are disabled. It must not reuse the nearest-15 walk shortlist.
    await expect(cards.locator('h3')).not.toHaveText(walkBatch);
    await expectDistanceBand(cards, null, RADIUS_CAB);
    await expect(cards.first()).toContainText(/Drive ~/);
    await expect(page).toHaveURL('/');

    await anywhere.click();
    await expect(anywhere).toHaveAttribute('aria-pressed', 'true');
    await page.getByText('About travel times', { exact: true }).click();
    await expect(page.getByText('Beyond 4 miles straight-line, within the service area.', { exact: true })).toBeVisible();
    await expect(cards).toHaveCount(5);
    await expectDistanceBand(cards, RADIUS_CAB, null);
    await expect(cards.first()).toContainText(/Walk ~/);
    await walkable.click();
    await expect(cards.locator('h3')).toHaveText(walkBatch);
  });
});

test.describe('E3.3 open-now hard filter', () => {
  test('late evening: results carry live "Open ·" badges (positive control)', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(LATE_EVENING);
    const cards = await seedResultsFromAttaboy(page);

    // At Friday 11pm the surviving cards are open-state — or, since the
    // opens-soon refinement, opening by midnight at the latest.
    await expect(cards.getByText(/Open ·|Open 24 hours/).first()).toBeVisible();
    await expect(cards.getByText(/Closed/)).toHaveCount(0);
    for (const badge of await cards.getByText(/^Opens /).allInnerTexts()) {
      expect(badge).toMatch(/^Opens (11(:\d{2})? PM|midnight)$/);
    }
  });

  test('morning: KNOWN-closed bars never render unless opening within the hour (negative)', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(EARLY_MORNING);
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();

    // At Monday 9am the filter may thin the pool all the way to the
    // honest empty state — either outcome proves the surface. A "Closed"
    // badge, or an "Opens" time later than 10 AM (the one-hour day-
    // drinker window), would mean the hard filter leaked.
    const cards = page.getByTestId('result-card');
    const empty = page.getByText(/No matches found nearby/i);
    await expect(cards.first().or(empty).first()).toBeVisible();
    await expect(page.getByText(/Closed/)).toHaveCount(0);
    for (const badge of await cards.getByText(/^Opens /).allInnerTexts()) {
      expect(badge).toMatch(/^Opens (9(:\d{2})? AM|10 AM)$/);
    }
  });
});
