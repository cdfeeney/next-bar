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

import { test, expect, type Page } from './helpers/test';
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
    // The locked design has no heading on this surface — the map IS the page,
    // so the map surface itself is the recognizable landmark.
    await expect(page.getByTestId('map-surface')).toBeVisible();
    // Leaflet attribution link is a reliable marker that the map booted.
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });
    await expectNoConsoleErrors(page, '/map');
  });

  test('/discover renders the swipe stack', async ({ page }) => {
    await page.goto('/discover');
    await expect(page.getByRole('heading', { name: /^Discover$/ })).toBeVisible();
    // A fresh context has nothing rated/saved, so a card is always up.
    await expect(page.getByTestId('discover-card-heading')).toBeVisible({
      timeout: 15_000,
    });
    await expectNoConsoleErrors(page, '/discover');
  });

  test('/rankings renders empty state when no ratings', async ({ page }) => {
    // Fresh Playwright contexts ship with empty localStorage by default —
    // no need to goto('/') first to clear. Skipping that extra navigation
    // avoids the Next.js dev cold-compile race on /rankings.
    await page.goto('/rankings');
    await expect(page.getByRole('heading', { name: /^Bar Rankings$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Nothing here yet/i })).toBeVisible();
    await expectNoConsoleErrors(page, '/rankings');
  });

  test('/friends renders Social — the wordmark header and its three sub-tabs', async ({
    page,
  }) => {
    await page.goto('/friends');
    // The approved surface's header is the wordmark, not an h1 reading
    // "Friends" — that heading belonged to the 2026-07-26 dashboard.
    await expect(page.getByRole('heading', { name: /^Next Bar$/ })).toBeVisible();
    await expect(page.getByTestId('social-subtabs').getByRole('tab')).toHaveCount(3);
    // Tonight lands first and carries presence and the people graph. It used to
    // assert the STORIES RAIL here, which was only ever visible signed-out
    // because the rail was seeded from demo friends. Stories are server-backed
    // now and there is no anonymous story surface, so this smoke check asserts
    // the honest signed-out state instead — the rail itself is covered, with a
    // session, in story-rail.spec.ts.
    await expect(page.getByTestId('stories-signed-out')).toBeVisible();
    await expect(page.getByTestId('stories-rail')).toHaveCount(0);
    // `social-tonight`, not `friends-tonight`: the WP1 merge (7c6b085) settled
    // that WP7's TonightPresence IS Social → Tonight, and the older component
    // that carried the `friends-tonight` id went with the suggestions-backed
    // presence source it read. One region, one name.
    await expect(page.getByTestId('social-tonight')).toBeVisible();
    await expect(page.getByRole('link', { name: /Followers/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Following/i })).toBeVisible();
    await expectNoConsoleErrors(page, '/friends');
  });

  test('/friends/followers renders its list heading', async ({ page }) => {
    await page.goto('/friends/followers');
    await expect(page.getByRole('heading', { name: /^Followers$/ })).toBeVisible();
    await expectNoConsoleErrors(page, '/friends/followers');
  });

  test('/friends/following renders its list heading', async ({ page }) => {
    await page.goto('/friends/following');
    await expect(page.getByRole('heading', { name: /^Following$/ })).toBeVisible();
    await expectNoConsoleErrors(page, '/friends/following');
  });

  test('/friends/consensus renders the group picker', async ({ page }) => {
    await page.goto('/friends/consensus');
    await expect(
      page.getByRole('heading', { name: /Plan Night Out/i }),
    ).toBeVisible();
    await expectNoConsoleErrors(page, '/friends/consensus');
  });

  test('/u/[handle] renders a friend profile', async ({ page }) => {
    await page.goto('/u/claire');
    await expect(page.getByRole('heading', { name: /Claire R\./i })).toBeVisible();
    await expect(page.getByText(/Cocktail Romantic/i)).toBeVisible();
    await expectNoConsoleErrors(page, '/u/claire');
  });

  test('/settings renders the signed-out Account root', async ({ page }) => {
    // WP8 split this surface: /settings is the profile ROOT and its h1 reads
    // "Account"; the settings list moved to /settings/preferences, which keeps
    // the "Settings" heading (smoke-tested below).
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /^Account$/ })).toBeVisible();
    // A configured build resolves signed-out to the CTA; an intentionally
    // unconfigured local build resolves to its explicit unavailable state.
    await expect(
      page
        .getByRole('link', { name: /Sign in/i })
        .or(page.getByText(/Sign-in is unavailable on this build/i)),
    ).toBeVisible({ timeout: 10_000 });
    await expectNoConsoleErrors(page, '/settings');
  });

  test('/settings/preferences renders the Settings list', async ({ page }) => {
    await page.goto('/settings/preferences');
    await expect(page.getByRole('heading', { name: /^Settings$/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Edit profile/ })).toBeVisible();
    await expectNoConsoleErrors(page, '/settings/preferences');
  });

  test('/install renders the marketing pitch', async ({ page }) => {
    await page.goto('/install');
    await expect(page.getByRole('heading', { name: /Stop going to the/i })).toBeVisible();
    await expectNoConsoleErrors(page, '/install');
  });

  test('/auth renders the email + password sign-in form', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.getByRole('heading', { name: /Sign in to Next Bar/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Sign in →$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /forgot your password/i })).toBeVisible();
    await expectNoConsoleErrors(page, '/auth');
  });
});
