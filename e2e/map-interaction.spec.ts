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

import { test, expect } from '@playwright/test';

/** How many bars the map's suggested tier may surface (useSuggestions). */
const MAP_SUGGESTION_COUNT = 10;

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
    await expect(page.getByRole('heading', { name: /^Map$/ })).toBeVisible();
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

    const box = await container.boundingBox();
    if (!box) throw new Error('no map bounding box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
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
    await expect(legend).toContainText('Everything else');
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

  test('no profile: zero suggested markers, all-grey map, quiz hint links to /quiz', async ({
    page,
  }) => {
    await page.goto('/map');

    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });

    const grey = page.locator('.leaflet-marker-icon [data-tier="other"]');
    await expect(grey.first()).toBeVisible({ timeout: 15_000 });

    // No suggested tier without a quiz profile.
    await expect(
      page.locator('.leaflet-marker-icon [data-tier="suggested"]'),
    ).toHaveCount(0);

    // The hint card renders and links to the quiz.
    const hint = page.getByTestId('map-quiz-hint');
    await expect(hint).toBeVisible();
    await expect(hint.getByRole('link', { name: /quiz/i })).toHaveAttribute(
      'href',
      '/quiz',
    );
  });
});
