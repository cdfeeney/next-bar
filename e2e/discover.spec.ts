/**
 * discover.spec.ts — /discover swipe surface (QA5-S3).
 *
 * Covers the button (accessible) path, which shares the exact commit
 * handlers with the pointer-drag path:
 *   - stack renders a card with a heading,
 *   - Save writes { barId, addedAt } into next-bar:list:want-to-go:v1
 *     and advances to the next card,
 *   - Skip advances WITHOUT writing (session-only),
 *   - a saved bar stays gone across a reload.
 */

import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

const WANT_TO_GO_KEY = 'next-bar:list:want-to-go:v1';

type WantToGoEntry = { barId: string; addedAt: string };

async function readWantToGo(page: Page): Promise<WantToGoEntry[] | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { barId: string; addedAt: string }[]) : null;
  }, WANT_TO_GO_KEY);
}

/** The current top card's bar id + displayed name. */
async function topCard(page: Page): Promise<{ id: string; name: string }> {
  const card = page.getByTestId('discover-card');
  await expect(card).toBeVisible({ timeout: 15_000 });
  const id = await card.getAttribute('data-bar-id');
  const name = await page.getByTestId('discover-card-heading').innerText();
  expect(id).toBeTruthy();
  return { id: id as string, name: name.trim() };
}

test.describe('/discover swipe surface', () => {
  test.beforeEach(async ({ context }) => {
    // Deterministic: no geo prompt/fix — the pool is browse-order anyway.
    await denyGeolocation(context);
  });

  test('renders a card stack with a heading', async ({ page }) => {
    await page.goto('/discover');
    await expect(page.getByRole('heading', { name: /^Discover$/ })).toBeVisible();
    const { name } = await topCard(page);
    expect(name.length).toBeGreaterThan(0);
    // Both action buttons are present and labelled for this bar.
    await expect(page.getByRole('button', { name: `Save ${name}` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Skip ${name}` })).toBeVisible();
  });

  test('Save writes the bar into want-to-go and advances', async ({ page }) => {
    await page.goto('/discover');
    const first = await topCard(page);

    await page.getByRole('button', { name: `Save ${first.name}` }).click();

    // Storage contract: JSON array of { barId, addedAt } under the fixed key.
    const entries = await readWantToGo(page);
    expect(entries).not.toBeNull();
    expect(entries).toHaveLength(1);
    expect(entries![0].barId).toBe(first.id);
    expect(typeof entries![0].addedAt).toBe('string');
    expect(Number.isNaN(Date.parse(entries![0].addedAt))).toBe(false);

    // Advanced: a new bar is on top.
    const second = await topCard(page);
    expect(second.id).not.toBe(first.id);
  });

  test('Skip advances without writing', async ({ page }) => {
    await page.goto('/discover');
    const first = await topCard(page);

    await page.getByRole('button', { name: `Skip ${first.name}` }).click();

    const second = await topCard(page);
    expect(second.id).not.toBe(first.id);
    // Session-only: nothing lands in the want-to-go key.
    expect(await readWantToGo(page)).toBeNull();
  });

  test('a saved bar does not come back after reload', async ({ page }) => {
    await page.goto('/discover');
    const first = await topCard(page);
    await page.getByRole('button', { name: `Save ${first.name}` }).click();
    await topCard(page); // wait for the advance before reloading

    await page.reload();

    const afterReload = await topCard(page);
    expect(afterReload.id).not.toBe(first.id);
    // The write survived the reload too.
    const entries = await readWantToGo(page);
    expect(entries).toHaveLength(1);
    expect(entries![0].barId).toBe(first.id);
  });
});
