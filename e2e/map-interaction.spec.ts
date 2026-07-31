/**
 * map-interaction.spec.ts
 *
 * Behavioral coverage for the /map fixes:
 *  1. Bars render as markers on the map.
 *  2. Single-finger drag pans the map (gesture-handling is OFF on this full
 *     view, so default Leaflet one-pointer dragging is active).
 *  3. "Use my location" grabs geolocation and plots the user marker.
 *  4. B6 marker tiers: suggested (loud) vs rated vs everything-else (quiet
 *     grey), plus the legend chip row and the no-profile quiz hint.
 */

import { test, expect, type Locator, type Page } from '@playwright/test';

/** How many bars the map's suggested tier may surface (useSuggestions). */
const MAP_SUGGESTION_COUNT = 10;

/**
 * Read a locator's count once it has been stable across consecutive polls.
 * Leaflet mounts the catalog's markers in batches, so a single `.count()`
 * can land mid-render and return a number that never recurs.
 */
async function settledCount(
  page: Page,
  locator: Locator,
  { stableFor = 3, intervalMs = 250, timeoutMs = 20_000 } = {},
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const n = await locator.count();
    if (n > 0 && n === last) {
      stable += 1;
      if (stable >= stableFor) return n;
    } else {
      stable = 0;
      last = n;
    }
    await page.waitForTimeout(intervalMs);
  }
  return last;
}

/**
 * Seeds a saved vibe-quiz profile before the app boots, so /map computes a
 * suggested tier. Shape must satisfy storedProfile.loadProfile's validation
 * (tags + preferredNeighborhoods arrays, archetype + savedAt strings).
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
    await page.goto('/map');
    await expect(page.getByRole('heading', { name: /^Find Bar$/ })).toBeVisible();
    // Leaflet attribution confirms the map booted.
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });
    // Bars are plotted as Leaflet marker icons.
    const markers = page.locator('.leaflet-marker-icon');
    await expect(markers.first()).toBeVisible({ timeout: 15_000 });
    expect(await markers.count()).toBeGreaterThan(0);
  });

  test('single-finger pan is enabled (no gesture-handling lock) and pans', async ({
    page,
    browserName,
  }) => {
    await page.goto('/map');
    const container = page.locator('.leaflet-container');
    await expect(container).toBeVisible({ timeout: 15_000 });

    // Gesture-handling (two-finger lock) must be OFF on the full map view.
    await expect(container).not.toHaveClass(/leaflet-gesture-handling/);

    // A single-pointer drag should move the tile pane (i.e. the map pans).
    const pane = page.locator('.leaflet-map-pane');
    const before = await pane.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    // Night-loop N1: the pan-MOTION assertion is Chromium-only. On the
    // iPhone-13 project (WebKit + hasTouch) Leaflet ignores Playwright's
    // synthetic mouse drags, and synthetic Pointer/TouchEvents aren't
    // trusted enough to drive its drag handler either — an emulator
    // limitation, not an app bug (the two-finger-lock class assertion
    // above still guards the actual regression on every device).
    if (browserName === 'webkit') return;

    // QA2 made the page taller (filter rows) — the container's CENTER can
    // land under the fixed bottom nav, which swallows the drag. Scroll the
    // map into view and drag from its visible upper portion instead.
    await container.scrollIntoViewIfNeeded();
    const box = await container.boundingBox();
    if (!box) throw new Error('no map bounding box');
    const cx = box.x + box.width / 2;
    const cy = Math.max(box.y + 40, Math.min(box.y + 200, box.y + box.height / 3));
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 120, cy - 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await pane.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    expect(after).not.toBe(before);
  });

  test('an already-granted permission locates AUTOMATICALLY on open (U2-4), no tap needed', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(NYC);
    await page.goto('/map');

    // U2-4 auto-resume: granted permission → the map locates on mount.
    await expect(page.getByText(/Showing your location on the map/i)).toBeVisible(
      { timeout: 15_000 },
    );
    // The button reads as the update affordance without ever being tapped.
    await expect(
      page.getByRole('button', { name: /Update my location/i }),
    ).toBeVisible();
  });

  test('a too-rough location explains itself instead of silently no-op-ing', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(COARSE_FAR);
    await page.goto('/map');

    // U2-4: the auto-resume attempt runs on mount; a coarse fix must still
    // surface its explanation, not leave a silent gap.
    await expect(page.getByText(/too rough to pin exactly/i)).toBeVisible({
      timeout: 15_000,
    });
    // No "you are here" claim, since coords are null for a coarse fix.
    await expect(
      page.getByText(/Showing your location on the map/i),
    ).toHaveCount(0);
  });
});

test.describe('/map marker tiers (B6: suggestions loud, everything else quiet)', () => {
  test('legend chip row renders all three tiers', async ({ page }) => {
    await page.goto('/map');
    const legend = page.getByTestId('map-legend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('Suggested');
    await expect(legend).toContainText('Rated');
    // UX-C: the grey dot is just "Bar" — minimum words.
    await expect(legend).toContainText('Bar');
    await expect(legend).not.toContainText('Everything else');
  });

  test('seeded profile: suggested markers ≤ 10 and grey markers exist', async ({
    page,
  }) => {
    await page.addInitScript(SEED_PROFILE_SCRIPT);
    await page.goto('/map');

    // Map booted.
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });

    const suggested = page.locator(
      '.leaflet-marker-icon [data-tier="suggested"]',
    );
    const grey = page.locator('.leaflet-marker-icon [data-tier="other"]');

    // At least one suggestion computes for the seeded profile, capped at
    // the suggestion count — the rest of the catalog stays quiet grey.
    await expect(suggested.first()).toBeVisible({ timeout: 15_000 });
    const suggestedCount = await suggested.count();
    expect(suggestedCount).toBeGreaterThan(0);
    expect(suggestedCount).toBeLessThanOrEqual(MAP_SUGGESTION_COUNT);

    await expect(grey.first()).toBeVisible({ timeout: 15_000 });
    expect(await grey.count()).toBeGreaterThan(0);

    // With a profile present, the quiz hint must NOT show.
    await expect(page.getByTestId('map-quiz-hint')).toHaveCount(0);
  });

  test('no profile: suggested dots STILL show (empty-profile fallback), quiz hint links to /quiz (UX-C)', async ({
    page,
  }) => {
    await page.goto('/map');

    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });

    const grey = page.locator('.leaflet-marker-icon [data-tier="other"]');
    await expect(grey.first()).toBeVisible({ timeout: 15_000 });

    // UX-C (operator: "no suggested bars for me now"): a missing quiz
    // profile falls back to the empty profile — the suggested tier is
    // NEVER blank.
    const suggested = page.locator(
      '.leaflet-marker-icon [data-tier="suggested"]',
    );
    await expect(suggested.first()).toBeVisible({ timeout: 15_000 });
    expect(await suggested.count()).toBeLessThanOrEqual(MAP_SUGGESTION_COUNT);

    // The one-line personalize hint still links to the quiz.
    const hint = page.getByTestId('map-quiz-hint');
    await expect(hint).toBeVisible();
    await expect(hint.getByRole('link', { name: /quiz/i })).toHaveAttribute(
      'href',
      '/quiz',
    );
  });

  test('map search flies to the picked bar and opens its popup (UX-C)', async ({
    page,
  }) => {
    await page.goto('/map');
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('searchbox', { name: /Search bars/i }).fill('Attaboy');
    await page
      .getByRole('list', { name: /Matching bars/i })
      .getByRole('button', { name: /Attaboy/ })
      .click();

    // The popup names the bar (fly animation settles under the retry).
    await expect(page.locator('.leaflet-popup')).toContainText('Attaboy', {
      timeout: 10_000,
    });
    // Picking clears the query so the dropdown leaves the screen.
    await expect(page.getByRole('list', { name: /Matching bars/i })).toHaveCount(0);
  });
});

test.describe('/map Find Bar filters (QA2)', () => {
  test('a neighborhood chip narrows the markers; Clear restores them', async ({
    page,
  }) => {
    await page.goto('/map');
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });

    const markers = page.locator('.leaflet-marker-icon');
    await expect(markers.first()).toBeVisible({ timeout: 15_000 });
    // Sample the baseline only once the count STOPS moving. The catalog's
    // markers mount progressively, and reading it the instant the first
    // marker appeared captured a mid-render 403 against a settled 1,256 —
    // so the post-Clear `.toBe(allCount)` below could never come true. The
    // assertion was right; the baseline was the bug.
    const allCount = await settledCount(page, markers);
    expect(allCount).toBeGreaterThan(0);

    // M1 (goal g-44007df6): the filter rails are COLLAPSED by default now —
    // you click into them rather than seeing always-on chips. Open the
    // disclosure first. This is a re-point, not a relaxation: every assertion
    // below is unchanged.
    const disclosure = page.getByRole('button', { name: /Tweak the vibe/i });
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    // Pick one neighborhood — the map must drop to that hood's bars only.
    const filters = page.getByTestId('findbar-filters');
    await filters.getByRole('button', { name: /^Lower East Side$/ }).click();

    await expect
      .poll(async () => markers.count(), { timeout: 15_000 })
      .toBeLessThan(allCount);
    // The badge counts the one active filter.
    await expect(page.getByTestId('filter-count')).toHaveText('1');

    // …and the COLLAPSED row must carry the count too. A review found the
    // count was computed but only ever used as a boolean, so closing the panel
    // hid how many filters were on — the one thing you need to know before
    // deciding whether to reopen it. The open-panel badge above cannot catch
    // that, because it only exists while the panel is open.
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('collapsed-filter-count')).toHaveText('1');
    await disclosure.click();

    // One-tap Clear restores the full catalog.
    await page.getByTestId('filter-clear').click();
    await expect
      .poll(async () => markers.count(), { timeout: 15_000 })
      .toBe(allCount);
    await expect(page.getByTestId('filter-count')).toHaveCount(0);
  });
});
