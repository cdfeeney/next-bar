/**
 * a11y-mobile.spec.ts
 *
 * V8 acceptance criterion 9 — reduced motion, contrast, 44px targets and text
 * scaling — across the five canonical tab surfaces, not just Home.
 *
 * The target-size audit used to run on Home only, so an undersized control on
 * Map, Rankings, Social or Account shipped green; and text scaling stopped at
 * 125%, which is well short of what iOS Dynamic Type actually offers. Both are
 * widened here, and each surface is asserted at 200% too.
 *
 * (Reduced-motion and contrast have their own homes: the reduced-motion rules
 * are asserted in native-shell-contract.spec.ts, and the locked palette's
 * contrast ratios in src/lib/paletteContrast.test.ts.)
 */

import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

/** The five canonical tabs. A control is no less real on one than another. */
const TAB_ROUTES = ['/', '/map', '/rankings', '/friends', '/settings'] as const;

/**
 * A landmark per route that proves the surface actually rendered before we
 * audit it — an empty page trivially has no undersized buttons.
 */
async function settleRoute(page: Page, route: string): Promise<void> {
  await page.goto(route);
  if (route === '/map') {
    await expect(page.getByTestId('map-surface')).toBeVisible();
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });
    return;
  }
  await expect(page.locator('main, [role="main"]').first()).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => {
    /* best-effort; the landmark above carries the wait */
  });
}

/** Every rendered, visible control that is shorter than the 44px minimum. */
async function undersizedTargets(page: Page): Promise<string[]> {
  // ONE in-page pass instead of per-button Playwright round-trips: the home
  // BarPicker lists the whole catalog (400+ buttons at 406 bars), and serial
  // boundingBox calls blew the test budget as the catalog grew (night-3 M5).
  return page.evaluate(() => {
    const bad: string[] = [];
    // Links that act as controls are targets too — the bottom nav is links.
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>('button, a[href], [role="button"]'),
    )) {
      const rect = el.getBoundingClientRect();
      if (rect.height === 0 || rect.width === 0) continue; // hidden
      if (getComputedStyle(el).visibility === 'hidden') continue;
      // Inline links inside a paragraph are text, not tap targets; the
      // criterion is about controls.
      if (el.tagName === 'A' && el.closest('p')) continue;
      // Map MARKERS are data, not controls: Leaflet renders each as a
      // focusable div, and the locked design specifies the quiet tier at 8px
      // ("everything else is a smaller muted dot" — next-bar-map-v1.png note
      // 3), so auditing those at 44px would fail the approved design rather
      // than find a defect.
      //
      // Exclude ONLY the markers. An earlier version of this skipped
      // everything inside `.leaflet-container`, which also swallowed
      // `.leaflet-control-zoom` — genuine 30x30 interactive controls that DO
      // owe the 44px minimum. Round-1 review caught it: a scope written to
      // silence a false positive had quietly masked a real one.
      if (el.closest('.leaflet-marker-icon')) continue;
      if (rect.height < 44) {
        bad.push(
          `<${el.tagName.toLowerCase()}> "${(el.textContent ?? '').trim().slice(0, 40)}" height ${rect.height.toFixed(1)}px`,
        );
      }
    }
    return bad;
  });
}

test.describe('Mobile a11y — criterion 9 across the five tabs', () => {
  test.beforeEach(async ({ page }) => {
    // Home is location-first; deny geo so it falls back to the pick-a-bar surface.
    await denyGeolocation(page.context());
  });

  for (const route of TAB_ROUTES) {
    test(`${route}: no horizontal scroll`, async ({ page }) => {
      await settleRoute(page, route);
      const hasHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(hasHorizontalScroll, `${route} scrolls horizontally`).toBe(false);
    });

    test(`${route}: every visible control is at least 44px tall`, async ({ page }) => {
      await settleRoute(page, route);
      const offenders = await undersizedTargets(page);
      expect(offenders, `${route}: controls under 44px`).toEqual([]);
    });

    // 200%, not 125%: iOS Dynamic Type's accessibility sizes go far past the
    // old 20px root, and a layout that survives 125% routinely breaks at 200%.
    test(`${route}: still fits horizontally at 200% text size`, async ({ page }) => {
      await settleRoute(page, route);
      await page.addStyleTag({ content: 'html { font-size: 32px !important; }' });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        scrollWidth,
        `${route} overflows horizontally at 200% text size (${scrollWidth} > ${clientWidth})`,
      ).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});
