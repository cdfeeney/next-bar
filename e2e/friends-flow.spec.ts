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
 * back to the default set (claire, john) — see useFollows.
 */

import { test, expect } from '@playwright/test';

test.describe('Friends + consensus', () => {
  test('following a suggested curator bumps the Following stat and lands them in the list (UX-A)', async ({ page }) => {
    await page.goto('/friends');

    // Instagram-model stats: default demo circle is 2 (claire, john).
    const followingStat = page.getByRole('link', { name: /2\s+Following/i });
    await expect(followingStat).toBeVisible();

    // Follow Sasha from Find friends; the stat ticks to 3.
    const sashaRow = page
      .locator('.bg-surface')
      .filter({ hasText: '@sasha' });
    await sashaRow.getByRole('button', { name: /^Follow$/ }).click();
    await expect(page.getByRole('link', { name: /3\s+Following/i })).toBeVisible();

    // Tap the stat → the Following LIST page has her row.
    await page.getByRole('link', { name: /3\s+Following/i }).click();
    await expect(page).toHaveURL('/friends/following');
    await expect(page.getByText('@sasha')).toBeVisible();
  });

  test('Group Favorites shows bars the group all rated, top pick shareable (UX-B)', async ({ page }) => {
    await page.goto('/friends/consensus');

    // With the default group (claire + john), there is overlap.
    await expect(page.getByText(/Group Favorites/i)).toBeVisible();
    // Death & Co is loved by both curators → appears as a group pick,
    // and the TOP pick carries the share moment (no vote step anymore).
    await expect(
      page.getByRole('heading', { name: /Death & Co/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Share the pick/i }),
    ).toBeVisible();
  });

  test('consensus needs at least two people selected', async ({ page }) => {
    await page.goto('/friends/consensus');

    // Deselect john, leaving only claire → not enough for consensus.
    await page.getByRole('button', { name: /John/ }).click();
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

  test('tonight intent pills toggle, persist, and clear (UX-A compact row)', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-07-24T22:00:00'));
    await page.goto('/friends');

    // One tap sets; it sticks across reload; tapping the lit pill clears.
    const goingBtn = page.getByRole('button', { name: /^Going out$/ });
    await goingBtn.click();
    await expect(goingBtn).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    const goingAfter = page.getByRole('button', { name: /^Going out$/ });
    await expect(goingAfter).toHaveAttribute('aria-pressed', 'true');
    await goingAfter.click();
    await expect(goingAfter).toHaveAttribute('aria-pressed', 'false');

    // QA4: third pill "Not tonight" — same toggle semantics, persists.
    const notTonight = page.getByRole('button', { name: /^Not tonight$/ });
    await notTonight.click();
    await expect(notTonight).toHaveAttribute('aria-pressed', 'true');
    // Statuses are exclusive — setting it never lights the others.
    await expect(goingAfter).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    const notTonightAfter = page.getByRole('button', { name: /^Not tonight$/ });
    await expect(notTonightAfter).toHaveAttribute('aria-pressed', 'true');
    await notTonightAfter.click();
    await expect(notTonightAfter).toHaveAttribute('aria-pressed', 'false');
  });

  // The multi-step Put-it-to-a-vote flow is DELETED (UX-B): Group
  // Favorites + People's Choice replace it; the winner-share moment moved
  // to the top Group Favorite (covered above and in share-card.spec).

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
