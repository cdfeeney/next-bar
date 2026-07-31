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
 * Mirror of lib/suggestedTier.suggestedCount — the promoted-marker budget as a
 * function of the cohort currently on screen. Duplicated here on purpose: an
 * e2e that imported the implementation would agree with it by construction and
 * could not catch prominence drifting back to a whole-catalog ranking.
 * Keep in sync with SUGGESTED_CAP / MIN_COHORT_FOR_TIERS / SHARE.
 */
function suggestedBudget(cohortSize: number): number {
  if (cohortSize < 4) return 0;
  return Math.min(MAP_SUGGESTION_COUNT, Math.max(1, Math.floor(cohortSize * 0.3)));
}

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

/**
 * The /map filter surface (goal g-12d33864).
 *
 * These tests were re-pointed from the old FindBarFilterChips rails onto
 * MapFilterSheet — the SHARED six-axis accordion. Two behavioral differences
 * are deliberate and are themselves asserted below, not worked around:
 *
 *  1. Picks are a DRAFT until Apply. The rails applied live; a sheet covering
 *     the map you are filtering must not. The "nothing changes before Apply"
 *     and "Cancel discards" assertions are the negative coverage CLAUDE.md
 *     asks for — they are what catch a regression back to live-apply.
 *  2. Neighborhood and Distance are accordion rows inside the sheet, so their
 *     chips need their row opened first.
 */
test.describe('/map filter sheet (six axes + location, goal g-12d33864)', () => {
  /** Open "Tweak the vibe" and return the disclosure + sheet locators. */
  async function openSheet(page: Page) {
    const disclosure = page.getByRole('button', { name: /Tweak the vibe/i });
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    const sheet = page.getByTestId('findbar-filters');
    await expect(sheet).toBeVisible();
    return { disclosure, sheet };
  }

  /**
   * Expand one accordion row inside the sheet by its visible label.
   *
   * NOT anchored at the end: every row's accessible name is its label plus its
   * collapsed summary ("Drink Anything", "Neighborhood Lower East Side"), which
   * is deliberate — the summary is what makes the closed accordion scannable.
   * Anchoring `$` matched nothing at all.
   */
  function rowTrigger(sheet: Locator, label: string) {
    return sheet.getByRole('button', { name: new RegExp(`^${label}\\b`) });
  }

  async function openRow(sheet: Locator, label: string) {
    const row = rowTrigger(sheet, label);
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
  }

  test('the old horizontal rails are gone from the map entirely', async ({
    page,
  }) => {
    await page.goto('/map');
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });

    // Closed by default: no filter control renders until you ask for one.
    await expect(page.getByTestId('findbar-filters')).toHaveCount(0);

    const { sheet } = await openSheet(page);

    // The six axes are the control. This is the assertion that fails if anyone
    // reinstates a flat chip wall behind the button: the axis rows must exist
    // as their own labelled disclosures.
    for (const axis of ['Drink', 'Energy', 'Setting', 'Scene', 'Sound', 'Spend']) {
      await expect(rowTrigger(sheet, axis)).toBeVisible();
    }
    // Location dimensions live INSIDE the same surface, not as separate rails.
    await expect(rowTrigger(sheet, 'Neighborhood')).toBeVisible();
    await expect(rowTrigger(sheet, 'Distance')).toBeVisible();

    // NEGATIVE: the 33 vibe chips must NOT all be present at once — that was
    // the rail. Only the opened axis exposes its tags.
    await expect(sheet.getByRole('button', { name: /^Dive$/i })).toHaveCount(0);
  });

  test('Club is independently selectable and restricts the markers', async ({
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
    // marker appeared captured a mid-render 403 against a settled 1,256.
    const allCount = await settledCount(page, markers);
    expect(allCount).toBeGreaterThan(0);

    const { disclosure, sheet } = await openSheet(page);

    // Club lives in the Setting axis, Dancing in Energy, House in Sound — three
    // separate axes, which is what makes them independently selectable and what
    // makes combining them AND rather than OR (lib/findBarFilters.passesVibe).
    await openRow(sheet, 'Setting');
    await sheet.getByRole('button', { name: /^Club/ }).click();
    await expect(page.getByTestId('filter-count')).toHaveText('1');

    // NEGATIVE — the draft has NOT been applied yet. A live-apply regression
    // fails right here.
    expect(await markers.count()).toBe(allCount);

    await sheet.getByRole('button', { name: /^Apply$/ }).click();

    // Applying closes the sheet and narrows the rendered markers.
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect
      .poll(async () => markers.count(), { timeout: 15_000 })
      .toBeLessThan(allCount);
    // The collapsed row keeps carrying the count, so closing never hides what
    // the filter is doing.
    await expect(page.getByTestId('collapsed-filter-count')).toHaveText('1');
  });

  test('adding Dancing and House narrows further (AND across axes)', async ({
    page,
  }) => {
    await page.goto('/map');
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });
    const markers = page.locator('.leaflet-marker-icon');
    await expect(markers.first()).toBeVisible({ timeout: 15_000 });
    await settledCount(page, markers);

    // Club alone.
    let sheet = (await openSheet(page)).sheet;
    await openRow(sheet, 'Setting');
    await sheet.getByRole('button', { name: /^Club/ }).click();
    await sheet.getByRole('button', { name: /^Apply$/ }).click();
    const clubOnly = await settledCount(page, markers);
    expect(clubOnly).toBeGreaterThan(0);

    // Club + Dancing + House. Adding filters must make the set SMALLER OR
    // EQUAL — never larger. The flat `.some()` this taxonomy replaced made it
    // larger, which is the exact defect the operator reported.
    // The labels are exactly the three the operator named: displayTag maps
    // dance -> "Dancing" and house -> "House music" (src/lib/tagDisplay.ts).
    sheet = (await openSheet(page)).sheet;
    await openRow(sheet, 'Energy');
    await sheet.getByRole('button', { name: /^Dancing/ }).click();
    await openRow(sheet, 'Sound');
    await sheet.getByRole('button', { name: /^House music/ }).click();
    await expect(page.getByTestId('filter-count')).toHaveText('3');
    await sheet.getByRole('button', { name: /^Apply$/ }).click();

    await expect
      .poll(async () => markers.count(), { timeout: 15_000 })
      .toBeLessThanOrEqual(clubOnly);
  });

  test('Cancel discards the draft; a neighborhood pick then Apply narrows and Clear restores', async ({
    page,
  }) => {
    await page.goto('/map');
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });
    const markers = page.locator('.leaflet-marker-icon');
    await expect(markers.first()).toBeVisible({ timeout: 15_000 });
    const allCount = await settledCount(page, markers);

    // Draft a pick, then Cancel. NEGATIVE: nothing may survive.
    let sheet = (await openSheet(page)).sheet;
    await openRow(sheet, 'Neighborhood');
    await sheet.getByRole('button', { name: /^Lower East Side$/ }).click();
    await expect(page.getByTestId('filter-count')).toHaveText('1');
    await sheet.getByRole('button', { name: /^Cancel$/ }).click();

    expect(await markers.count()).toBe(allCount);
    await expect(page.getByTestId('collapsed-filter-count')).toHaveCount(0);

    // Reopening must re-seed from the APPLIED state, not the cancelled draft.
    sheet = (await openSheet(page)).sheet;
    await expect(page.getByTestId('filter-count')).toHaveCount(0);

    // Now really apply it.
    await openRow(sheet, 'Neighborhood');
    await sheet.getByRole('button', { name: /^Lower East Side$/ }).click();
    await sheet.getByRole('button', { name: /^Apply$/ }).click();
    await expect
      .poll(async () => markers.count(), { timeout: 15_000 })
      .toBeLessThan(allCount);
    await expect(page.getByTestId('collapsed-filter-count')).toHaveText('1');

    // One-tap Clear (then Apply) restores the full catalog.
    sheet = (await openSheet(page)).sheet;
    await page.getByTestId('filter-clear').click();
    await expect(page.getByTestId('filter-count')).toHaveCount(0);
    await sheet.getByRole('button', { name: /^Apply$/ }).click();
    await expect
      .poll(async () => markers.count(), { timeout: 15_000 })
      .toBe(allCount);
    await expect(page.getByTestId('collapsed-filter-count')).toHaveCount(0);
  });

  test('applying updates Suggested prominence, not just the marker set', async ({
    page,
  }) => {
    await page.addInitScript(SEED_PROFILE_SCRIPT);
    await page.goto('/map');
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });

    const markers = page.locator('.leaflet-marker-icon');
    const suggested = page.locator('.leaflet-marker-icon [data-tier="suggested"]');
    await expect(suggested.first()).toBeVisible({ timeout: 15_000 });

    const allCount = await settledCount(page, markers);
    // Unfiltered, the cohort is the whole catalog, so the budget is at its cap.
    expect(await suggested.count()).toBe(suggestedBudget(allCount));

    // Narrow hard to a single neighborhood. Suggested is ranked WITHIN the
    // filtered cohort, so the glowing pins must follow the filter — the bug
    // this asserts against is a map whose markers move while "Suggested" keeps
    // answering a quiz the user took once.
    const { sheet } = await openSheet(page);
    await openRow(sheet, 'Neighborhood');
    await sheet.getByRole('button', { name: /^Lower East Side$/ }).click();
    await sheet.getByRole('button', { name: /^Apply$/ }).click();

    const afterCount = await settledCount(page, markers);
    expect(afterCount).toBeLessThan(allCount);

    // The load-bearing assertion: the suggested budget is a function of the
    // COHORT ON SCREEN (lib/suggestedTier.suggestedCount), so a filter that
    // changes the cohort must change how many bars are promoted. If prominence
    // ever goes back to ranking the whole catalog, this number stays at the cap
    // while the markers shrink, and the test fails.
    expect(suggestedBudget(afterCount)).toBeLessThan(suggestedBudget(allCount));
    await expect
      .poll(async () => suggested.count(), { timeout: 15_000 })
      .toBe(suggestedBudget(afterCount));
  });
});
