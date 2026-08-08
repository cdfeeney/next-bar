/**
 * safe-area-top.spec.ts — Item 4 (goal g-cb7cefd2).
 *
 * App-owned chrome must clear the iOS status area. The prerequisite is real,
 * not assumed: `viewportFit: 'cover'` is set in src/app/layout.tsx, so
 * `env(safe-area-inset-top)` is actually populated on device.
 *
 * TESTING LIMITATION, stated rather than papered over. Chromium/WebKit device
 * emulation pins `env(safe-area-inset-*)` to 0, so the notched case cannot be
 * exercised live here — a bare `getBoundingClientRect().top >= inset` check
 * would compare against 0 and pass no matter what the CSS said. This repo
 * already hit that exact wall for the BOTTOM inset and settled on a convention
 * in e2e/cancel-bottomnav.spec.ts:175-196, hardened by its own santa review:
 *
 *   "Computed floors alone are satisfiable by STATIC padding ... so pin BOTH:
 *    the computed floor AND the env() formula's presence in the DOM."
 *
 * This spec follows that convention for the TOP inset rather than inventing a
 * second one. Everything that CAN be measured live still is: touch-target
 * sizes, horizontal-overflow negatives, reachability, and URL stability.
 */

import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';
import { installLoopbackFixtures } from './helpers/catalogFixture';

const SAFE_TOP = /env\(safe-area-inset-top\)/;

async function gotoHome(page: Page): Promise<void> {
  await denyGeolocation(page.context());
  await installLoopbackFixtures(page);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('next-bar:age-ack:v1', '1');
  });
  await page.reload();
}

/**
 * Criterion 7 asks for MEASURED geometry, not a class name.
 *
 * The honest measurement available under emulation is the offset between a
 * container's own top edge and the top edge of its first content child: that
 * gap IS the applied top padding, read back through
 * `getBoundingClientRect()` on both boxes. If the padding were removed the
 * gap collapses to 0 and this fails, which a class-name check alone would
 * not. It is paired with the env() presence check because emulation pins the
 * inset to 0 — together they pin "padding is really applied" AND "it still
 * responds to a real device inset".
 */
async function expectContentClearedFromTop(
  container: import('@playwright/test').Locator,
  firstContent: import('@playwright/test').Locator,
  minGapPx: number,
  where: string,
): Promise<void> {
  const outer = await container.boundingBox();
  const inner = await firstContent.boundingBox();
  expect(outer, `container box at ${where}`).not.toBeNull();
  expect(inner, `content box at ${where}`).not.toBeNull();
  const gap = inner!.y - outer!.y;
  expect(gap, `measured top clearance at ${where}`).toBeGreaterThanOrEqual(minGapPx);
}

/** No horizontal overflow anywhere on the document (criteria 5 / 9). */
async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const state = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollX: window.scrollX,
  }));
  expect(state.scrollWidth, `document overflow at ${where}`).toBe(state.clientWidth);
  expect(state.scrollX, `scrollX at ${where}`).toBe(0);
}


/**
 * BarLightbox is reachable from /map, not home.
 *
 * This mirrors `tapBarMarker` in e2e/map-lightbox.spec.ts rather than
 * inventing a shortcut, because the shortcut does not work: an earlier draft
 * here clicked the SEARCH RESULT, which only flies the map — it never opens
 * the lightbox, so every assertion below it failed on a missing dialog. Three
 * details are load-bearing and all three are that spec's hard-won findings:
 *   1. search-then-fly, because a blind marker click usually lands off-screen;
 *   2. wait for the fly to genuinely SETTLE (two identical pane transforms
 *      450ms apart), because a mid-animation marker can sit under the bottom
 *      nav where the click is intercepted;
 *   3. click the marker NEAREST THE CENTRE, because the icon is anchored above
 *      its coordinate and a centre-point click hits the tile layer instead.
 */
async function openLightboxFromMap(page: Page): Promise<void> {
  // Self-contained: the loopback catalog fixture is installed HERE rather
  // than relying on a caller having visited home first. An earlier draft
  // depended on that ordering, and when the home visit was removed the spec
  // silently fell back to the real catalog — it still passed, which is
  // exactly why it is worth pinning: a hermetic spec should not quietly
  // depend on production data containing a particular bar.
  await denyGeolocation(page.context());
  await installLoopbackFixtures(page);

  await page.goto('/map');
  await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('searchbox', { name: /Search bars/i }).fill('Attaboy');
  await page
    .getByRole('list', { name: /Matching bars/i })
    .getByRole('button', { name: /Attaboy/i })
    .click();

  let prev: string | null = null;
  await expect
    .poll(
      async () => {
        const cur = await page.evaluate(
          () => document.querySelector('.leaflet-map-pane')?.getAttribute('style') ?? '',
        );
        const settled = prev !== null && cur === prev;
        prev = cur;
        return settled;
      },
      { intervals: Array(20).fill(450), timeout: 15_000 },
    )
    .toBe(true);

  const idx = await page.evaluate(() => {
    const container = document.querySelector('.leaflet-container');
    if (!container) return -1;
    const c = container.getBoundingClientRect();
    const cx = c.x + c.width / 2;
    const cy = c.y + c.height / 2;
    const icons = Array.from(document.querySelectorAll('.leaflet-marker-icon'));
    let best = -1;
    let bestD = Infinity;
    icons.forEach((el, i) => {
      const b = el.getBoundingClientRect();
      const d = Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  });
  if (idx < 0) throw new Error('no marker found near the map centre');
  await page.locator('.leaflet-marker-icon').nth(idx).click();
}

test.describe('app-owned chrome respects the top safe area', () => {
  test('the home header owns its top-inset clearance', async ({ page }) => {
    await gotoHome(page);

    const header = page.locator('header').first();
    await expect(header).toBeVisible();

    // Both halves, per the convention above. The computed floor proves the
    // padding is actually applied; the formula proves it still RESPONDS to a
    // real device inset rather than being a static number that merely happens
    // to satisfy the floor.
    const padTop = await header.evaluate((el) => getComputedStyle(el).paddingTop);
    expect(parseFloat(padTop)).toBeGreaterThanOrEqual(16);
    await expect(header).toHaveClass(SAFE_TOP);

    // Criterion 7, measured: the wordmark is the header's first content
    // child, so the gap between the header box and the wordmark box IS the
    // applied clearance. Remove the padding and this collapses to 0.
    await expectContentClearedFromTop(
      header,
      header.getByText('Next Bar', { exact: true }),
      16,
      'home header',
    );

    await expectNoHorizontalOverflow(page, 'home with header');
  });

  test('the bar lightbox close control owns its top-inset clearance', async ({ page }) => {
    await openLightboxFromMap(page);

    // Captured AFTER the lightbox is open, on /map. An earlier draft captured
    // it on home and then navigated, so criterion 11 was comparing '/' against
    // '/map' and could never have held — the assertion has to be about what
    // OPENING AND CLOSING the overlay does to the URL, not about navigation.
    const urlBefore = page.url();

    const dialog = page.locator('div[role="dialog"]').first();
    await expect(dialog).toBeVisible();

    const close = dialog.getByRole('button', { name: 'Close' });
    await expect(close).toBeVisible();

    // The scrollable column owns the clearance for the control inside it.
    const column = close.locator('xpath=ancestor::div[contains(@class,"min-h-full")][1]');
    const padTop = await column.evaluate((el) => getComputedStyle(el).paddingTop);
    expect(parseFloat(padTop)).toBeGreaterThanOrEqual(24);
    await expect(column).toHaveClass(SAFE_TOP);

    // Criterion 7, measured: the column's first row is the one holding Close.
    await expectContentClearedFromTop(column, close, 24, 'lightbox column');

    // Criterion 8: the moved control is still a real touch target.
    const box = await close.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await expectNoHorizontalOverflow(page, 'lightbox open');

    // Criterion 11: repositioning changed no behavior and no URL.
    expect(page.url()).toBe(urlBefore);
    await close.click();
    await expect(dialog).toHaveCount(0);
    expect(page.url()).toBe(urlBefore);
    await expectNoHorizontalOverflow(page, 'lightbox closed');
  });

  /**
   * The add-a-bar modal (QuickAddBar) is the OTHER app-owned full-screen
   * dialog whose header row carries Close, so criterion 2 covers it just as
   * much as the lightbox. It was missed by the first pass — the fix had been
   * applied to home and the lightbox only, while this overlay and
   * TonightSuggestions kept a flat `pt-8` and would still have put Close
   * under the status bar.
   */
  test('the add-a-bar modal close control owns its top-inset clearance', async ({ page }) => {
    await denyGeolocation(page.context());
    await installLoopbackFixtures(page);
    await page.goto('/rankings');
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('next-bar:age-ack:v1', '1');
    });
    await page.reload();

    const trigger = page.getByRole('button', { name: '+ Add a bar' });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = page.locator('div[role="dialog"]').first();
    await expect(dialog).toBeVisible();
    const urlBefore = page.url();

    const close = dialog.getByRole('button', { name: 'Close' });
    await expect(close).toBeVisible();

    const column = close.locator('xpath=ancestor::div[contains(@class,"min-h-0")][1]');
    const padTop = await column.evaluate((el) => getComputedStyle(el).paddingTop);
    expect(parseFloat(padTop)).toBeGreaterThanOrEqual(32);
    await expect(column).toHaveClass(SAFE_TOP);
    await expectContentClearedFromTop(column, close, 32, 'add-a-bar column');

    // Criterion 8.
    const box = await close.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await expectNoHorizontalOverflow(page, 'add-a-bar open');

    // Criterion 11: closing changes state, not the URL.
    await close.click();
    await expect(dialog).toHaveCount(0);
    expect(page.url()).toBe(urlBefore);
    await expectNoHorizontalOverflow(page, 'add-a-bar closed');
  });

  /** Criterion 10: the primary action stays reachable on the short viewport. */
  test('the lightbox stays scrollable and its content reachable', async ({ page }) => {
    // No gotoHome() first: openLightboxFromMap is self-contained now, and
    // calling both re-registered the route fixtures and the geolocation
    // override on the SAME context. That double registration is what made
    // this the one test that timed out clicking the map marker on the
    // shortest viewport while its two siblings passed.
    await openLightboxFromMap(page);

    const dialog = page.locator('div[role="dialog"]').first();
    await expect(dialog).toBeVisible();

    // Criterion 10 is about a SPECIFIC primary action still being reachable,
    // so name one. The earlier version only set scrollTop programmatically
    // and accepted a 'no-overflow' escape, which stayed green even if the
    // action had vanished entirely — it proved scrollability, not
    // reachability.
    const primary = dialog.getByRole('link', { name: /View on Maps/i });
    await expect(primary).toHaveCount(1);

    // Bring it into view the way a user would — scrolling the dialog, not the
    // element's own programmatic offset — then assert it is actually in the
    // viewport and hittable.
    await primary.scrollIntoViewIfNeeded();
    await expect(primary).toBeInViewport();
    await expect(primary).toBeEnabled();

    const box = await primary.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    const viewport = page.viewportSize();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);

    await expectNoHorizontalOverflow(page, 'lightbox scrolled');
  });
});
