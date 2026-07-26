/**
 * share-card.spec.ts — blueprint B3 (shareable pick cards).
 *
 * The recipient-side share page must render logged-out with the pick card
 * and app CTA, 404 unknown bars, and the vote result screen must offer the
 * share button (share-sheet/clipboard behavior itself is engine-gated, so
 * we assert presence, not the native sheet).
 */

import { test, expect } from '@playwright/test';

test.describe('Shareable pick cards', () => {
  test('share page leads with the in-product CTA, keeps Maps secondary', async ({
    page,
  }) => {
    await page.goto('/share/death-and-co');

    await expect(page.getByText(/Tonight's pick/i)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Death & Co/i }),
    ).toBeVisible();
    await expect(page.getByText(/East Village/i)).toBeVisible();

    // PRIMARY is now in-product — this is the whole point of the change.
    const appCta = page.getByRole('link', { name: /Find your next bar/i });
    await expect(appCta).toBeVisible();
    await expect(appCta).toHaveAttribute('href', '/');

    // Maps survives as a real, tappable secondary — a recipient who was
    // just texted tonight's plan still needs directions.
    const mapsCta = page.getByRole('link', { name: /Open in Maps/i });
    await expect(mapsCta).toBeVisible();
    await expect(mapsCta).toHaveAttribute('href', /google\.com\/maps\/search/);

    // NEGATIVE ASSERTION (goal acceptance 5): Maps must no longer be the
    // primary. The accent-filled pill is the primary treatment; Maps must
    // not wear it, and the in-product CTA must.
    await expect(appCta).toHaveClass(/bg-accent/);
    await expect(mapsCta).not.toHaveClass(/bg-accent/);

    // NEGATIVE ASSERTION: the dead-end "Get Next Bar" footnote is gone —
    // it was the demoted treatment that made the loop leak.
    await expect(
      page.getByRole('link', { name: /Get Next Bar/i }),
    ).toHaveCount(0);
  });

  test('a signed-out profile is shareable — the loop-starting artifact', async ({
    page,
  }) => {
    // Signed out is the case that matters: a share recipient has no account,
    // and if THEY can't share onward the loop dies one hop in.
    await page.goto('/u/claire');

    const shareBtn = page.getByRole('button', { name: /Share @claire's list/i });
    await expect(shareBtn).toBeVisible();

    // Tapping must not navigate away — the share sheet/clipboard is a
    // side effect, not a route change. (Negative assertion: this is exactly
    // the class of bug the CLAUDE.md testing rule was written for.)
    await shareBtn.click();
    await expect(page).toHaveURL(/\/u\/claire$/);
  });

  test('unknown bar id 404s', async ({ page }) => {
    const response = await page.goto('/share/not-a-real-bar');
    expect(response?.status()).toBe(404);
  });

  test('vote result screen offers the share button', async ({ page }) => {
    await page.goto('/friends/consensus');
    await page.getByRole('button', { name: /Put it to a vote/i }).click();
    await expect(page.getByText(/Tonight's pick/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Share the pick/i }),
    ).toBeVisible();
  });
});

/**
 * Week-2 recipient landing (goal acceptance 6).
 *
 * The recipient is signed out and always will be at this point in the loop —
 * they were texted a link by a friend, that is all. These run on both
 * iPhone 13 and Pixel 7 via the project matrix.
 */
test.describe('Signed-out recipient can vote before signup', () => {
  test('casting a vote never routes to /auth', async ({ page }) => {
    await page.goto('/share/death-and-co');

    const vote = page.getByRole('region', { name: /Rate Death & Co/i });
    await expect(vote).toBeVisible();
    await expect(page.getByText(/No signup, no email/i)).toBeVisible();

    await page.getByRole('button', { name: /Loved it/i }).click();

    // THE negative assertion: the one moment of intent the share bought must
    // not be spent on a signup wall.
    await expect(page).toHaveURL(/\/share\/death-and-co$/);
    await expect(page.getByText(/That is your list started/i)).toBeVisible();

    // And there is no route to /auth on the page at all, post-vote.
    await expect(page.locator('a[href^="/auth"]')).toHaveCount(0);
  });

  test('the vote survives a reload without an account', async ({ page }) => {
    await page.goto('/share/death-and-co');
    await page.getByRole('button', { name: /Liked it/i }).click();
    await expect(
      page.getByRole('button', { name: /Liked it/i }),
    ).toHaveAttribute('aria-pressed', 'true');

    await page.reload();

    // Persisted through useRatings' signed-out localStorage path — no
    // account, no server round-trip, and the sign-in merge will carry it up.
    await expect(
      page.getByRole('button', { name: /Liked it/i }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('the reward for voting is the list, not a form', async ({ page }) => {
    await page.goto('/share/death-and-co');
    await page.getByRole('button', { name: /Loved it/i }).click();

    const cta = page.getByRole('link', { name: /See your list/i });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/rankings');
  });
});
