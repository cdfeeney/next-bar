/**
 * want-to-go.spec.ts (QA5-S2)
 *
 * The "Want to go" list tab on /rankings, backed by the fixed cross-slice
 * localStorage contract `next-bar:list:want-to-go:v1` (JSON array of
 * { barId, addedAt }) that the parallel /discover slice also writes.
 *
 * What this covers:
 *   - Seeding the contract key shows the saved bars under the tab.
 *   - ✕ removes a row and rewrites storage.
 *   - Empty state renders with the /discover pointer.
 *   - "Been — rank it" deep-links the EXISTING /rankings?add=<barId>
 *     tier sheet; rating the bar auto-prunes it off the list.
 */

import { test, expect, type Page } from '@playwright/test';

const WANT_KEY = 'next-bar:list:want-to-go:v1';
const ATTABOY = { id: 'attaboy', name: 'Attaboy' };
const DEATH_AND_CO = { id: 'death-and-co', name: 'Death & Co' };

/** Reset storage, then seed the want-to-go contract key with `barIds`. */
async function seedWantToGo(page: Page, barIds: string[]): Promise<void> {
  await page.goto('/rankings');
  await page.evaluate(
    ({ key, ids }) => {
      window.localStorage.clear();
      // Re-ack the 21+ age gate (H1) — the config storageState seeded it,
      // and clearing storage must not resurface the overlay mid-test.
      window.localStorage.setItem('next-bar:age-ack:v1', '1');
      if (ids.length > 0) {
        window.localStorage.setItem(
          key,
          JSON.stringify(
            ids.map((barId) => ({
              barId,
              addedAt: new Date().toISOString(),
            })),
          ),
        );
      }
    },
    { key: WANT_KEY, ids: barIds },
  );
  await page.reload();
}

async function openWantTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Want to go' }).click();
}

test.describe('Want to go list on /rankings (QA5-S2)', () => {
  test('seeded bars show under the tab; ✕ removes the row and rewrites storage', async ({
    page,
  }) => {
    await seedWantToGo(page, [ATTABOY.id, DEATH_AND_CO.id]);
    await openWantTab(page);

    const list = page.getByTestId('want-to-go-list');
    await expect(list).toBeVisible();
    await expect(list).toContainText(ATTABOY.name);
    await expect(list).toContainText(DEATH_AND_CO.name);

    await page
      .getByRole('button', { name: `Remove ${ATTABOY.name} from Want to go` })
      .click();

    await expect(list).not.toContainText(ATTABOY.name);
    await expect(list).toContainText(DEATH_AND_CO.name);

    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      WANT_KEY,
    );
    const entries = JSON.parse(stored as string) as Array<{ barId: string }>;
    expect(entries.map((e) => e.barId)).toEqual([DEATH_AND_CO.id]);
  });

  // Re-pointed at /map (goal g-12d33864): /discover is archived, so the empty
  // state's forward path had to move or it would have sent users into a
  // redirect. The assertion is deliberately still on the href — an empty state
  // whose only CTA goes nowhere useful is the bug this test exists to catch.
  test('empty state renders with the /map pointer', async ({ page }) => {
    await seedWantToGo(page, []);
    await openWantTab(page);

    const empty = page.getByTestId('want-to-go-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('Nothing saved yet.');
    const cta = empty.getByRole('link', { name: /find bars to add/i });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/map');
  });

  test('"Been — rank it" opens the ?add tier sheet; rating auto-prunes the bar', async ({
    page,
  }) => {
    await seedWantToGo(page, [ATTABOY.id]);
    await openWantTab(page);

    // Full page load into the existing U2-3 deep-link flow.
    await page.getByRole('link', { name: /been — rank it/i }).click();
    await expect(page).toHaveURL(/\/rankings/);
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(`How was ${ATTABOY.name}?`);
    await sheet.getByRole('button', { name: /^Loved/ }).click();

    // The bar is now ranked…
    await expect(page.locator('article').first()).toContainText(ATTABOY.name);

    // …and the auto-prune dropped it from the want-to-go list.
    await openWantTab(page);
    await expect(page.getByTestId('want-to-go-empty')).toBeVisible();
    await expect.poll(async () => {
      const stored = await page.evaluate(
        (key) => window.localStorage.getItem(key),
        WANT_KEY,
      );
      return stored === null
        ? []
        : (JSON.parse(stored) as Array<{ barId: string }>).map((e) => e.barId);
    }).toEqual([]);
  });
});
