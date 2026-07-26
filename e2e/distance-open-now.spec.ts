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

import { test, expect } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

const LATE_EVENING = new Date('2026-07-24T23:00:00'); // Fri 11pm — bars open
const EARLY_MORNING = new Date('2026-07-27T09:00:00'); // Mon 9am — bars closed

async function seedResultsFromAttaboy(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
  await page.getByRole('button', { name: /Attaboy/ }).click();
  const cards = page.locator('article').filter({ hasText: /Vibe match/i });
  await expect(cards.first()).toBeVisible();
  return cards;
}

test.describe('E3.2 distance chips', () => {
  test('Walkable default; Worth a cab and Anywhere re-rank in place; no slider units', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(LATE_EVENING);
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

    // The deleted vocabulary never renders.
    await expect(group.getByText(/Short Uber|Walking/)).toHaveCount(0);

    // Tapping a chip re-ranks in place: same URL, same screen, results
    // still present.
    await cab.click();
    await expect(cab).toHaveAttribute('aria-pressed', 'true');
    await expect(walkable).toHaveAttribute('aria-pressed', 'false');
    await expect(cards.first()).toBeVisible();
    await expect(page).toHaveURL('/');

    await anywhere.click();
    await expect(anywhere).toHaveAttribute('aria-pressed', 'true');
    await expect(cards.first()).toBeVisible();
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
    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    const empty = page.getByText(/No matches found nearby/i);
    await expect(cards.first().or(empty).first()).toBeVisible();
    await expect(page.getByText(/Closed/)).toHaveCount(0);
    for (const badge of await cards.getByText(/^Opens /).allInnerTexts()) {
      expect(badge).toMatch(/^Opens (9(:\d{2})? AM|10 AM)$/);
    }
  });
});
