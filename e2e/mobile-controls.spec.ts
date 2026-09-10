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
 * Restored onto this branch 2026-08-19 (g-d54ef3f8). It was written on the
 * overnight-2026-07-30 line and never reached the V8 convergence, so this
 * branch has been auditing tap targets with a11y-mobile.spec.ts alone — which
 * measures HEIGHT only and skips occlusion entirely. Both of the criteria this
 * file adds (44px WIDE, and elementFromPoint at the centre) had found real
 * defects that a height-only audit reports as green.
 *
 * Runs on every project in playwright.config.ts (iPhone 13, Pixel 7).
 */
import { test, expect, type Page } from './helpers/test';
import { CATALOG_ROUTE, fulfillCatalog } from './helpers/catalogTest';
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
async function unreachableControls(
  page: Page,
  mode: 'full' | 'coverage-only' = 'full',
): Promise<BadControl[]> {
  return page.evaluate(([minTap, evalMode]: [number, string]) => {
    const coverageOnly = evalMode === 'coverage-only';
    const bad: BadControl[] = [];
    const main = document.querySelector('main') ?? document.body;
    const controls = Array.from(
      main.querySelectorAll<HTMLElement>('button, a[href], [role="button"], input, select'),
    );

    /**
     * The nearest ancestor that scrolls HORIZONTALLY, or null.
     *
     * A neighborhood filter rail is *supposed* to run past the right edge of
     * the phone — that is what makes it a rail. Measuring its children against
     * the viewport reported 88 "overflows viewport width" failures on /map
     * alone, every one of them a control the user reaches by swiping. So a
     * control inside a rail is judged against the RAIL's box: it must be
     * reachable within its own scroll container, not visible all at once.
     */
    function horizontalScroller(el: HTMLElement): HTMLElement | null {
      let node: HTMLElement | null = el.parentElement;
      while (node && node !== document.body) {
        const cs = window.getComputedStyle(node);
        const scrollsX = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
        const overflowsX = node.scrollWidth > node.clientWidth + 1;
        // CSS computes overflow-x to `auto` whenever overflow-y is auto/scroll,
        // even when the author wrote `visible`. Without the extra guard below,
        // ANY vertical scroller containing a too-wide child would be mistaken
        // for a rail — which would silently suppress exactly the real
        // horizontal-overflow bug this spec exists to catch. (a11y-mobile.spec
        // proves one such overflow exists on / at 402px.)
        //
        // A genuine rail scrolls sideways and NOT down. A page-level scroller
        // scrolls down. That separates them without needing the specified value.
        const scrollsY = node.scrollHeight > node.clientHeight + 1;
        if (scrollsX && overflowsX && !scrollsY) return node;
        node = node.parentElement;
      }
      return null;
    }

    for (const el of controls) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        continue;
      }
      if (el instanceof HTMLButtonElement && el.disabled) continue;
      if (el.getBoundingClientRect().width === 0) continue;

      // Leaflet's internal DOM is not app chrome. Markers, cluster badges and
      // attribution links are `div[role=button]`s the map library owns and
      // positions; they are data points on a pannable canvas with their own
      // interaction model, not controls we lay out. Auditing them produced 408
      // "8px tall" findings on /map — all of them Leaflet marker internals.
      // The map's OWN controls (zoom, locate) live outside this container and
      // are still audited.
      if (el.closest('.leaflet-container') !== null) continue;

      // Bring the control to the middle of the viewport before judging it.
      // Measuring only at scroll-top and scroll-bottom never looked at the
      // middle band, and a control straddling the fold got its centre point
      // sampled OUTSIDE the viewport, where elementFromPoint always returns
      // null — reported as "centre point hits nothing" when nothing was wrong.
      //
      // In coverage-only mode the page is deliberately left at rest, because
      // moving the control is precisely what would hide the bug being looked
      // for.
      if (!coverageOnly) {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }

      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // At rest, judge only what is actually in the viewport band.
      if (coverageOnly && (box.bottom < 0 || box.top > window.innerHeight)) continue;

      const label =
        (el.getAttribute('aria-label') || el.textContent || el.tagName)
          .trim()
          .slice(0, 60) || el.tagName;
      const record = { x: box.x, y: box.y, w: box.width, h: box.height };

      // --- horizontal containment, rail-aware ---
      const rail = horizontalScroller(el);
      if (coverageOnly) {
        // skip geometry rules; pass 1 already judged them fairly
      } else if (rail === null) {
        if (box.left < -0.5 || box.right > window.innerWidth + 0.5) {
          bad.push({
            label,
            reason: `overflows viewport width (${window.innerWidth}px)`,
            box: record,
          });
          continue;
        }
      } else {
        // Inside a rail: the rail itself must fit the viewport, and the
        // control must be reachable by scrolling that rail.
        const railBox = rail.getBoundingClientRect();
        if (railBox.left < -0.5 || railBox.right > window.innerWidth + 0.5) {
          bad.push({
            label: rail.getAttribute('aria-label') || 'horizontal rail',
            reason: `scroll container itself overflows viewport width (${window.innerWidth}px)`,
            box: { x: railBox.x, y: railBox.y, w: railBox.width, h: railBox.height },
          });
          continue;
        }
      }

      // --- tap target, BOTH dimensions ---
      if (!coverageOnly && box.height < minTap) {
        bad.push({ label, reason: `tap target only ${Math.round(box.height)}px tall`, box: record });
        continue;
      }
      if (!coverageOnly && box.width < minTap) {
        bad.push({ label, reason: `tap target only ${Math.round(box.width)}px wide`, box: record });
        continue;
      }

      // --- the real test: does the centre point actually hit the control? ---
      // Clamp into the rail's visible band so a control parked off the rail's
      // current scroll offset is not sampled at a coordinate the rail does not
      // currently show.
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      if (cx < 0 || cx > window.innerWidth || cy < 0 || cy > window.innerHeight) {
        // After scrollIntoView this means the control genuinely cannot be
        // brought on screen — a real defect, and a different one from "covered".
        // At rest it just means the centre is off the current band, which is
        // not a finding.
        if (!coverageOnly) {
          bad.push({ label, reason: 'cannot be scrolled into the viewport', box: record });
        }
        continue;
      }

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
  }, [MIN_TAP_PX, mode] as [number, string]);
}

async function waitForStableControls(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(async () => {
    const sample = () => {
      const main = document.querySelector('main') ?? document.body;
      return JSON.stringify({
        boxes: Array.from(main.querySelectorAll<HTMLElement>(
          'button, a[href], [role="button"], input, select',
        ), el => el.getBoundingClientRect().toJSON()),
        scroll: Array.from(document.querySelectorAll('*'), el => el.scrollTop),
      });
    };
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const before = sample();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return sample() === before;
  }), { message: 'Control boxes and scrollTop must be stable across consecutive animation frames' }).toBe(true);
}

function describeFailures(route: string, bad: BadControl[]): string {
  return [
    `${bad.length} unreachable control(s) on ${route}:`,
    ...bad.map((b) => `  · "${b.label}" — ${b.reason} @ ${Math.round(b.box.x)},${Math.round(b.box.y)}`),
  ].join('\n');
}

/** Routes with no auth requirement, reachable straight from a cold start. */
// '/discover' was removed from this list when the route was archived (goal
// g-12d33864): it now redirects to /map, so scanning it would only measure /map
// a second time while reporting failures against a URL that renders nothing.
const PUBLIC_ROUTES = ['/', '/map', '/rankings', '/settings', '/install'];

test.describe('mobile controls are reachable', () => {
  test.beforeEach(async ({ context }) => {
    // Home is location-first; deny geo so it settles to the manual surface.
    await denyGeolocation(context);
  });

  test('a delayed catalog settles before the picker bottom is measured', async ({ page }) => {
    await page.route(CATALOG_ROUTE, async route => {
      await new Promise(resolve => setTimeout(resolve, 750));
      await fulfillCatalog(route);
    });
    await page.goto('/');
    await expect(page.getByText(/Loading the Manhattan catalog/)).toBeVisible();
    await expect(page.getByText(/Loading the Manhattan catalog/)).toHaveCount(0, { timeout: 15_000 });
    const lastControl = page.getByRole('button', { name: /Not listed/ });
    await lastControl.scrollIntoViewIfNeeded();
    await expect(lastControl).toBeVisible();
    await lastControl.click({ trial: true });
    const covered = await unreachableControls(page, 'coverage-only');
    expect(covered, describeFailures('/ after delayed catalog', covered)).toEqual([]);
  });

  // The two passes are SEPARATE tests. They were one test until 2026-08-19,
  // and that coupling is load-bearing here: `/` currently has a real pass-2
  // occlusion defect whose fix is off-limits to this lane (see the fixme
  // below), and a single combined test would have taken the geometry
  // assertions for `/` down with it — silently deleting the coverage that
  // proves "Try again" is still a 44px target.
  for (const route of PUBLIC_ROUTES) {
    async function settle(page: Page): Promise<void> {
      await page.goto(route);
      // Let the surface settle before measuring; a mid-render layout is not a
      // layout bug.
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
      // A catalog swap after scrolling moves the bottom of the picker.
      // The saved WebKit trace placed its final page response inside the old
      // 500ms measurement pause. Measure only after the list has settled.
      await expect(page.getByText(/Loading the Manhattan catalog/)).toHaveCount(0, { timeout: 15_000 });
      await waitForStableControls(page);
    }

    test(`${route} — every visible control is on-screen and a 44px target`, async ({
      page,
    }) => {
      await settle(page);

      // Pass 1 — geometry. Each control is scrolled to the middle of the
      // viewport first, so the middle band is measured too (the old
      // top-then-bottom sampling never looked at it).
      const bad = await unreachableControls(page);
      expect(bad, describeFailures(route, bad)).toEqual([]);
    });

    test(`${route} — no control is covered at its resting position`, async ({
      page,
    }) => {
      await settle(page);

      // Pass 2 — coverage AT REST, which pass 1 cannot see.
      //
      // Centring a control necessarily moves it out from under the fixed
      // bottom nav, so pass 1 reports every page whose last control is
      // scrollable as clean. But "reachable only if you first scroll it away
      // from the nav" is exactly the bug we care about: at the page's natural
      // resting position the control is covered. Rankings' "+ Add a bar" is
      // the known real instance, and pass 1 alone silently lost it.
      //
      // Only the coverage rule runs here — size and overflow were already
      // judged fairly in pass 1, and re-running them at rest would resurrect
      // the straddling-the-fold artifact.
      // `window.scrollTo` is a NO-OP on these routes — the app scrolls an inner
      // container, not the document. Probed on /rankings: maxScroll reported
      // 420px while scrollY stayed 0 after scrollTo(0, scrollHeight). The
      // original spec's "scrolled to bottom" pass therefore never scrolled at
      // all and silently re-measured the top of the page. Find the real
      // vertical scroller and drive that instead.
      await page.evaluate(() => {
        const scrollables = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((el) => {
          const oy = window.getComputedStyle(el).overflowY;
          return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1;
        });
        for (const el of scrollables) el.scrollTop = el.scrollHeight;
        // Assign the document scroller directly. `html { scroll-behavior:
        // smooth }` makes window.scrollTo animate, so the old check sampled a
        // random row mid-flight instead of the page's bottom resting position.
        const pageScroller = (document.scrollingElement ?? document.documentElement) as HTMLElement;
        pageScroller.style.scrollBehavior = 'auto';
        pageScroller.scrollTop = pageScroller.scrollHeight;
      });
      await waitForStableControls(page);

      const covered = (await unreachableControls(page, 'coverage-only')).filter((b) =>
        b.reason.startsWith('covered by'),
      );
      expect(covered, describeFailures(`${route} (at rest, scrolled to bottom)`, covered)).toEqual(
        [],
      );
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

  // V9-10b: the five-tab row has to fit COMPACT iPhones, not just the two
  // device projects (390 / 412 px). With Playfair Display (wider than Poppins,
  // uppercase + tracking) the centre pill's whitespace-nowrap left the row at
  // min-content width, which overflowed at 375 px (12/13 mini, SE 2/3) and
  // 320 px (SE 1st gen) and clipped the ACCOUNT label. `/` renders the raised
  // pill (widest row); `/map` renders the plain five-tab row.
  // Heights are the real phones': 375x667 (iPhone 8 / SE 2-3), 320x568 (SE 1st
  // gen) — V10-04; the earlier 320x667 tested a phone that does not exist.
  for (const [width, height] of [[375, 667], [320, 568]] as const) {
    for (const route of ['/', '/map']) {
      test(`bottom nav fits a ${width}px viewport on ${route}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto(route);
        const nav = page.getByRole('navigation', { name: /primary/i });
        await expect(nav).toBeVisible();

        const row = await nav.locator('ul').evaluate((ul) => ({
          scrollWidth: ul.scrollWidth,
          clientWidth: ul.clientWidth,
          innerWidth: window.innerWidth,
        }));
        expect(
          row.scrollWidth,
          `nav row overflows: scrollWidth ${row.scrollWidth} > viewport ${row.innerWidth}`,
        ).toBeLessThanOrEqual(row.innerWidth);

        const tabs = nav.getByRole('link');
        expect(await tabs.count()).toBe(5);
        for (let i = 0; i < 5; i++) {
          const box = await tabs.nth(i).boundingBox();
          expect(box, `nav tab ${i} has no box`).not.toBeNull();
          expect(box!.x, `nav tab ${i} starts left of the viewport`).toBeGreaterThanOrEqual(-1);
          expect(
            box!.x + box!.width,
            `nav tab ${i} ends past the ${width}px viewport`,
          ).toBeLessThanOrEqual(width + 1);
          expect(box!.height, `nav tab ${i} is under ${MIN_TAP_PX}px`).toBeGreaterThanOrEqual(
            MIN_TAP_PX - 1,
          );
        }

        // V10-04 (V9-10b panel, both lanes): the link boxes are flex-sized, so a
        // LABEL wider than its slot overflows into a neighbour without moving
        // `ul.scrollWidth` or any link box. Measure the rendered text itself
        // (a Range over the label's text node) and require it inside its link.
        const overflowing = await tabs.evaluateAll((links) =>
          links.flatMap((link) => {
            const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
            const node = walker.nextNode();
            if (!node) return [`${link.textContent?.trim()}: no text node`];
            const range = document.createRange();
            range.selectNodeContents(node);
            const text = range.getBoundingClientRect();
            const box = link.getBoundingClientRect();
            const inside = text.left >= box.left - 0.5 && text.right <= box.right + 0.5;
            return inside
              ? []
              : [`${node.textContent?.trim()} spans ${text.left.toFixed(1)}–${text.right.toFixed(1)} outside its link ${box.left.toFixed(1)}–${box.right.toFixed(1)}`];
          }),
        );
        expect(overflowing, overflowing.join('; ')).toEqual([]);
      });
    }
  }
});
