/**
 * social-feed.spec.ts — Social · Feed, after the V8 Feed backend (migration
 * 0069).
 *
 * WHAT CHANGED, AND WHY THIS FILE NO LONGER SAYS "THE FEED ACTIONS ARE GONE".
 *
 * Cycle 1's Feed was seeded, and this spec asserted against invented rows. WP1
 * removed the seed and, with it, `Reply` and `View night` — Reply because it
 * wrote to `localStorage` and nothing ever delivered it, View night because it
 * pointed at a `demo-<handle>` share id no real night has. This file recorded
 * both as retired.
 *
 * They are NOT retired any more, and asserting that they are absent would now be
 * a test of a lie. WP5 gives both a real backend:
 *   - `Reply` opens `public.feed_comments`, the first visible comment surface in
 *     V8 (V8-R-FEED-003 / V8-R-FEED-005), whose write gate is the post's own
 *     read gate.
 *   - `View night` links to `/night-out/<share_token>` — a real night, and only
 *     when the DATABASE returned that night to this viewer (V8-R-FEED-004).
 * So the assertion is inverted where it must be, and kept where it still holds:
 * neither control may exist for a viewer with no session.
 *
 * WHAT THIS FILE CAN PROVE, AND WHAT IT CANNOT.
 *
 * A Feed post is never public (V8-R-FEED-006): "FEED IS NEVER PUBLIC. Its
 * audience is exactly one of: ALL MUTUAL FRIENDS, a NAMED MUTUAL-FRIEND GROUP,
 * or a CUSTOM MUTUAL-FRIEND SUBSET." An anonymous browser therefore has no
 * audience to be inside, and there is no signed-out Feed to assert card contents
 * against — by design, and the design is the requirement.
 *
 * So this spec proves the NEGATIVE half, which is the half that is actually
 * dangerous to get wrong: with no session, no post, no photo, no comment thread
 * and no reply control reaches the page. A leak here would be a public Feed.
 *
 * THE POSITIVE HALF — two identities, an authorised viewer, a refused one, the
 * mutual-friend intersection of a named group, and a comment visible to exactly
 * the post audience — needs a database and two accounts, exactly as
 * `src/lib/storiesRls.live.test.ts` does for stories. It is attended staging
 * verification and does not run in this gate. That is stated rather than
 * quietly dropped: an e2e file that cannot see the surface must say so.
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

  test('signed out, no Feed post reaches the page — the audience is never public', async ({
    page,
  }) => {
    await page.goto('/friends');
    await page.getByRole('tab', { name: /Feed/i }).click();

    // V8-R-FEED-006: a viewer outside the post audience must not read it, and an
    // anonymous viewer is outside every audience there is.
    await expect(page.getByTestId('feed-post')).toHaveCount(0);
    await expect(page.getByTestId('feed-post-photo')).toHaveCount(0);
    await expect(page.getByTestId('feed-post-author')).toHaveCount(0);
  });

  test('signed out, neither card action and no comment surface is offered', async ({
    page,
  }) => {
    await page.goto('/friends');
    await page.getByRole('tab', { name: /Feed/i }).click();

    // Both actions are real again — on a FEED POST, for a viewer the server
    // authorised. Neither may appear without one.
    await expect(page.getByTestId('feed-reply')).toHaveCount(0);
    await expect(page.getByTestId('feed-view-night')).toHaveCount(0);

    // V8-R-FEED-003's thread is visible to the post audience and nobody else, so
    // the composer must not exist here either. The right to comment is exactly
    // the right to view.
    await expect(page.getByTestId('feed-comments')).toHaveCount(0);
    await expect(page.getByTestId('feed-comment')).toHaveCount(0);
    await expect(page.getByTestId('feed-comment-input')).toHaveCount(0);
    await expect(page.getByTestId('feed-comment-submit')).toHaveCount(0);
    await expect(page.getByTestId('feed-comment-delete')).toHaveCount(0);
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
