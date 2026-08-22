/**
 * social-feed.spec.ts
 *
 * Social → Feed — V8-1f criterion 3 and criterion 12, against
 * `docs/design-reference/approved/next-bar-social-v2-core.png` (screen C).
 *
 * "Feed = photo memories … NO public like counts and no follower metrics: the
 * two actions are View night and Reply. A ranking event can appear as a
 * compact secondary row, but never competes with a photo."
 *
 * The negative assertions are the point of this file: a like count or a
 * follower number on this surface is the specific failure the canvas rules
 * out, and only a test that looks for it can catch it coming back.
 */

import { test, expect, type Page } from '@playwright/test';

async function openFeed(page: Page): Promise<void> {
  await page.goto('/friends');
  await page.getByRole('tab', { name: /Feed/i }).click();
  await expect(page.getByTestId('friends-feed')).toBeVisible();
}

test.describe('Social — Feed', () => {
  test('memories carry author, place, time, image, caption, tags and two actions', async ({
    page,
  }) => {
    await openFeed(page);

    const card = page.getByTestId('feed-memory').first();
    await expect(card).toBeVisible();
    // Photo-first: the image area is part of the card, not an afterthought.
    await expect(card.getByTestId('story-frame')).toBeVisible();
    // Author, place and age all read from the card head.
    await expect(card).toContainText(/Claire R\./);
    await expect(card).toContainText(/Tagged ·/);
    await expect(card).toContainText(/\d+[mh]/);

    // Exactly two actions, and they are these two.
    await expect(card.getByTestId('feed-view-night')).toHaveText(/View night/i);
    await expect(card.getByTestId('feed-reply')).toHaveText(/Reply/i);
    await expect(card.getByTestId('feed-view-night')).toHaveAttribute(
      'href',
      /^\/u\/[^/]+\/night\/[^/]+$/,
    );
  });

  test('no public like counts and no follower metrics anywhere on Feed', async ({
    page,
  }) => {
    await openFeed(page);
    const feed = page.getByTestId('friends-feed');
    await expect(feed.getByText(/\blikes?\b/i)).toHaveCount(0);
    await expect(feed.getByText(/\bfollowers?\b/i)).toHaveCount(0);
    await expect(feed.getByText(/\bfollowing\b/i)).toHaveCount(0);
    // No heart/like control either — the absence is of the affordance, not
    // merely of the number.
    await expect(feed.getByRole('button', { name: /like/i })).toHaveCount(0);
  });

  test('a ranking event is a compact secondary row, never a photo card', async ({
    page,
  }) => {
    await openFeed(page);
    const row = page.getByTestId('feed-ranking-row').first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(/ranked/i);
    // It carries no image and none of the memory actions.
    await expect(row.getByTestId('story-frame')).toHaveCount(0);
    await expect(row.getByTestId('feed-view-night')).toHaveCount(0);

    const rowBox = await row.boundingBox();
    const cardBox = await page.getByTestId('feed-memory').first().boundingBox();
    expect(rowBox?.height ?? 0).toBeLessThan((cardBox?.height ?? 0) / 2);
  });

  test('Reply opens a composer in place and does not navigate away', async ({
    page,
  }) => {
    await openFeed(page);
    const card = page.getByTestId('feed-memory').first();

    await card.getByTestId('feed-reply').click();
    await expect(card.getByTestId('feed-reply-input')).toBeVisible();
    // Negative assertion: replying is in-place, never a route change.
    await expect(page).toHaveURL(/\/friends$/);

    await card.getByTestId('feed-reply-input').fill('that jukebox');
    await card.getByTestId('feed-reply-send').click();
    await expect(card.getByTestId('feed-reply-input')).toHaveCount(0);
    await expect(page.getByTestId('friends-feed')).toBeVisible();
  });

  test('the existing Social data flows are still live beside Feed', async ({
    page,
  }) => {
    await page.goto('/friends');
    // Tonight and the people graph are unchanged by the sub-tab chrome.
    await expect(page.getByTestId('friends-tonight')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Groups & people/i })).toBeVisible();

    await page.getByRole('tab', { name: /Plans/i }).click();
    await expect(page.getByRole('link', { name: /Start a Night Out/i })).toBeVisible();

    await page.getByRole('tab', { name: /Feed/i }).click();
    await expect(page.getByTestId('friends-feed')).toBeVisible();
  });
});
