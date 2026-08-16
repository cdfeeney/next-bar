/**
 * map-interaction.spec.ts
 *
 * Behavioral coverage for /map under the LOCKED V8 design
 * (`docs/design-reference/approved/next-bar-map-v1.png`):
 *  1. Map-first hierarchy — the map is the page: no heading, no quiz prompt,
 *     no page scroll before it.
 *  2. Search, Filters and Locate float over the map.
 *  3. Two marker meanings only: Ranked ring + muted "other" dot. There is no
 *     suggested tier — Next Bar? owns the guided decision, the map does not
 *     recommend.
 *  4. Filter choices stay a draft until "Show N bars".
 *  5. Single-finger drag pans; geolocation states still explain themselves.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/catalogTest';

async function gotoLoadedMap(page: Page): Promise<void> {
  await page.goto('/map');
  await expect(page.getByText(/Loading the Manhattan catalog/)).toHaveCount(0);
}

/**
 * Seeds a saved vibe-quiz profile before the app boots. Under the locked design
 * this must change NOTHING on the map — kept precisely so "a profile silently
 * reintroduces a recommendation tier" fails here.
 */
const SEED_PROFILE_SCRIPT = () => {
  window.localStorage.setItem(
    'next-bar:profile:v1',
    JSON.stringify({
      tags: ['dive', 'chill', 'cheap'],
      archetype: 'e2e-seeded',
      preferredNeighborhoods: [],
      savedAt: new Date().toISOString(),
    }),
  );
};

// NYC — inside the curated bar region, so a fix lands among the markers.
const NYC = { latitude: 40.725, longitude: -73.985, accuracy: 20 };
// A rough fix far from any curated neighborhood → classifies as granted_coarse
// (accuracy > 200m and no neighborhood snap), where coords resolve to null.
const COARSE_FAR = { latitude: 51.5074, longitude: -0.1278, accuracy: 3000 };

test.describe('/map interaction', () => {
  test('renders bar markers', async ({ page }) => {
    await gotoLoadedMap(page);
    // Leaflet attribution confirms the map booted.
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });
    const markers = page.locator('.leaflet-marker-icon');
    await expect(markers.first()).toBeVisible({ timeout: 15_000 });
    expect(await markers.count()).toBeGreaterThan(0);
  });

  test('map-first hierarchy: the map IS the page, with no heading or quiz prompt', async ({
    page,
  }) => {
    await gotoLoadedMap(page);
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });

    // Reference note 1. These are the four things the pre-lock surface put
    // ABOVE the map; each one reintroduces the recommendation hierarchy.
    await expect(page.getByRole('heading', { name: /^Find Bar$/ })).toHaveCount(0);
    await expect(page.getByTestId('map-quiz-hint')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Discover/ })).toHaveCount(0);

    // The map fills the viewport rather than sitting in a boxed card below a
    // header — assert geometry, since "no heading" alone would still pass for a
    // small map floating in whitespace.
    const surface = page.getByTestId('map-surface');
    await expect(surface).toBeVisible();
    const viewport = page.viewportSize()!;
    const box = await surface.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect(box!.height).toBeGreaterThanOrEqual(viewport.height - 1);

    // Note 1 again: nothing scrolls before the map.
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight + 1,
    );
    expect(scrollable, '/map scrolls, but the locked design has no page scroll').toBe(
      false,
    );
  });

  test('search, Filters and Locate float over the map', async ({ page }) => {
    await gotoLoadedMap(page);
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });

    // Reference note 2 — all three are overlays, so each must sit within the
    // map's own bounds rather than in a stacked block above it.
    const surface = await page.getByTestId('map-surface').boundingBox();
    for (const control of [
      page.getByRole('searchbox', { name: /Search bars/i }),
      page.getByRole('button', { name: /^Filters/ }),
      page.getByRole('button', { name: /^Locate$/ }),
    ]) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(surface!.y - 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(
        surface!.y + surface!.height + 1,
      );
      // Criterion 9: real 44px targets.
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('single-finger pan is enabled (no gesture-handling lock) and pans', async ({
    page,
    browserName,
  }) => {
    await gotoLoadedMap(page);
    const container = page.locator('.leaflet-container');
    await expect(container).toBeVisible({ timeout: 15_000 });

    // Gesture-handling (two-finger lock) must be OFF on the full map view.
    await expect(container).not.toHaveClass(/leaflet-gesture-handling/);

    const pane = page.locator('.leaflet-map-pane');
    const before = await pane.evaluate((el) => getComputedStyle(el).transform);
    // Night-loop N1: the pan-MOTION assertion is Chromium-only. On the
    // iPhone-13 project (WebKit + hasTouch) Leaflet ignores Playwright's
    // synthetic mouse drags — an emulator limitation, not an app bug (the
    // two-finger-lock class assertion above still guards the regression).
    if (browserName === 'webkit') return;

    const box = await container.boundingBox();
    if (!box) throw new Error('no map bounding box');
    // Drag from the upper-middle: the floating search sits at the top and the
    // fixed nav at the bottom, so aim between them.
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 120, cy - 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await pane.evaluate((el) => getComputedStyle(el).transform);
    expect(after).not.toBe(before);
  });

  test('an already-granted permission locates AUTOMATICALLY on open (U2-4), no tap needed', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(NYC);
    await gotoLoadedMap(page);

    await expect(page.getByText(/Showing your location on the map/i)).toBeVisible(
      { timeout: 15_000 },
    );
    // The locked control reads "Locate" in every state (reference note 2); the
    // status line, not the button label, reports the fix.
    await expect(page.getByRole('button', { name: /^Locate$/ })).toBeVisible();
  });

  test('a too-rough location explains itself instead of silently no-op-ing', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(COARSE_FAR);
    await gotoLoadedMap(page);

    await expect(page.getByText(/too rough to pin exactly/i)).toBeVisible({
      timeout: 15_000,
    });
    // No "you are here" claim, since coords are null for a coarse fix.
    await expect(
      page.getByText(/Showing your location on the map/i),
    ).toHaveCount(0);
  });
});

test.describe('/map marker meanings (locked: Ranked + other only)', () => {
  test('the legend names exactly the two marker meanings', async ({ page }) => {
    await gotoLoadedMap(page);
    const legend = page.getByTestId('map-legend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('Ranked');
    await expect(legend).toContainText('Other bars');
    // Reference note 3: no suggested tier, and no Loved/Liked/Pass on the map.
    await expect(legend).not.toContainText('Suggested');
    for (const word of ['Loved', 'Liked', 'Pass']) {
      await expect(legend).not.toContainText(word);
    }
  });

  test('no suggested markers render — even with a seeded quiz profile', async ({
    page,
  }) => {
    await page.addInitScript(SEED_PROFILE_SCRIPT);
    await gotoLoadedMap(page);

    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });

    const grey = page.locator('.leaflet-marker-icon [data-tier="other"]');
    await expect(grey.first()).toBeVisible({ timeout: 15_000 });
    expect(await grey.count()).toBeGreaterThan(0);

    // Note 5 — the map does not recommend. A profile is exactly the input that
    // used to switch the loud suggested tier on, so this is where a regression
    // would land.
    await expect(
      page.locator('.leaflet-marker-icon [data-tier="suggested"]'),
    ).toHaveCount(0);
    await expect(page.getByTestId('map-quiz-hint')).toHaveCount(0);
  });

  test('map search flies to the picked bar and opens its popup (UX-C)', async ({
    page,
  }) => {
    await gotoLoadedMap(page);
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('searchbox', { name: /Search bars/i }).fill('Attaboy');
    await page
      .getByRole('list', { name: /Matching bars/i })
      .getByRole('button', { name: /Attaboy/ })
      .click();

    await expect(page.locator('.leaflet-popup')).toContainText('Attaboy', {
      timeout: 10_000,
    });
    // Picking clears the query so the dropdown leaves the screen.
    await expect(page.getByRole('list', { name: /Matching bars/i })).toHaveCount(0);
  });
});

test.describe('/map filter sheet (locked: draft until "Show N bars")', () => {
  test('the sheet keeps the map visible and holds choices as a draft', async ({
    page,
  }) => {
    await gotoLoadedMap(page);
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });

    const markers = page.locator('.leaflet-marker-icon');
    await expect(markers.first()).toBeVisible({ timeout: 15_000 });
    const allCount = await markers.count();
    expect(allCount).toBeGreaterThan(0);

    await page.getByRole('button', { name: /^Filters/ }).click();
    const sheet = page.getByTestId('map-filter-sheet');
    await expect(sheet).toBeVisible();

    // Reference note 2: the sheet is COMPACT — the map stays visible behind it.
    const viewport = page.viewportSize()!;
    const sheetBox = await sheet.boundingBox();
    expect(
      sheetBox!.height,
      'the filter sheet covers the map instead of keeping it visible',
    ).toBeLessThan(viewport.height * 0.75);
    await expect(page.locator('.leaflet-container')).toBeVisible();

    // Pick a neighborhood inside the sheet.
    const filters = sheet.getByTestId('findbar-filters');
    await filters.getByTestId('vibe-filter-toggle').click();
    await filters.getByRole('button', { name: 'Neighborhood' }).click();
    await filters
      .getByRole('group', { name: 'Neighborhood' })
      .getByRole('button', { name: /^Lower East Side$/ })
      .click();
    await filters.getByRole('button', { name: 'Apply' }).click();

    // DRAFT: the map behind the sheet has not changed yet. This is the whole
    // point of note 2 — committing on every tap makes the map twitch while the
    // user is still deciding.
    await expect(markers).toHaveCount(allCount);

    // Committing applies it.
    await page.getByRole('button', { name: /^Show \d+ bars?$/ }).click();
    await expect(sheet).toHaveCount(0);
    await expect
      .poll(async () => markers.count(), { timeout: 15_000 })
      .toBeLessThan(allCount);
    await expect(page.getByRole('button', { name: /^Filters \(1\)$/ })).toBeVisible();
  });

  test('cancelling the sheet discards the draft', async ({ page }) => {
    await gotoLoadedMap(page);
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });
    const markers = page.locator('.leaflet-marker-icon');
    await expect(markers.first()).toBeVisible({ timeout: 15_000 });
    const allCount = await markers.count();

    await page.getByRole('button', { name: /^Filters/ }).click();
    const sheet = page.getByTestId('map-filter-sheet');
    const filters = sheet.getByTestId('findbar-filters');
    await filters.getByTestId('vibe-filter-toggle').click();
    await filters.getByRole('button', { name: 'Neighborhood' }).click();
    await filters
      .getByRole('group', { name: 'Neighborhood' })
      .getByRole('button', { name: /^Lower East Side$/ })
      .click();
    await filters.getByRole('button', { name: 'Apply' }).click();
    await sheet.getByRole('button', { name: 'Cancel' }).click();

    await expect(sheet).toHaveCount(0);
    // Discarded, not applied — and no stale filter badge left behind.
    await expect(markers).toHaveCount(allCount);
    await expect(page.getByRole('button', { name: /^Filters$/ })).toBeVisible();
  });
});
