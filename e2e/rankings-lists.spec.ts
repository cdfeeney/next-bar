/**
 * rankings-lists.spec.ts (goal g-ac3a291c)
 *
 * The Rankings Lists switcher: Best Bars is the default personal ranking,
 * the crowded rating-filter chip row is gone, Want to go and every named
 * list swap in via the top-right switcher, legacy Want-to-go data folds
 * into the Lists model losslessly, sharing is text-only (device-local
 * lists must never get a fake public URL), and the rating sheet offers
 * multi-list checkmarks.
 */

import { test, expect, type Page } from '@playwright/test';

const LEGACY_WANT_KEY = 'next-bar:list:want-to-go:v1';
const LISTS_KEY = 'next-bar:lists:v1';

const openSwitcher = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: /Lists — showing/ }).click();
};

async function readLists(
  page: Page,
): Promise<Array<{ id: string; name: string; barIds: string[] }>> {
  return page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('next-bar:lists:v1');
      return raw ? (JSON.parse(raw) as never) : [];
    } catch {
      return [];
    }
  });
}

test.describe('Rankings Lists switcher (g-ac3a291c)', () => {
  test('Best Bars is the default view and the old filter chip row is gone', async ({
    page,
  }) => {
    await page.goto('/rankings');
    await expect(
      page.getByRole('button', { name: 'Lists — showing Best Bars' }),
    ).toBeVisible();
    // NEGATIVE (crit 1): the crowded tier-filter chips are gone for good.
    await expect(page.getByRole('group', { name: 'Filter by rating' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Loved', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveCount(0);
  });

  test('legacy Want-to-go storage folds into the Lists model without losing saves (crit 4/10)', async ({
    page,
  }) => {
    await page.goto('/rankings');
    await page.evaluate(
      ({ key }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify([
            { barId: 'attaboy', addedAt: '2026-07-01T00:00:00.000Z' },
            { barId: 'death-and-co', addedAt: '2026-07-02T00:00:00.000Z' },
          ]),
        );
      },
      { key: LEGACY_WANT_KEY },
    );
    await page.reload();
    await openSwitcher(page);
    await page.getByRole('button', { name: 'Want to go', exact: true }).click();
    const list = page.getByTestId('want-to-go-list');
    await expect(list).toContainText('Attaboy');
    await expect(list).toContainText('Death & Co');
    // The fold is complete: saves live in the lists model, legacy key gone.
    const lists = await readLists(page);
    const wtg = lists.find((l) => l.id === 'want-to-go');
    expect(wtg?.barIds).toEqual(['attaboy', 'death-and-co']);
    expect(
      await page.evaluate((k) => window.localStorage.getItem(k), LEGACY_WANT_KEY),
    ).toBeNull();
  });

  test('a named list appears in the switcher, renders its bars, and removal works (crit 5)', async ({
    page,
  }) => {
    // Create the list through the real /lists flow. Retry the fill+create:
    // typing before hydration lets React reset the controlled input (the
    // documented dev race) — once hydration is done, one pass sticks.
    await page.goto('/lists');
    await expect(async () => {
      await page.getByLabel('New list name').fill('Date bars');
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(
        page.getByRole('button', { name: '+ Add a bar' }),
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByRole('button', { name: '+ Add a bar' }).click();
    const picker = page.getByPlaceholder(/search/i).first();
    await picker.fill('Attaboy');
    await page.locator('li button').filter({ hasText: 'Attaboy' }).first().click();
    await page.getByRole('button', { name: 'Done' }).click();

    await page.goto('/rankings');
    await openSwitcher(page);
    await page.getByRole('button', { name: 'Date bars' }).click();
    const panel = page.getByTestId('named-list-panel');
    await expect(panel).toContainText('Attaboy');

    await panel
      .getByRole('button', { name: 'Remove Attaboy from Date bars' })
      .click();
    await expect(panel).not.toContainText('Attaboy');
    await expect(panel).toContainText('empty so far');
  });

  test('list sharing is text-only: clipboard payload carries the bars and NO URL (crit 7/8)', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are chromium-only in Playwright');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/rankings');
    await page.evaluate(
      ({ key }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify([
            {
              id: 'want-to-go',
              name: 'Want to go',
              barIds: ['attaboy'],
              createdAt: '2026-07-01T00:00:00.000Z',
              updatedAt: '2026-07-01T00:00:00.000Z',
            },
          ]),
        );
      },
      { key: LISTS_KEY },
    );
    await page.reload();
    await openSwitcher(page);
    await page.getByRole('button', { name: 'Want to go', exact: true }).click();
    await page.getByRole('button', { name: 'Share the list Want to go as text' }).click();
    // In headless chromium navigator.share is absent → clipboard fallback.
    await expect(page.getByRole('button', { name: 'Copied to clipboard' })).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('Want to go');
    expect(clip).toContain('Attaboy');
    // THE crit-8 pin: no URL of any kind rides along with device-only data.
    expect(clip).not.toMatch(/https?:\/\//);
    // The surface says so too (crit 11).
    await expect(
      page.getByText(/Lists stay on this device — sharing sends text, not a link/),
    ).toBeVisible();
  });

  test('rating sheet offers multi-list checkmarks that persist membership (crit 6)', async ({
    page,
  }) => {
    // A named list exists up front.
    await page.goto('/rankings');
    await page.evaluate(
      ({ key }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify([
            {
              id: 'list-rooftops',
              name: 'Rooftops',
              barIds: [],
              createdAt: '2026-07-01T00:00:00.000Z',
              updatedAt: '2026-07-01T00:00:00.000Z',
            },
          ]),
        );
      },
      { key: LISTS_KEY },
    );
    await page.reload();

    // Open the tier sheet for a bar via the quick-add deep link.
    await page.goto('/rankings?add=westlight');
    const dialog = page.getByRole('dialog', { name: 'Add a bar' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Also on your lists');

    const chip = dialog.getByRole('button', { name: 'Add Westlight to Rooftops' });
    await chip.click();
    await expect(
      dialog.getByRole('button', { name: 'Remove Westlight from Rooftops' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // Membership persisted immediately — independent of completing the tier.
    const lists = await readLists(page);
    expect(lists.find((l) => l.id === 'list-rooftops')?.barIds).toEqual([
      'westlight',
    ]);

    // Completing the rating still works with the checkmark in place.
    await dialog.getByRole('button', { name: 'Loved' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('deleting the viewed list falls back to Best Bars instead of a blank screen', async ({
    page,
  }) => {
    await page.goto('/rankings');
    await page.evaluate(
      ({ key }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify([
            {
              id: 'list-x',
              name: 'Ephemeral',
              barIds: [],
              createdAt: '2026-07-01T00:00:00.000Z',
              updatedAt: '2026-07-01T00:00:00.000Z',
            },
          ]),
        );
      },
      { key: LISTS_KEY },
    );
    await page.reload();
    await openSwitcher(page);
    await page.getByRole('button', { name: 'Ephemeral' }).click();
    await expect(page.getByTestId('named-list-panel')).toBeVisible();

    // Delete it out from under the view (same-tab storage event).
    await page.evaluate((key) => {
      window.localStorage.setItem(key, JSON.stringify([]));
      window.dispatchEvent(new StorageEvent('storage', { key }));
    }, LISTS_KEY);
    await expect(
      page.getByRole('button', { name: 'Lists — showing Best Bars' }),
    ).toBeVisible();
  });
});
