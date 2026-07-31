import { expect, test } from '@playwright/test';

/**
 * Goal g-5ead112c: tapping a marker on /map opens the EXISTING BarLightbox,
 * not a second detail surface.
 *
 * Before this, a marker tap gave a two-line Leaflet popup (name + neighborhood)
 * and nothing else — no hours, no address, no way to act on the bar. The
 * lightbox already renders all of that and is already reviewed for dialog
 * semantics, focus handling and Google-media policy, so the change is wiring.
 *
 * The negative assertions matter as much as the positive ones (CLAUDE.md):
 * opening a detail overlay must not navigate, and closing it must not reset the
 * map the user had already positioned.
 */

async function openMap(page: import('@playwright/test').Page) {
  await page.goto('/map');
  await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Click a specific bar's marker.
 *
 * Not `.leaflet-marker-icon.first()` — with ~975 markers in a transformed pane,
 * the first one in DOM order is usually outside the viewport, and Playwright
 * cannot scroll a Leaflet pane into view the way it can a normal element, so
 * the click just times out. Search for the bar instead: that flies the map to
 * it, which puts its marker at the centre by construction.
 */
async function flyToBar(page: import('@playwright/test').Page, name: string) {
  // `type="search"` maps to role `searchbox`, not `textbox`.
  await page.getByRole('searchbox', { name: /Search bars/i }).fill(name);
  await page
    .getByRole('list', { name: /Matching bars/i })
    .getByRole('button', { name: new RegExp(name, 'i') })
    .click();
  // Let the fly animation settle so the marker really is under the centre.
  await page.waitForTimeout(1200);
}

/**
 * Tap the marker nearest the map centre (i.e. the one just flown to).
 *
 * Clicking blind at the container's centre point does NOT work: the icon is
 * anchored above its coordinate and the fly leaves sub-pixel offsets, so the
 * click lands on the tile layer and nothing happens. Find the actual marker
 * element closest to the centre and click that.
 */
async function tapCentreMarker(page: import('@playwright/test').Page) {
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

/** Fly to a bar, then tap its marker. */
async function tapBarMarker(page: import('@playwright/test').Page, name: string) {
  await flyToBar(page, name);
  await tapCentreMarker(page);
}

/** The map pane's transform — changes whenever the view moves. */
const paneTransform = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.leaflet-map-pane');
    return pane ? pane.style.transform : '';
  });

test.describe('/map marker opens the venue detail', () => {
  test('tapping a marker opens the lightbox with real venue detail', async ({ page }) => {
    await openMap(page);
    await tapBarMarker(page, 'Attaboy');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // The point of the change: detail a popup could never hold.
    await expect(dialog.getByRole('heading', { level: 2 })).toBeVisible();
    // Full weekly hours, not just "open now" — hours render client-side after
    // mount, so allow for that rather than asserting synchronously.
    await expect(dialog.getByRole('heading', { name: /^Hours$/i })).toBeVisible({
      timeout: 10_000,
    });
    // Both actions.
    await expect(dialog.getByRole('link', { name: /Rank it/i })).toBeVisible();
    await expect(dialog.getByRole('link', { name: /View on Maps/i })).toBeVisible();
  });

  test('opening a marker does NOT navigate, and closing does NOT reset the map', async ({
    page,
  }) => {
    await openMap(page);
    const before = page.url();

    // Fly FIRST, then record the view — the search fly is itself a map move, so
    // capturing the transform before it would compare two different views and
    // the assertion would be meaningless.
    await flyToBar(page, 'Attaboy');
    const viewBefore = await paneTransform(page);
    expect(viewBefore).not.toBe('');

    await tapCentreMarker(page);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });

    // NEGATIVE: a detail overlay is not a route.
    expect(page.url()).toBe(before);

    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // NEGATIVE: closing returns you to the map you had, not a re-fitted one.
    expect(page.url()).toBe(before);
    expect(await paneTransform(page)).toBe(viewBefore);
  });

  test('Escape closes it, and the page underneath scrolls again', async ({ page }) => {
    await openMap(page);
    await tapBarMarker(page, 'Attaboy');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });

    // The lightbox locks body scroll while open; releasing it is what lets the
    // map page work afterwards, and a leaked lock is invisible until you try.
    await expect
      .poll(async () => page.evaluate(() => document.body.style.overflow))
      .toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect
      .poll(async () => page.evaluate(() => document.body.style.overflow))
      .not.toBe('hidden');
  });
});
