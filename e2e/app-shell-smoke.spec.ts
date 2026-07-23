/**
 * app-shell-smoke.spec.ts
 *
 * One smoke test per top-level route: visit it, expect a recognizable
 * heading or anchor, no console errors. Catches the class of bug where a
 * page crashes on render after a refactor (importer missing a component,
 * SSR throwing on a hook, etc.) before the user has to notice it.
 *
 * If you add a new route to the bottom nav or top nav, ADD A SMOKE TEST.
 */

import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

async function expectNoConsoleErrors(page: Page, label: string): Promise<void> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  // Yield once so any post-mount errors land in the array.
  await page.waitForTimeout(250);
  expect(errors, `console errors on ${label}: ${errors.join(' | ')}`).toEqual([]);
}

test.describe('App-shell smoke', () => {
  test('/ (Next Bar?) falls back to BarPicker when location is denied', async ({
    page,
  }) => {
    // Location-first home: deny geo so it falls back to the manual pick flow.
    await denyGeolocation(page.context());
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Where are you\?/i })).toBeVisible();
    await expectNoConsoleErrors(page, '/');
  });

  test('/quiz renders the first quiz question', async ({ page }) => {
    await page.goto('/quiz');
    await expect(page.getByText('Friday, 11pm. What sounds good?')).toBeVisible({
      timeout: 30_000,
    });
    await expectNoConsoleErrors(page, '/quiz');
  });

  test('/map renders the Leaflet map', async ({ page }) => {
    await page.goto('/map');
    await expect(page.getByRole('heading', { name: /^Map$/ })).toBeVisible();
    // Leaflet attribution link is a reliable marker that the map booted.
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });
    await expectNoConsoleErrors(page, '/map');
  });

  test('/rankings renders empty state when no ratings', async ({ page }) => {
    // Fresh Playwright contexts ship with empty localStorage by default —
    // no need to goto('/') first to clear. Skipping that extra navigation
    // avoids the Next.js dev cold-compile race on /rankings.
    await page.goto('/rankings');
    await expect(page.getByRole('heading', { name: /^Rankings$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Nothing here yet/i })).toBeVisible();
    await expectNoConsoleErrors(page, '/rankings');
  });

  test('/friends renders the social feed with curators', async ({ page }) => {
    await page.goto('/friends');
    await expect(page.getByRole('heading', { name: /^Friends$/ })).toBeVisible();
    // Marquee consensus CTA.
    await expect(page.getByRole('link', { name: /Where should we go\?/i })).toBeVisible();
    // A default-followed curator card is present.
    await expect(page.getByRole('heading', { name: /Maya R\./i })).toBeVisible();
    await expectNoConsoleErrors(page, '/friends');
  });

  test('/friends/consensus renders the group picker', async ({ page }) => {
    await page.goto('/friends/consensus');
    await expect(
      page.getByRole('heading', { name: /Where should we go\?/i }),
    ).toBeVisible();
    await expectNoConsoleErrors(page, '/friends/consensus');
  });

  test('/u/[handle] renders a friend profile', async ({ page }) => {
    await page.goto('/u/maya');
    await expect(page.getByRole('heading', { name: /Maya R\./i })).toBeVisible();
    await expect(page.getByText(/Cocktail Romantic/i)).toBeVisible();
    await expectNoConsoleErrors(page, '/u/maya');
  });

  test('/settings renders signed-out account card', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /^Settings$/ })).toBeVisible();
    // Auth state resolves to signed-out for fresh contexts; expect the
    // Sign-in CTA, not the email + Sign-out row.
    await expect(page.getByRole('link', { name: /Sign in/i })).toBeVisible({
      timeout: 10_000,
    });
    await expectNoConsoleErrors(page, '/settings');
  });

  test('/install renders the marketing pitch', async ({ page }) => {
    await page.goto('/install');
    await expect(page.getByRole('heading', { name: /Stop going to the/i })).toBeVisible();
    await expectNoConsoleErrors(page, '/install');
  });

  test('/auth renders the sign-in form (password default, link tab)', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.getByRole('heading', { name: /Sign in to Next Bar/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Sign in →$/ })).toBeVisible();
    await page.getByRole('tab', { name: /Email link/i }).click();
    await expect(page.getByRole('button', { name: /Send sign-in link/i })).toBeVisible();
    await expectNoConsoleErrors(page, '/auth');
  });
});
