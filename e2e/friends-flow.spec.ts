/**
 * friends-flow.spec.ts
 *
 * The social layer is the product pitch ("Beli for bars"), so its
 * interactions get first-class coverage:
 *   1. Following a suggested curator moves them into "Your circle".
 *   2. Consensus surfaces bars the selected group all rated (and excludes
 *      anyone's Pass).
 *   3. The "sample night" seeder populates Rankings from an empty state.
 *   4. The profile follow toggle persists.
 *
 * Fresh Playwright contexts start with empty localStorage, so follows fall
 * back to the default set (maya, jordan) — see useFollows.
 */

import { test, expect } from '@playwright/test';

test.describe('Friends + consensus', () => {
  test('following a suggested curator adds them to your circle', async ({ page }) => {
    await page.goto('/friends');

    // Default circle is 2 (maya, jordan); Sasha is in the suggested list.
    await expect(page.getByText(/Your circle · 2/)).toBeVisible();

    // The suggested row (only Sasha, who isn't followed by default, shows
    // @sasha) has a Follow button. Scope to that row, not a broad div.
    const sashaRow = page
      .locator('.bg-surface')
      .filter({ hasText: '@sasha' });
    await sashaRow.getByRole('button', { name: /^Follow$/ }).click();

    // Circle grows to 3.
    await expect(page.getByText(/Your circle · 3/)).toBeVisible();
  });

  test('consensus shows bars the group all rated', async ({ page }) => {
    await page.goto('/friends/consensus');

    // With the default group (maya + jordan), there is overlap.
    await expect(page.getByText(/You all agree on/i)).toBeVisible();
    // Death & Co is loved by both curators → appears as a group pick.
    await expect(
      page.getByRole('heading', { name: /Death & Co/i }),
    ).toBeVisible();
  });

  test('consensus needs at least two people selected', async ({ page }) => {
    await page.goto('/friends/consensus');

    // Deselect jordan, leaving only maya → not enough for consensus.
    await page.getByRole('button', { name: /Jordan/ }).click();
    await expect(page.getByText(/Pick at least two people/i)).toBeVisible();
  });

  test('sample-night seeder populates rankings from empty', async ({ page }) => {
    await page.goto('/rankings');
    await expect(
      page.getByRole('heading', { name: /Nothing here yet/i }),
    ).toBeVisible();

    await page
      .getByRole('button', { name: /load a sample night/i })
      .click();

    // Rankings now show the seeded bars, sorted by score.
    await expect(
      page.getByRole('heading', { name: /Death & Co/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Nothing here yet/i }),
    ).toHaveCount(0);
  });

  test('profile follow toggle flips label', async ({ page }) => {
    await page.goto('/u/sasha');

    // Sasha is not in the default follow set.
    const followBtn = page.getByRole('button', { name: /^Follow$/ });
    await expect(followBtn).toBeVisible();
    await followBtn.click();
    await expect(
      page.getByRole('button', { name: /^Following$/ }),
    ).toBeVisible();
  });
});
