/**
 * settings-clarity.spec.ts (goal g-65a31bdf, criteria 8–11)
 *
 * Settings must tell the truth: the ACTUAL saved quiz archetype (not only
 * the rating-derived taste label), badges reachable before the first
 * rating, the Demo tools off the ordinary path but reachable via the
 * explicit reviewer URL, and sync copy that matches what actually syncs.
 */

import { test, expect } from '@playwright/test';
import { fakeSignedIn } from './helpers/fakeAuth';

const seedQuizProfile = () => {
  window.localStorage.setItem(
    'next-bar:profile:v1',
    JSON.stringify({
      tags: ['dive', 'chill', 'cheap'],
      archetype: 'Dive regular',
      preferredNeighborhoods: [],
      savedAt: new Date().toISOString(),
    }),
  );
};

test.describe('Settings clarity (g-65a31bdf)', () => {
  test('badges section is visible with an empty/progress state before any rating', async ({
    page,
  }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Badges' })).toBeVisible();
    await expect(page.getByTestId('badges-empty')).toBeVisible();
    // Progress chips render with 0/target — badges are discoverable, not
    // hidden until earned.
    await expect(page.getByText(/0\/\d+/).first()).toBeVisible();
  });

  test('saved quiz archetype is shown verbatim in the Vibe profile section', async ({
    page,
  }) => {
    await page.addInitScript(seedQuizProfile);
    await page.goto('/settings');
    await expect(page.getByText('Your quiz answers are saved:')).toBeVisible();
    await expect(page.getByText('Dive regular')).toBeVisible();
  });

  test('without a profile the section says so and offers the quiz', async ({
    page,
  }) => {
    await page.goto('/settings');
    await expect(page.getByText('No vibe profile yet.')).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Take the quiz/ }),
    ).toHaveAttribute('href', '/quiz');
  });

  test('Demo tools are hidden from the ordinary path and reachable via ?demo=1', async ({
    page,
  }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Demo' })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /Load sample night/ }),
    ).toHaveCount(0);

    await page.goto('/settings?demo=1');
    await expect(page.getByRole('heading', { name: 'Demo' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Load sample night/ }),
    ).toBeVisible();
  });

  test('a seeded sample night keeps Demo visible on the ordinary path so it can be removed', async ({
    page,
  }) => {
    await page.goto('/settings?demo=1');
    await page.getByRole('button', { name: /Load sample night/ }).click();
    await expect(
      page.getByRole('button', { name: /Remove sample night/ }),
    ).toBeVisible();

    // Back on the plain URL: the section stays until the sample is removed.
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Demo' })).toBeVisible();
    await page.getByRole('button', { name: /Remove sample night/ }).click();
    await expect(page.getByRole('heading', { name: 'Demo' })).toHaveCount(0);
  });

  test('signed-out Data copy states the true sync split (nothing syncs; sign-in syncs ratings + vibe profile)', async ({
    page,
  }) => {
    await page.goto('/settings');
    await expect(
      page.getByText(/Sign in to sync your ratings and vibe profile/),
    ).toBeVisible();
    await expect(
      page.getByText(/Everything you.?ve rated lives only on this device until/),
    ).toHaveCount(0);
  });

  test('signed-in Data copy states what actually syncs (both auth modes per CLAUDE.md)', async ({
    page,
    context,
  }) => {
    const ok = await fakeSignedIn(context, page);
    test.skip(!ok, 'no Supabase URL configured');
    await page.goto('/settings');
    await expect(
      page.getByText(/Your ratings and vibe profile sync to your account/),
    ).toBeVisible();
    await expect(
      page.getByText(/Sign in to sync your ratings and vibe profile/),
    ).toHaveCount(0);
  });

  test('signed-in empty Rankings names the true sync state', async ({
    page,
    context,
  }) => {
    const ok = await fakeSignedIn(context, page);
    test.skip(!ok, 'no Supabase URL configured');
    await page.goto('/rankings');
    await expect(page.getByText('Nothing here yet.')).toBeVisible();
    // The empty-state explainer prose is GONE (operator 2026-08-03 —
    // "just the add a bar button"); the sync claim lives in the page
    // footer now, and it still must not lie.
    await expect(page.getByText(/Synced to your account/)).toBeVisible();
    await expect(
      page.getByText(/Your ratings sync to your account/),
    ).toHaveCount(0);
    await expect(page.getByText(/stay on this device until the/)).toHaveCount(0);
  });
});
