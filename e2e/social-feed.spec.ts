/**
 * social-feed.spec.ts — Social · Feed, after the V8 Stories backend.
 *
 * WHAT THIS FILE CAN STILL PROVE, AND WHAT MOVED AWAY FROM IT.
 *
 * Cycle 1's Feed was seeded: `demoFriends` produced memories with captions and
 * ranking events, so a signed-OUT browser rendered a populated stream and this
 * spec asserted against it. Every one of those rows was invented, which is
 * exactly what the V8 amendment removed — Feed now renders the same real,
 * unexpired `public.stories` rows the rail does, and there is no anonymous
 * story surface at all.
 *
 * So this spec no longer asserts card contents. It asserts the things that are
 * still true without a session: the three sub-tabs, and that a signed-out
 * visitor is told the truth instead of being shown a demo reel.
 *
 * THE REAL FEED BEHAVIOUR IS PROVEN IN `src/lib/storiesRls.live.test.ts`
 * (two identities, authorised visibility, denial, expiry, custom audience),
 * which needs a database and two accounts and does NOT run in this gate. That
 * is the attended staging verification the goal reports as required before V8
 * can launch — not coverage this file quietly lost.
 */

import { test, expect } from '@playwright/test';

test.describe('Social · Feed', () => {
  test('the three sub-tabs are unchanged and Feed is reachable', async ({ page }) => {
    await page.goto('/friends');
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveText(/Tonight/i);
    await expect(tabs.nth(1)).toHaveText(/Plans/i);
    await expect(tabs.nth(2)).toHaveText(/Feed/i);

    await tabs.nth(2).click();
    await expect(page.getByTestId('social-panel-feed')).toBeVisible();
  });

  test('signed out, Feed shows no invented memories', async ({ page }) => {
    await page.goto('/friends');
    await page.getByRole('tab', { name: /Feed/i }).click();

    // No seeded cards, and no Feed section at all when there is nothing real.
    await expect(page.getByTestId('feed-memory')).toHaveCount(0);
    await expect(page.getByTestId('friends-feed')).toHaveCount(0);

    // What IS shown says why, and offers the one action that changes it.
    await expect(page.getByTestId('stories-signed-out')).toBeVisible();
    await expect(page.getByTestId('stories-sign-in')).toHaveAttribute('href', '/auth');
  });

  test('the retired Feed actions are gone, not merely hidden', async ({ page }) => {
    await page.goto('/friends');
    await page.getByRole('tab', { name: /Feed/i }).click();

    // Reply wrote to localStorage and nothing ever delivered it.
    await expect(page.getByTestId('feed-reply')).toHaveCount(0);
    await expect(page.getByTestId('feed-reply-input')).toHaveCount(0);
    // "View night" pointed at a demo share id no real night ever has.
    await expect(page.getByTestId('feed-view-night')).toHaveCount(0);
  });

  test('no public like counts and no follower metrics anywhere on Feed', async ({
    page,
  }) => {
    await page.goto('/friends');
    await page.getByRole('tab', { name: /Feed/i }).click();
    const panel = page.getByTestId('social-panel-feed');
    await expect(panel).not.toContainText(/\blikes?\b/i);
    await expect(panel).not.toContainText(/\bfollowers\b/i);
  });

  test('the existing Social data flows are still live beside Feed', async ({
    page,
  }) => {
    await page.goto('/friends');
    await expect(page.getByRole('tab', { name: /Tonight/i })).toBeVisible();
    await page.getByRole('tab', { name: /Plans/i }).click();
    await expect(page.getByRole('heading', { name: /^Plans$/i })).toBeVisible();
  });
});
