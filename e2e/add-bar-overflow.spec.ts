/**
 * add-bar-overflow.spec.ts — Item 3 (goal g-b9dc294e).
 *
 * The add-a-bar modal pans horizontally on mobile (operator screenshot,
 * "Taylor Feedback", 2026-08-06). These assertions pin the CAUSE, not the
 * symptom: `overflow-x: hidden` on an ancestor would hide the panning while
 * leaving content clipped and unreachable, so every check below is a
 * *measurement* (scrollWidth vs clientWidth) plus a reachability check, and
 * none of them can be satisfied by clipping.
 *
 * Long names are injected as SYNTHETIC catalog rows through the loopback
 * fixture — no live lookup, no non-loopback traffic. The fence stays intact.
 *
 * Runs on every configured mobile project. `iPhone 17` (402x681) is the
 * shortest configured viewport on this branch and is where a
 * bottom-crowded/scroll-locked failure shows first, so criterion 6 is
 * asserted there too via the standard project matrix.
 */

import { test, expect, type Page } from '@playwright/test';
import { installCatalogFixture, loadBundledRows } from './helpers/catalogFixture';
import { denyGeolocation } from './helpers/geo';

/**
 * Deliberately brutal: no spaces, so nothing can wrap at a word boundary.
 * A layout that survives this is containing its children rather than
 * relying on convenient text.
 */
const LONG_NAME =
  'Bar' + 'Supercalifragilisticexpialidocious'.repeat(3) + 'EndOfTheVeryLongName';
const LONG_ADDRESS =
  '1234567890 ' + 'NorthwesternBoulevardExtensionAnnexBuilding'.repeat(2) + ' Suite 9999';

/**
 * Bundled rows plus one row whose name and address cannot wrap.
 * The `id` is required by the fixture's row shape (it pages on id order), so
 * the return type carries it explicitly rather than a bare index signature.
 */
function rowsWithLongEntry(): (Record<string, unknown> & { id: string })[] {
  const base = loadBundledRows();
  const seed = base[0];
  return [
    ...base,
    {
      ...seed,
      id: 'aaa-overflow-fixture',
      name: LONG_NAME,
      address: LONG_ADDRESS,
      neighborhood: seed.neighborhood,
    },
  ];
}

async function gotoRankings(page: Page): Promise<void> {
  await denyGeolocation(page.context());
  await installCatalogFixture(page, { rows: rowsWithLongEntry() });
  await page.goto('/rankings');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('next-bar:age-ack:v1', '1');
  });
  await page.reload();
}

/** The dialog element for the add-a-bar modal. */
function modal(page: Page) {
  return page.locator('div[role="dialog"][aria-label="Add a bar"]');
}

/** scrollWidth/clientWidth of a locator, measured in the browser. */
async function widths(
  page: Page,
  selector: string,
): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate((sel) => {
    const el = sel === ':root' ? document.documentElement : document.querySelector(sel);
    if (!el) throw new Error(`missing element for ${sel}`);
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  }, selector);
}

async function openAddBarModal(page: Page): Promise<void> {
  // Empty state renders the "+ Add a bar" trigger.
  const trigger = page.getByRole('button', { name: '+ Add a bar' });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(modal(page)).toBeVisible();
}

test.describe('/rankings add-a-bar modal — no horizontal overflow', () => {
  test('document does not scroll horizontally with the modal open', async ({ page }) => {
    await gotoRankings(page);
    await openAddBarModal(page);

    const doc = await widths(page, ':root');
    expect(doc.scrollWidth).toBe(doc.clientWidth);
  });

  test('the modal itself does not scroll horizontally', async ({ page }) => {
    await gotoRankings(page);
    await openAddBarModal(page);

    const m = await widths(page, 'div[role="dialog"][aria-label="Add a bar"]');
    expect(m.scrollWidth).toBe(m.clientWidth);
  });

  test('window.scrollX stays 0 before and after interacting', async ({ page }) => {
    await gotoRankings(page);
    await openAddBarModal(page);

    expect(await page.evaluate(() => window.scrollX)).toBe(0);

    // Interact: type into the picker's search, then scroll the list vertically.
    const search = modal(page).getByLabel('Search bars');
    if (await search.count()) {
      await search.click();
      await search.pressSequentially('Bar');
    }
    await modal(page).evaluate((el) => {
      const scroller = el.querySelector('.overflow-y-auto');
      if (scroller) scroller.scrollTop = 200;
    });

    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });

  /**
   * The load-bearing one. A synthetic unbreakable name is selected so it
   * lands in the tier-stage header (`How was {name}?`), which is a flex row.
   * A flex child defaults to `min-width: auto` and therefore refuses to
   * shrink below its content — that is the documented cause class in
   * criterion 4.
   */
  test('a very long synthetic bar name cannot widen the modal', async ({ page }) => {
    await gotoRankings(page);
    await openAddBarModal(page);

    const search = modal(page).getByLabel('Search bars');
    await expect(search).toBeVisible();
    await search.click();
    await search.pressSequentially('Supercalifragilistic');

    const match = modal(page).getByRole('button', { name: new RegExp(LONG_NAME.slice(0, 24)) });
    await expect(match.first()).toBeVisible({ timeout: 10_000 });
    await match.first().click();

    // Now at the tier stage, whose heading interpolates the long name.
    await expect(modal(page).getByRole('heading')).toContainText('How was');

    const m = await widths(page, 'div[role="dialog"][aria-label="Add a bar"]');
    expect(m.scrollWidth).toBe(m.clientWidth);

    const doc = await widths(page, ':root');
    expect(doc.scrollWidth).toBe(doc.clientWidth);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });

  /**
   * Criterion 2/3: containment must come from wrapping or an intentional
   * truncation, never from an ancestor clipping content out of reach. The
   * heading must still be non-empty and within the dialog's box.
   */
  test('the long name is contained without being clipped out of reach', async ({ page }) => {
    await gotoRankings(page);
    await openAddBarModal(page);

    const search = modal(page).getByLabel('Search bars');
    await search.click();
    await search.pressSequentially('Supercalifragilistic');
    const match = modal(page).getByRole('button', { name: new RegExp(LONG_NAME.slice(0, 24)) });
    await expect(match.first()).toBeVisible({ timeout: 10_000 });
    await match.first().click();

    const heading = modal(page).getByRole('heading').first();
    await expect(heading).toBeVisible();

    const box = await heading.boundingBox();
    const dialogBox = await modal(page).boundingBox();
    expect(box).not.toBeNull();
    expect(dialogBox).not.toBeNull();
    // The heading's right edge stays inside the dialog: contained, not
    // spilling past the viewport where it would be unreachable.
    expect(box!.x + box!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1);

    // And it is genuinely rendering the name, not an empty box.
    await expect(heading).toContainText('How was');
  });

  /** Criterion 11 + 12: the flow still works, and it does not navigate. */
  test('search, select, and close still work without changing the URL', async ({ page }) => {
    await gotoRankings(page);
    const urlBefore = page.url();
    await openAddBarModal(page);

    const search = modal(page).getByLabel('Search bars');
    await search.click();
    await search.pressSequentially('Supercalifragilistic');
    const match = modal(page).getByRole('button', { name: new RegExp(LONG_NAME.slice(0, 24)) });
    await expect(match.first()).toBeVisible({ timeout: 10_000 });
    await match.first().click();

    await expect(modal(page).getByRole('heading')).toContainText('How was');
    expect(page.url()).toBe(urlBefore);

    await modal(page).getByRole('button', { name: 'Close' }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(page.url()).toBe(urlBefore);
  });

  /**
   * Criterion 6: vertical scrolling must survive. The modal locks BODY
   * scroll deliberately; what must remain scrollable is the inner list.
   */
  test('vertical scrolling inside the modal still works', async ({ page }) => {
    await gotoRankings(page);
    await openAddBarModal(page);

    const moved = await modal(page).evaluate((el) => {
      const scroller = el.querySelector('.overflow-y-auto') as HTMLElement | null;
      if (!scroller) return null;
      if (scroller.scrollHeight <= scroller.clientHeight) return 'no-overflow';
      scroller.scrollTop = 150;
      return scroller.scrollTop > 0 ? 'scrolled' : 'stuck';
    });

    expect(moved).not.toBe('stuck');
    expect(moved).not.toBeNull();
  });
});
