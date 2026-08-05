/**
 * rankings-header.spec.ts (operator 2026-08-03)
 *
 * Pins for the reworked /rankings header and empty state:
 *   - Title is "Bar Rankings" — no "Your nights, ranked" eyebrow, no
 *     description paragraph, no "Your lists →" / "Search bars →" links.
 *   - The Lists switcher sits IN FLOW and never overlaps the title (the
 *     old absolute pill overlapped header text on mobile).
 *   - Empty state is heading + "+ Add a bar" ONLY — the "Find a bar →"
 *     link, the sample-night seeder, and the explainer prose are gone.
 *   - Non-empty state hosts the inline search-to-rank bar: type, pick a
 *     match, tier sheet opens IN PLACE (no navigation — negative pin).
 */

import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

async function clearStorage(page: Page): Promise<void> {
  await denyGeolocation(page.context());
  // Clear on /rankings itself — never leave the route (see
  // rankings-add-flow.spec.ts for the navigation-race rationale).
  await page.goto('/rankings');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem('next-bar:age-ack:v1', '1');
  });
  await page.reload();
}

test.describe('/rankings header + empty state (operator 2026-08-03)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
  });

  test('title is "Bar Rankings"; old copy and links are gone; empty state is add-only', async ({
    page,
  }) => {
    await expect(
      page.getByRole('heading', { name: /^Bar Rankings$/ }),
    ).toBeVisible();

    // NEGATIVE pins — the removed header furniture stays removed.
    await expect(page.getByText('Your nights, ranked')).toHaveCount(0);
    await expect(
      page.getByText(/ordered by your personal 0–10 score/),
    ).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Search bars →' }),
    ).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Your lists →' })).toHaveCount(0);

    // Empty state: heading + the ONE action, nothing else.
    await expect(page.getByText('Nothing here yet.')).toBeVisible();
    await expect(
      page.getByRole('button', { name: '+ Add a bar' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Find a bar/ })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /load a sample night/i }),
    ).toHaveCount(0);
    await expect(
      page.getByText(/Rate a bar after you check it out/),
    ).toHaveCount(0);
    // No inline search in the empty state — the button is the one entry.
    await expect(
      page.getByRole('searchbox', { name: 'Search bars' }),
    ).toHaveCount(0);
  });

  test('the Lists switcher never overlaps the title (mobile regression)', async ({
    page,
  }) => {
    const title = page.getByRole('heading', { name: /^Bar Rankings$/ });
    const switcher = page.getByRole('button', { name: /Lists — showing/ });
    await expect(title).toBeVisible();
    await expect(switcher).toBeVisible();

    const t = await title.boundingBox();
    const s = await switcher.boundingBox();
    expect(t).not.toBeNull();
    expect(s).not.toBeNull();
    if (!t || !s) return;
    const intersects = !(
      t.x + t.width <= s.x ||
      s.x + s.width <= t.x ||
      t.y + t.height <= s.y ||
      s.y + s.height <= t.y
    );
    expect(intersects).toBe(false);
  });

  test('inline search ranks a bar in place — no navigation, input clears on pick', async ({
    page,
  }) => {
    // Seed ONE rating via the existing deep link so the header search
    // mounts (first bar → no comparison prompt).
    await page.goto('/rankings?add=attaboy');
    const seedSheet = page.getByRole('dialog', { name: 'Add a bar' });
    await expect(seedSheet).toContainText('How was Attaboy?');
    await seedSheet.getByRole('button', { name: /^Loved/ }).click();
    await expect(seedSheet).not.toBeVisible();

    const search = page.getByRole('searchbox', { name: 'Search bars' });
    await expect(search).toBeVisible();
    const urlBefore = page.url();

    // Under 2 characters → NO dropdown (negative).
    await search.click();
    await search.pressSequentially('d');
    await expect(
      page.getByRole('list', { name: 'Matching bars' }),
    ).toHaveCount(0);

    await search.pressSequentially('eath');
    const matches = page.getByRole('list', { name: 'Matching bars' });
    await expect(matches).toBeVisible();
    await matches
      .getByRole('button')
      .filter({ hasText: 'Death & Co' })
      .first()
      .click();

    // Tier sheet opens IN PLACE for the picked bar…
    await expect(
      page.getByRole('dialog', { name: 'Add a bar' }),
    ).toContainText('How was Death & Co?');
    // …the URL did not change (negative — this is not a navigation)…
    expect(page.url()).toBe(urlBefore);
    // …and the input reset for the next search.
    await expect(search).toHaveValue('');
  });
});
