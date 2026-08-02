/**
 * exact-filter-empty.spec.ts (goal g-6cc99120)
 *
 * Exact-filter recovery on /map: Chill (Energy) + Rooftop (Setting) +
 * Old New York (Scene) is a three-axis AND with no intersection in the
 * catalog. The surface must say so HONESTLY — filters preserved, nothing
 * silently widened — and offer two working ways out: "Adjust filters"
 * (sheet reopens with the selections intact) and "Clear filters" (explicit
 * reset to the full catalog).
 *
 * Runs on iPhone 13, Pixel 7, AND the 402x681 shortest-viewport project
 * (added to its testMatch): the recovery card carries two action buttons,
 * exactly the control shape that fails first on the shortest viewport.
 */

import { test, expect, type Page, type Locator } from '@playwright/test';

async function openSheet(page: Page) {
  const disclosure = page.getByRole('button', { name: /Tweak the vibe/i });
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  const sheet = page.getByTestId('findbar-filters');
  await expect(sheet).toBeVisible();
  return { disclosure, sheet };
}

function rowTrigger(sheet: Locator, label: string) {
  return sheet.getByRole('button', { name: new RegExp(`^${label}\\b`) });
}

async function pickInAxis(sheet: Locator, axis: string, tag: string) {
  const row = rowTrigger(sheet, axis);
  if ((await row.getAttribute('aria-expanded')) !== 'true') {
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
  }
  const chip = sheet.getByRole('button', { name: new RegExp(`^${tag}\\b`) });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
}

async function applyImpossibleCombo(page: Page) {
  const { sheet } = await openSheet(page);
  await pickInAxis(sheet, 'Energy', 'Chill');
  await pickInAxis(sheet, 'Setting', 'Rooftop');
  await pickInAxis(sheet, 'Scene', 'Old New York');
  await sheet.getByRole('button', { name: /^Apply$/ }).click();
  await expect(sheet).toHaveCount(0);
}

test.describe('/map exact-filter recovery (g-6cc99120)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/map');
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('an impossible exact combo shows the honest empty state; Clear restores the catalog', async ({
    page,
  }) => {
    await applyImpossibleCombo(page);

    const empty = page.getByTestId('exact-filter-empty');
    await expect(empty).toBeVisible();
    // Honest copy: names the request, states nothing was widened.
    await expect(empty).toContainText(/No bar matches/i);
    await expect(empty).toContainText('Chill');
    await expect(empty).toContainText('Rooftop');
    await expect(empty).toContainText('Old New York');
    await expect(empty).toContainText(/nothing was widened/i);
    // The footer count corroborates: zero matched, catalog intact.
    await expect(page.getByText(/^0 of \d+ bars match your filters$/)).toBeVisible();

    // NEGATIVE: the filters were NOT silently weakened — the collapsed row
    // still shows all three picks and the count badge reads 3.
    await expect(page.getByTestId('collapsed-filter-count')).toHaveText('3');

    const urlBefore = page.url();
    const clear = empty.getByRole('button', { name: /^Clear filters$/ });
    const box = await clear.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await clear.click();

    // Full catalog returns; empty state leaves; no navigation happened.
    expect(page.url()).toBe(urlBefore);
    await expect(empty).toHaveCount(0);
    await expect(page.getByText(/bars across \d+ neighborhoods/)).toBeVisible();
    await expect(page.getByTestId('collapsed-filter-count')).toHaveCount(0);
  });

  test('Adjust filters reopens the sheet WITH the selections intact (nothing cleared)', async ({
    page,
  }) => {
    await applyImpossibleCombo(page);

    const empty = page.getByTestId('exact-filter-empty');
    const urlBefore = page.url();
    await empty.getByRole('button', { name: /^Adjust filters$/ }).click();

    // NEGATIVE: adjusting must not navigate and must not discard the draft.
    expect(page.url()).toBe(urlBefore);
    const sheet = page.getByTestId('findbar-filters');
    await expect(sheet).toBeVisible();

    // The three picks survived — the sheet re-seeds from the APPLIED filters.
    for (const [axis, tag] of [
      ['Energy', 'Chill'],
      ['Setting', 'Rooftop'],
      ['Scene', 'Old New York'],
    ] as const) {
      const row = rowTrigger(sheet, axis);
      if ((await row.getAttribute('aria-expanded')) !== 'true') {
        await row.click();
      }
      await expect(
        sheet.getByRole('button', { name: new RegExp(`^${tag}\\b`) }),
      ).toHaveAttribute('aria-pressed', 'true');
    }

    // Loosen ONE axis (drop Rooftop) and Apply: results return without the
    // user losing the other two picks — recovery, not reset.
    await pickInAxisToggleOff(sheet, 'Setting', 'Rooftop');
    await sheet.getByRole('button', { name: /^Apply$/ }).click();
    await expect(page.getByTestId('exact-filter-empty')).toHaveCount(0);
    await expect(page.getByTestId('collapsed-filter-count')).toHaveText('2');
    await expect(
      page.getByText(/^[1-9]\d* of \d+ bars match your filters$/),
    ).toBeVisible();
  });
});

async function pickInAxisToggleOff(sheet: Locator, axis: string, tag: string) {
  // The accordion keeps ONE axis open at a time, so the tag's own row must
  // be (re)expanded before its chip is reachable.
  const row = rowTrigger(sheet, axis);
  if ((await row.getAttribute('aria-expanded')) !== 'true') {
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
  }
  const chip = sheet.getByRole('button', { name: new RegExp(`^${tag}\\b`) });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
}
