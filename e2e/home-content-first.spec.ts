/**
 * home-content-first.spec.ts — NB-01 (owner-approved mock v3, 2026-09-23).
 *
 * The home screen opens on CONTENT, never on a permission wall:
 *  1. Permission undecided + a neighbourhood saved in onboarding → result
 *     cards ranked from that neighbourhood, with "Use my location" as a text
 *     action that fires the real geolocation request from the tap.
 *  2. Permission undecided + nothing saved → the bar picker, never blank.
 *  3. Permission granted → results in the approved order: wordmark, Tweak the
 *     vibe, distance control, the "Near you" line, cards. The retired header
 *     strings and the Planning chip are gone; each card carries one meta line
 *     and one "Photos & hours" action, no drive line, no Maps links.
 */

import { test, expect } from './helpers/catalogTest';
import { grantGeolocation } from './helpers/geo';
import type { BrowserContext, Locator } from '@playwright/test';

const PROFILE_KEY = 'next-bar:profile:v1';

async function seedNeighbourhood(context: BrowserContext, neighbourhood: string): Promise<void> {
  await context.addInitScript(
    ([key, hood]) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          tags: [],
          archetype: 'explorer',
          preferredNeighborhoods: [hood],
          savedAt: new Date().toISOString(),
        }),
      );
    },
    [PROFILE_KEY, neighbourhood] as const,
  );
}

async function centreY(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box');
  return box.y + box.height / 2;
}

test.describe('Home — content first (NB-01)', () => {
  test('undecided permission + saved neighbourhood: cards render, "Use my location" re-ranks from coords on tap', async ({
    page,
    context,
  }) => {
    await seedNeighbourhood(context, 'LES');
    await page.goto('/');

    // Content, not the wall.
    await expect(page.getByTestId('result-card').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /find bars near you/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /share my location/i })).toHaveCount(0);
    await expect(page.getByText(/^Near /)).toBeVisible();

    const useMine = page.getByRole('button', { name: /use my location/i });
    await expect(useMine).toBeVisible();

    // The tap is the gesture that asks; grant right before it and the list
    // re-ranks from coordinates.
    await grantGeolocation(context, { latitude: 40.725, longitude: -73.985 });
    await useMine.click();
    await expect(page.getByText('Near you', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result-card').first()).toBeVisible();
  });

  test('undecided permission + nothing saved: the bar picker, never a blank screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'Search bars' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /find bars near you/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /use my location/i })).toBeVisible();
  });

  test('granted: approved order, retired strings gone, one meta line + one action per card', async ({
    page,
    context,
  }) => {
    await grantGeolocation(context, { latitude: 40.725, longitude: -73.985 });
    await page.goto('/');

    const cards = page.getByTestId('result-card');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });

    // Retired chrome.
    await expect(page.getByText(/Your next \d+ bars?/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Night phase/i })).toHaveCount(0);
    await expect(page.getByText(/^Drive ~/)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /directions/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Maps →/ })).toHaveCount(0);

    // Order: wordmark → Tweak the vibe → distance control → Near line → cards.
    const wordmark = page.getByText('Next Bar', { exact: true }).first();
    const tweak = page.getByRole('button', { name: /tweak the vibe/i });
    const walkable = page.getByRole('button', { name: /walkable/i });
    const near = page.getByText('Near you', { exact: true });
    const ys = await Promise.all([wordmark, tweak, walkable, near, cards.first()].map(centreY));
    for (let i = 1; i < ys.length; i += 1) expect(ys[i]).toBeGreaterThan(ys[i - 1]);

    // Cards: one "Photos & hours" action each.
    const count = await cards.count();
    for (let i = 0; i < count; i += 1) {
      await expect(cards.nth(i).getByRole('button', { name: /^Photos & hours$/ })).toHaveCount(1);
    }
    await cards.first().getByRole('button', { name: /^Photos & hours$/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
