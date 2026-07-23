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

  test('tonight intent toggles, persists, and shows circle signals', async ({ page }) => {
    await page.goto('/friends');

    // Default circle (maya + jordan) has seeded demo signals.
    await expect(page.getByText(/Maya/).first()).toBeVisible();
    await expect(page.getByText(/is going out tonight/i)).toBeVisible();
    await expect(page.getByText(/might be out later/i)).toBeVisible();

    // Set your own status; it sticks across reload.
    const goingBtn = page.getByRole('button', { name: /^Going out$/ });
    await goingBtn.click();
    await expect(goingBtn).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    const goingAfter = page.getByRole('button', { name: /^Going out$/ });
    await expect(goingAfter).toHaveAttribute('aria-pressed', 'true');

    // Tapping the active status clears it.
    await goingAfter.click();
    await expect(goingAfter).toHaveAttribute('aria-pressed', 'false');
  });

  test('friends-only vote settles instantly with a winner', async ({ page }) => {
    await page.goto('/friends/consensus');

    // Default group is maya + jordan (no "You" without ratings), so their
    // auto-votes decide it the moment the vote starts.
    await page.getByRole('button', { name: /Put it to a vote/i }).click();
    await expect(page.getByText(/Tonight's pick/i)).toBeVisible();
    await expect(page.getByText(/votes?\b/i).first()).toBeVisible();
  });

  test('your tap decides the group vote (happy path)', async ({ page }) => {
    // Seed your own ratings so "You" joins the group.
    await page.goto('/rankings');
    await page.getByRole('button', { name: /load a sample night/i }).click();

    await page.goto('/friends/consensus');
    await page.getByRole('button', { name: /Put it to a vote/i }).click();

    // Three participants → your vote is still outstanding.
    await expect(page.getByText(/Your call/i)).toBeVisible();
    await page.getByRole('button', { name: /^Vote for/ }).first().click();

    await expect(page.getByText(/Tonight's pick/i)).toBeVisible();
    // Restart path returns to the CTA.
    await page.getByRole('button', { name: /Vote again/i }).click();
    await expect(
      page.getByRole('button', { name: /Put it to a vote/i }),
    ).toBeVisible();
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
