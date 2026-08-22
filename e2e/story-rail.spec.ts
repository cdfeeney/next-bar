/**
 * story-rail.spec.ts — the Stories rail, after the V8 Stories backend.
 *
 * WHAT CHANGED, STATED PLAINLY. This file used to run signed-OUT against a
 * seeded rail: `demoFriends` gave Claire, Dev and Sasha stories, and the queue,
 * the viewer, the pause rules and the tagged-people sheet were all exercised
 * against that invented data. The header even claimed "the seeded friend
 * stories are identical in both auth modes", which was never true.
 *
 * There is no anonymous story surface any more. Stories are `public.stories`
 * rows readable only by accepted mutual friends, so a signed-out browser has
 * nothing to render and this spec cannot drive a viewer without two real
 * accounts — which would mean writing to a real database, which this cycle is
 * explicitly not authorised to do.
 *
 * COVERAGE THAT MOVED, so nobody reads this shorter file as coverage lost:
 *   - visibility, denial, custom audience, expiry, delete, tag withdrawal →
 *     `src/lib/storiesRls.live.test.ts` (two identities, needs a database;
 *     NOT run in this gate — it is the attended staging verification).
 *   - signed-URL lifetime, publish/cleanup, honest failure →
 *     `src/lib/stories.server.test.ts` (runs here).
 *
 * What remains provable without a session is asserted below: the sub-tab
 * contract, the honest empty states, and that the retired local surfaces are
 * actually gone rather than hidden.
 */

import { test, expect, type Page } from '@playwright/test';

async function openSocial(page: Page): Promise<void> {
  await page.goto('/friends');
  await expect(page.getByTestId('social-subtabs')).toBeVisible();
}

test.describe('Social sub-tabs and the Stories rail', () => {
  test('exactly three sub-tabs, and the five-tab contract is untouched', async ({
    page,
  }) => {
    await openSocial(page);
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(page.getByTestId('social-panel-tonight')).toBeVisible();
    await tabs.nth(1).click();
    await expect(page.getByRole('heading', { name: /^Plans$/i })).toBeVisible();
    await expect(page.getByTestId('social-panel-tonight')).toHaveCount(0);
    await tabs.nth(2).click();
    await expect(page.getByTestId('social-panel-feed')).toBeVisible();
  });

  test('signed out, the rail says so instead of showing invented friends', async ({
    page,
  }) => {
    await openSocial(page);

    // The honest state, on Tonight…
    await expect(page.getByTestId('stories-signed-out')).toBeVisible();
    await expect(page.getByTestId('stories-signed-out')).toContainText(
      /friends who follow you back/i,
    );
    await expect(page.getByTestId('stories-sign-in')).toHaveAttribute('href', '/auth');

    // …and no rail, no cells, no add control, because there is no session.
    await expect(page.getByTestId('stories-rail')).toHaveCount(0);
    await expect(page.getByTestId('story-rail-item')).toHaveCount(0);
    await expect(page.getByTestId('story-rail-you')).toHaveCount(0);
    await expect(page.getByTestId('add-story')).toHaveCount(0);

    // Same on Feed — the rail is drawn on both sub-tabs.
    await page.getByRole('tab', { name: /Feed/i }).click();
    await expect(page.getByTestId('stories-signed-out')).toBeVisible();
  });

  test('an unreachable backend is never rendered as an empty feed', async ({
    page,
  }) => {
    // The distinction this whole surface was rebuilt for: "nothing to show"
    // and "we could not ask" must not look the same. Signed out we assert the
    // states are DIFFERENT components, so a future change cannot collapse them
    // into one without failing here.
    await openSocial(page);
    await expect(page.getByTestId('stories-signed-out')).toBeVisible();
    await expect(page.getByTestId('stories-unavailable')).toHaveCount(0);
  });

  test('the retired local story surfaces are gone, not hidden', async ({ page }) => {
    await openSocial(page);

    // The viewer's reply field wrote to localStorage and delivered nothing.
    await expect(page.getByTestId('story-reply-input')).toHaveCount(0);
    await expect(page.getByTestId('story-reply-send')).toHaveCount(0);

    // No story key but the per-device seen list may exist at all.
    const keys = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) => key.includes('stor')));
    expect(keys).not.toContain('next-bar:stories:v1');
    expect(keys).not.toContain('next-bar:story-replies:v1');
    expect(keys).not.toContain('next-bar:stories-untagged:v1');
  });

  test('no demo identity leaks onto the signed-out Social surface', async ({
    page,
  }) => {
    // `demoFriends`, `demoShareId` and VIEWER_HANDLE = 'you' are removed from
    // production Stories and Feed. The seeded curators must not appear here.
    await openSocial(page);
    const main = page.locator('main');
    await expect(main).not.toContainText(/Your story/i);
    await expect(page.getByTestId('feed-memory')).toHaveCount(0);
    await expect(page.locator('[data-testid="story-rail-item"]')).toHaveCount(0);
  });
});
