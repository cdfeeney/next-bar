/**
 * mobile-controls.spec.ts
 *
 * "Can I actually reach every button on a phone?"
 *
 * Unit tests cannot answer that and neither can a smoke test that only checks
 * a control EXISTS. A button can be in the DOM, pass `toBeVisible()`, and still
 * be untappable because the fixed bottom nav sits on top of it, because it
 * overflows the viewport horizontally, or because it is a 20px tap target.
 *
 * So this asserts three things per route, for every visible control:
 *   1. it lies inside the viewport horizontally (no sideways overflow)
 *   2. it is at least 44px tall — Apple's minimum tap target
 *   3. the point at its centre actually HITS it (document.elementFromPoint
 *      returns the control or a descendant), which is the only honest test of
 *      "not covered by the bottom nav / a sticky bar / an overlay"
 *
 * Runs on the iPhone 17 project (see playwright.config.ts) plus whatever else
 * matches, so a regression is caught on current hardware rather than only on
 * the 2021 viewport the rest of the suite uses.
 */
import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

/** Apple HIG minimum tap target. Also what a11y-mobile.spec.ts enforces. */
const MIN_TAP_PX = 44;

type BadControl = {
  label: string;
  reason: string;
  box: { x: number; y: number; w: number; h: number };
};

/**
 * Every visible, enabled control inside <main> that fails a reachability rule.
 * Returns [] when the surface is clean.
 */
async function unreachableControls(page: Page): Promise<BadControl[]> {
  return page.evaluate((minTap) => {
    const bad: BadControl[] = [];
    const main = document.querySelector('main') ?? document.body;
    const controls = Array.from(
      main.querySelectorAll<HTMLElement>('button, a[href], [role="button"], input, select'),
    );

    for (const el of controls) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        continue;
      }
      if (el instanceof HTMLButtonElement && el.disabled) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // Off-screen vertically is fine — the page scrolls. Only judge what is
      // currently in the viewport band.
      if (box.bottom < 0 || box.top > window.innerHeight) continue;

      const label =
        (el.getAttribute('aria-label') || el.textContent || el.tagName)
          .trim()
          .slice(0, 60) || el.tagName;
      const record = { x: box.x, y: box.y, w: box.width, h: box.height };

      if (box.left < 0 || box.right > window.innerWidth + 0.5) {
        bad.push({ label, reason: `overflows viewport width (${window.innerWidth}px)`, box: record });
        continue;
      }
      if (box.height < minTap) {
        bad.push({ label, reason: `tap target only ${Math.round(box.height)}px tall`, box: record });
        continue;
      }
      // The real test: is this point actually the control?
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      if (hit === null) {
        bad.push({ label, reason: 'centre point hits nothing', box: record });
        continue;
      }
      if (hit !== el && !el.contains(hit) && !hit.contains(el)) {
        const blocker =
          (hit as HTMLElement).getAttribute?.('aria-label') ||
          (hit as HTMLElement).className ||
          hit.tagName;
        bad.push({
          label,
          reason: `covered by ${String(blocker).slice(0, 50)}`,
          box: record,
        });
      }
    }
    return bad;
  }, MIN_TAP_PX);
}

function describeFailures(route: string, bad: BadControl[]): string {
  return [
    `${bad.length} unreachable control(s) on ${route}:`,
    ...bad.map((b) => `  · "${b.label}" — ${b.reason} @ ${Math.round(b.box.x)},${Math.round(b.box.y)}`),
  ].join('\n');
}

/** Routes with no auth requirement, reachable straight from a cold start. */
const PUBLIC_ROUTES = ['/', '/map', '/rankings', '/discover', '/settings', '/install'];

test.describe('mobile controls are reachable', () => {
  test.beforeEach(async ({ context }) => {
    // Home is location-first; deny geo so it settles to the manual surface.
    await denyGeolocation(context);
  });

  for (const route of PUBLIC_ROUTES) {
    test(`${route} — every visible control is on-screen, tappable and uncovered`, async ({
      page,
    }) => {
      await page.goto(route);
      // Let the surface settle before measuring; a mid-render layout is not a
      // layout bug.
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1_000);

      const top = await unreachableControls(page);
      expect(top, describeFailures(route, top)).toEqual([]);

      // Scroll to the bottom and re-measure: the fixed bottom nav is the most
      // likely thing to sit on top of a page's last control, and that only
      // shows up once you are actually at the end of the page.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);

      const bottom = await unreachableControls(page);
      expect(bottom, describeFailures(`${route} (scrolled to bottom)`, bottom)).toEqual([]);
    });
  }

  test('the bottom nav itself is fully on-screen and every tab is tappable', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: /primary/i });
    await expect(nav).toBeVisible();

    const navBox = await nav.boundingBox();
    expect(navBox).not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    // The nav must sit INSIDE the viewport — a nav whose bottom edge is past
    // the fold is the exact bug this spec exists to catch.
    expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(viewport!.height + 1);
    expect(navBox!.x).toBeGreaterThanOrEqual(0);
    expect(navBox!.width).toBeLessThanOrEqual(viewport!.width + 1);

    const tabs = nav.getByRole('link');
    const count = await tabs.count();
    expect(count).toBe(5);
    for (let i = 0; i < count; i++) {
      const box = await tabs.nth(i).boundingBox();
      expect(box, `nav tab ${i} has no box`).not.toBeNull();
      expect(box!.height, `nav tab ${i} is under ${MIN_TAP_PX}px`).toBeGreaterThanOrEqual(
        MIN_TAP_PX - 1,
      );
    }
  });
});
