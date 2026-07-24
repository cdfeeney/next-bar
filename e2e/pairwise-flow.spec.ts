/**
 * pairwise-flow.spec.ts
 *
 * Pairwise comparison flow in signed-out (local) mode, driven through the
 * U2-3 DEEP-LINK entry (`/rankings?add=<barId>` — what "Rank it →" on
 * suggestion cards navigates to). The "+ Add a bar" picker entry to the
 * same machinery is covered by rankings-add-flow.spec.ts.
 *
 * What this covers:
 *   - The deep link opens the tier sheet pre-armed for that bar.
 *   - PairwiseSheet does NOT appear on the first Loved bar (no peer).
 *   - A second Loved bar opens the sheet; picking the just-added bar
 *     records one comparison and /rankings sorts the winner first.
 *   - Skip dismisses without recording a comparison.
 *   - The sheet does NOT open for tier="pass" (Q2 decision).
 */

import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

const ATTABOY = { id: 'attaboy', name: 'Attaboy' };
const DEATH_AND_CO = { id: 'death-and-co', name: 'Death & Co' };

async function clearStorage(page: Page): Promise<void> {
  // Home is location-first; deny geo so `/` settles instantly to the manual
  // surface instead of hanging on the async "Finding bars near you…" spinner.
  await denyGeolocation(page.context());
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    // Re-ack the 21+ age gate (H1) — the config storageState seeded it,
    // and clearing storage must not resurface the overlay mid-test.
    window.localStorage.setItem('next-bar:age-ack:v1', '1');
  });
}

/** Deep-link to the tier sheet for `bar` and pick a tier. */
async function rankViaDeepLink(
  page: Page,
  bar: { id: string; name: string },
  tier: 'Loved' | 'Liked' | 'Pass',
): Promise<void> {
  await page.goto(`/rankings?add=${bar.id}`);
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(`How was ${bar.name}?`);
  await sheet.getByRole('button', { name: new RegExp(`^${tier}`) }).click();
}

test.describe('Pairwise prompt — local mode (deep-link entry)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
  });

  test('deep link arms the tier sheet; first Loved bar gets NO comparison prompt', async ({
    page,
  }) => {
    await rankViaDeepLink(page, ATTABOY, 'Loved');

    // No peer exists → no PairwiseSheet; the bar is simply ranked.
    await page.waitForTimeout(300);
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('article')).toHaveCount(1);
    await expect(page.locator('article').first()).toContainText(ATTABOY.name);
    // The ?add param was consumed — a reload must not re-open the sheet.
    await page.reload();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('second Loved bar opens the sheet; picking it wins and sorts first on /rankings', async ({
    page,
  }) => {
    await rankViaDeepLink(page, ATTABOY, 'Loved');
    await page.waitForTimeout(200);

    await rankViaDeepLink(page, DEATH_AND_CO, 'Loved');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/which did you love more\?/i);
    await expect(dialog).toContainText(ATTABOY.name);
    await expect(dialog).toContainText(DEATH_AND_CO.name);

    // Pick the just-added bar as the winner.
    await dialog
      .getByRole('button')
      .filter({ hasText: DEATH_AND_CO.name })
      .first()
      .click();
    await expect(dialog).not.toBeVisible();

    // One comparison recorded, winner = Death & Co.
    const stored = await page.evaluate(() =>
      window.localStorage.getItem('next-bar:pairwise:v1'),
    );
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toHaveLength(1);

    // /rankings sorts by score; the winner comes first.
    const headings = await page.locator('article h2').allTextContents();
    const names = headings.map((t) => t.replace(/^\d+\.\s*/, '').trim());
    expect(names[0]).toBe(DEATH_AND_CO.name);
    expect(names[1]).toBe(ATTABOY.name);
  });

  test('Skip dismisses the sheet without recording a comparison', async ({
    page,
  }) => {
    await rankViaDeepLink(page, ATTABOY, 'Loved');
    await page.waitForTimeout(200);
    await rankViaDeepLink(page, DEATH_AND_CO, 'Loved');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /skip/i }).click();
    await expect(dialog).not.toBeVisible();

    const stored = await page.evaluate(() =>
      window.localStorage.getItem('next-bar:pairwise:v1'),
    );
    if (stored !== null) {
      expect(JSON.parse(stored)).toEqual([]);
    }
  });

  test('does NOT open for tier="pass"', async ({ page }) => {
    await rankViaDeepLink(page, ATTABOY, 'Loved');
    await page.waitForTimeout(200);

    // Passing a second bar must not trigger a comparison (Q2: no
    // Pass-vs-anything ordering).
    await rankViaDeepLink(page, DEATH_AND_CO, 'Pass');
    await page.waitForTimeout(300);
    await expect(page.getByRole('dialog')).not.toBeVisible();

    const stored = await page.evaluate(() =>
      window.localStorage.getItem('next-bar:pairwise:v1'),
    );
    if (stored !== null) {
      expect(JSON.parse(stored)).toEqual([]);
    }
  });
});
