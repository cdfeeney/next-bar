/**
 * mobile-shell-pack.spec.ts (goal g-b07c73bc)
 *
 * Web-provable regression pins for the operator's TestFlight build-5 shell
 * feedback (docs/MORNING-HANDOFF-2026-08-05.md): oversized top/safe-area
 * region, background issue, wonky scrolling. Login-on-open already has its
 * own spec (signin-gate.spec.ts) and is NOT duplicated here.
 *
 * SCOPE HONESTY. Build 5 wraps Production, and a browser cannot render real
 * status-bar insets or suspend a WKWebView. These tests pin only the WEB
 * LAYER's contribution to each reported item; the native halves live in
 * docs/MOBILE-SHELL-DEVICE-CHECKLIST-2026-08-05.md as attended checks.
 *
 *   1. Top region: the header sits at y=0 with no top padding creep from
 *      body/main, and its height stays inside a compact budget — so any
 *      oversize a device shows is the shell's inset handling, not this CSS.
 *      Also pins `viewport-fit=cover`: removing it silently changes how the
 *      shell resolves env(safe-area-inset-*) and would surface exactly as
 *      the reported defect.
 *   2. Background/resume: a hidden→visible cycle must not navigate, jump
 *      the scroll position, or kill interactivity. The app has four
 *      visibilitychange listeners (useAuth, useIntent, deferredCatalogSwap,
 *      searchBarAutoHide) — this asserts their combined effect on the
 *      surface, which no unit test can.
 *   3. Overlay idempotency under resume events in the installed context:
 *      repeated visibility cycles must keep exactly ONE sign-in dialog —
 *      the double-mounted-overlay class of resume defect.
 */
import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';
import { asInstalledApp } from './helpers/standalone';
import { installLoopbackFixtures } from './helpers/catalogFixture';

const SEARCH = { name: 'Search bars' };

/** Compact budget for the wrapped two-row worst case at ~320-360px widths. */
const HEADER_HEIGHT_BUDGET_PX = 120;

/**
 * Fake a background/resume cycle the way the unit suites do: override
 * visibilityState/hidden, dispatch visibilitychange, then restore. All
 * configured projects run Chromium, where the property override is honored
 * by every listener in the app.
 */
async function cycleVisibility(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test.describe('/ top region stays compact (web layer of the safe-area report)', () => {
  test.beforeEach(async ({ page, context }) => {
    await denyGeolocation(context);
    await page.goto('/');
    await expect(page.getByRole('textbox', SEARCH)).toBeVisible({ timeout: 15_000 });
  });

  test('header starts at the very top with no padding creep above it', async ({ page }) => {
    const header = page.locator('main > header').first();
    const box = await header.boundingBox();
    expect(box).not.toBeNull();
    // y=0 is the pin: any top padding/margin added to html/body/main — the
    // double-inset class of defect — pushes the header down and fails here.
    expect(box!.y).toBeLessThanOrEqual(1);
    expect(box!.height).toBeLessThanOrEqual(HEADER_HEIGHT_BUDGET_PX);

    const creep = await page.evaluate(() => {
      const top = (el: Element | null) => {
        if (!el) return { pad: '0px', margin: '0px' };
        const s = window.getComputedStyle(el);
        return { pad: s.paddingTop, margin: s.marginTop };
      };
      return {
        body: top(document.body),
        main: top(document.querySelector('main')),
      };
    });
    expect(creep.body.pad).toBe('0px');
    expect(creep.body.margin).toBe('0px');
    expect(creep.main.pad).toBe('0px');
    expect(creep.main.margin).toBe('0px');
  });

  test('viewport meta keeps viewport-fit=cover (the shell inset contract)', async ({ page }) => {
    const content = await page.evaluate(
      () => document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
    );
    expect(content).toContain('viewport-fit=cover');
  });
});

test.describe('/ background/resume keeps the surface (web analog of the background report)', () => {
  test.beforeEach(async ({ page, context }) => {
    await denyGeolocation(context);
    await page.goto('/');
    await expect(page.getByRole('textbox', SEARCH)).toBeVisible({ timeout: 15_000 });
  });

  test('a visibility cycle never navigates, jumps scroll, or kills input', async ({ page }) => {
    // The list scrolls inside an overflow container, not the window (the
    // same reason search-autohide.spec.ts scrolls "everything scrollable").
    // Scroll every scroller a third of the way in, like a user resting
    // mid-list, then fingerprint each position.
    await page.evaluate(() => {
      const scrollables = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((el) => {
        const oy = window.getComputedStyle(el).overflowY;
        return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1;
      });
      for (const el of scrollables) el.scrollTop = Math.floor(el.scrollHeight / 3);
      // `behavior: 'instant'` — globals.css sets `html { scroll-behavior:
      // smooth }`, so a bare scrollTo ANIMATES; reading positions while the
      // animation is still running fabricates a "jump" that is really the
      // animation finishing (caught on Pixel 7, whose taller viewport gives
      // the longest distance and the slowest settle).
      window.scrollTo({ top: Math.floor(document.body.scrollHeight / 3), behavior: 'instant' });
    });
    // Wait until the scroll position is actually at rest before
    // fingerprinting, so the pin measures the visibility cycle and nothing
    // else.
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __lastY?: number };
        const y = window.scrollY;
        const settled = w.__lastY === y;
        w.__lastY = y;
        return settled;
      },
      undefined,
      { polling: 200, timeout: 5_000 },
    );
    const readPositions = () =>
      page.evaluate(() => {
        const positions = Array.from(document.querySelectorAll<HTMLElement>('*'))
          .filter((el) => {
            const oy = window.getComputedStyle(el).overflowY;
            return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1;
          })
          .map((el) => el.scrollTop);
        return { url: location.pathname, window: window.scrollY, positions };
      });
    const before = await readPositions();
    // The pin below must discriminate: at least one scroller is mid-list.
    expect(Math.max(before.window, ...before.positions)).toBeGreaterThan(0);

    await cycleVisibility(page);

    // With the network fence up no deferred catalog swap can be pending, so
    // resume must be a no-op for the viewport: same route, same positions.
    const after = await readPositions();
    expect(after.url).toBe(before.url);
    expect(Math.abs(after.window - before.window)).toBeLessThanOrEqual(2);
    expect(after.positions.length).toBe(before.positions.length);
    for (let i = 0; i < before.positions.length; i += 1) {
      expect(Math.abs(after.positions[i] - before.positions[i])).toBeLessThanOrEqual(2);
    }

    // Interactivity survives resume: reveal the search bar (scroll to top is
    // a reveal condition for the autohide controller) and filter with it.
    await page.evaluate(() => window.scrollTo(0, 0));
    const search = page.getByRole('textbox', SEARCH);
    await expect(search).toHaveCSS('pointer-events', 'auto', { timeout: 5_000 });
    await search.fill('a');
    await expect(search).toHaveValue('a');
  });
});

test.describe('installed-app resume keeps overlays idempotent', () => {
  test('repeated visibility cycles keep exactly one sign-in dialog', async ({
    page,
    context,
  }) => {
    await installLoopbackFixtures(page);
    await asInstalledApp(context);
    await denyGeolocation(context);
    await page.goto('/');
    const dialogs = page.getByRole('dialog', { name: /sign in to next bar/i });
    await expect(dialogs.first()).toBeVisible({ timeout: 15_000 });

    await cycleVisibility(page);
    await cycleVisibility(page);

    // The resume-defect class this pins: overlays re-mounting per lifecycle
    // event. One dialog, still functional, after two full cycles.
    await expect(dialogs).toHaveCount(1);
    await expect(dialogs.first().getByRole('link', { name: /sign in/i })).toBeVisible();
  });
});
