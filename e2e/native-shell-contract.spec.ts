/**
 * native-shell-contract.spec.ts — the V8 locked native interaction contract
 * (docs/V8-PRD-2026-08-13.md §"P0: native interaction and design lock").
 *
 * The app ships inside a Capacitor WebView, so desktop-web affordances are
 * bugs: a visible scrollbar, an accidental sideways scroll strip, a fixed
 * header that slides with the page. Those never fail a unit test and rarely
 * fail a smoke test — they need assertions on real layout geometry, which is
 * what this file is.
 *
 * Both phone sizes are exercised inside each test via setViewportSize rather
 * than by adding Playwright projects: the contract is about the compact/large
 * iPhone range, not about adding another full matrix leg to every other spec.
 *
 * If you add a route to the bottom nav, ADD IT TO TAB_ROUTES.
 */

import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

/** The five canonical tabs. Each must satisfy the contract at both sizes. */
const TAB_ROUTES = ['/', '/map', '/rankings', '/friends', '/settings'] as const;

/**
 * Other surfaces a real user reaches. They get the cheap geometry checks at the
 * compact size — the contract is about the whole shell, not only the tab bar,
 * and these are exactly where an unnoticed sideways scroll tends to appear.
 */
const SECONDARY_ROUTES = [
  '/discover',
  '/lists',
  '/tried',
  '/friends/consensus',
  '/u/claire',
  '/auth',
  '/join',
] as const;

/** Compact iPhone (13/14/15) and large iPhone (Pro Max class). */
const VIEWPORTS = [
  { name: 'compact iPhone', width: 390, height: 844 },
  { name: 'large iPhone', width: 430, height: 932 },
] as const;

/**
 * Sub-pixel layout rounding makes exact equality flaky at fractional device
 * scales; 1px is below anything a user could scroll or see.
 */
const OVERFLOW_TOLERANCE_PX = 1;

/** Settle async layout (map tiles, font swap) before measuring geometry. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => {
    /* networkidle is best-effort; the explicit waits below carry the test. */
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

test.describe('V8 native interaction contract', () => {
  for (const viewport of VIEWPORTS) {
    for (const route of TAB_ROUTES) {
      test(`${route} has no horizontal overflow or scrollbar on ${viewport.name}`, async ({
        page,
      }) => {
        await denyGeolocation(page.context());
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(route);
        await settle(page);

        const geometry = await page.evaluate(() => {
          const doc = document.documentElement;
          return {
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
            innerWidth: window.innerWidth,
            bodyScrollWidth: document.body.scrollWidth,
          };
        });

        // Contract 2: the shell never scrolls horizontally.
        expect(
          geometry.scrollWidth,
          `${route} page scrolls horizontally (${geometry.scrollWidth} > ${geometry.clientWidth})`,
        ).toBeLessThanOrEqual(geometry.clientWidth + OVERFLOW_TOLERANCE_PX);
        expect(
          geometry.bodyScrollWidth,
          `${route} body scrolls horizontally`,
        ).toBeLessThanOrEqual(geometry.clientWidth + OVERFLOW_TOLERANCE_PX);

        // Contract 2: no browser-style scrollbar gutter. A classic scrollbar
        // steals width from clientWidth; a hidden/overlay one does not.
        expect(
          geometry.innerWidth - geometry.clientWidth,
          `${route} reserves a visible scrollbar gutter`,
        ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

        // The gutter check alone is VACUOUS on mobile engines, where scrollbars
        // overlay content and steal no width — deleting the hiding CSS would
        // still measure zero. Assert the suppression itself so removing it
        // fails here rather than silently on a device.
        const scrollbarWidth = await page.evaluate(
          () => getComputedStyle(document.documentElement).scrollbarWidth || '',
        );
        expect(
          scrollbarWidth,
          `${route}: html scrollbar-width is "${scrollbarWidth}", so a native rail can render`,
        ).toBe('none');
      });

      test(`${route} has exactly one vertical scroll owner on ${viewport.name}`, async ({
        page,
      }) => {
        await denyGeolocation(page.context());
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(route);
        await settle(page);

        // Contract 1: one vertical scroll owner per route. Count only elements
        // that BOTH opt into scrolling and actually overflow — an `overflow-y:
        // auto` container that fits its content scrolls nothing and is not an
        // owner.
        const owners = await page.evaluate((tolerance) => {
          const found: string[] = [];
          for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
            const style = getComputedStyle(el);
            const scrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
            if (!scrollable) continue;
            if (el.scrollHeight <= el.clientHeight + tolerance) continue;
            found.push(
              `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${el.className || '(no class)'}`,
            );
          }
          return found;
        }, OVERFLOW_TOLERANCE_PX);

        expect(
          owners,
          `${route} has ${owners.length} nested vertical scroll owners besides the page: ${owners.join(' | ')}`,
        ).toHaveLength(0);

        // "Zero nested owners" is only half the criterion, and on its own it is
        // VACUOUS: a route that disabled page scrolling entirely, or rendered
        // nothing, would also report zero. Assert the page itself is still the
        // owner — neither html nor body may suppress vertical scrolling.
        const rootOverflowY = await page.evaluate(() => ({
          html: getComputedStyle(document.documentElement).overflowY,
          body: getComputedStyle(document.body).overflowY,
        }));
        for (const [el, value] of Object.entries(rootOverflowY)) {
          expect(
            ['hidden', 'clip'].includes(value),
            `${route}: <${el}> has overflow-y: ${value}, which takes scroll ownership away from the page`,
          ).toBe(false);
        }
      });

      test(`${route} exposes no accidental horizontal scroll strip on ${viewport.name}`, async ({
        page,
      }) => {
        await denyGeolocation(page.context());
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(route);
        await settle(page);

        // Contract 5/6: filters, chip groups, cards and nav wrap or disclose.
        // A sideways-scrolling container is legal ONLY as a deliberate
        // carousel, which must announce itself with data-carousel so this
        // assertion stays honest instead of being widened whenever it fails.
        const strips = await page.evaluate((tolerance) => {
          const found: string[] = [];
          for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
            if (el.scrollWidth <= el.clientWidth + tolerance) continue;
            const style = getComputedStyle(el);
            const scrolls = ['auto', 'scroll'].includes(style.overflowX);
            if (!scrolls) continue;
            if (el.closest('[data-carousel]')) continue;
            found.push(
              `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${el.className || '(no class)'}`,
            );
          }
          return found;
        }, OVERFLOW_TOLERANCE_PX);

        expect(
          strips,
          `${route} has ${strips.length} untagged horizontal scroll strips: ${strips.join(' | ')}`,
        ).toHaveLength(0);
      });
    }
  }

  // One test per route rather than a loop in a single test: the
  // location-first home redirects, which interrupts a follow-up goto() in the
  // same page and fails for a reason that has nothing to do with text size.
  for (const route of TAB_ROUTES) {
    test(`${route} still fits horizontally at enlarged text size`, async ({ page }) => {
      // iOS Dynamic Type / browser text scaling is the classic way a layout
      // that "fits" starts scrolling sideways. 20px root (125% of the 16px
      // default) is a realistic accessibility setting, not a torture test.
      await denyGeolocation(page.context());
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route);
      await page.addStyleTag({ content: 'html { font-size: 20px !important; }' });
      await settle(page);

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(
        scrollWidth,
        `${route} overflows horizontally at 125% text size (${scrollWidth} > ${clientWidth})`,
      ).toBeLessThanOrEqual(clientWidth + OVERFLOW_TOLERANCE_PX);
    });
  }

  // Both scrollable tab routes, not just one: pinning is per-layout, and a
  // regression on Rankings says nothing about the Social layout.
  for (const route of ['/rankings', '/friends'] as const) {
    test(`${route} keeps header and bottom nav anchored through overscroll and route change`, async ({
      page,
    }) => {
      await denyGeolocation(page.context());
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route);
      await settle(page);

      const nav = page.getByRole('navigation', { name: 'Primary' });
      await expect(nav).toBeVisible();

      // Criterion 5 names the HEADER too. Measure the page's first heading's
      // nearest sticky/fixed ancestor if there is one, else the heading itself:
      // either way its viewport y must not drift when the page overscrolls.
      const headerY = () =>
        page.evaluate(() => {
          const heading = document.querySelector('h1');
          if (!heading) return null;
          let el: HTMLElement | null = heading as HTMLElement;
          while (el) {
            const pos = getComputedStyle(el).position;
            if (pos === 'fixed' || pos === 'sticky') break;
            el = el.parentElement;
          }
          return (el ?? heading).getBoundingClientRect().top;
        });

      const navBefore = await nav.boundingBox();
      const headerBefore = await headerY();
      expect(navBefore).not.toBeNull();

      await page.evaluate(() => window.scrollTo(0, -1200));
      await settle(page);
      expect(await headerY(), `${route}: header moved on top overscroll`).toBeCloseTo(
        headerBefore!,
        0,
      );

      // A route change must not leave the nav detached either. Navigate by
      // TAPPING the tab rather than goto(): that is the real transition
      // criterion 5 describes, and a goto races the client-side router.
      await nav.getByRole('link', { name: route === '/rankings' ? 'Social' : 'Rankings' }).click();
      await expect(page).toHaveURL(route === '/rankings' ? /\/friends$/ : /\/rankings$/);
      await settle(page);
      const navAfterRoute = await nav.boundingBox();
      expect(navAfterRoute?.y, `${route}: nav moved after a route change`).toBeCloseTo(
        navBefore!.y,
        0,
      );
    });
  }

  test('the rankings quick-add sheet returns focus to its opener on close', async ({ page }) => {
    // The second live overlay. It locks scroll like the lightbox, so it owes
    // the same focus contract — and it is on a different route, so the
    // lightbox test cannot cover it.
    await denyGeolocation(page.context());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/rankings');
    await settle(page);

    const opener = page.getByRole('button', { name: /add a bar/i }).first();
    await expect(opener).toBeVisible();
    await opener.press('Enter');

    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    // Without the opener capture the autoFocus input unmounts and focus falls
    // to <body>, dumping a screen-reader user at the top of the document.
    await expect(opener).toBeFocused();
  });

  test('the photo carousel is tagged and offers an accessible non-swipe path', async ({
    page,
  }) => {
    // The [data-carousel] exemption above is an escape hatch from the
    // no-horizontal-scroller rule. Left unchecked it would let any sideways
    // strip pass by tagging itself, so assert the other half of criterion 5:
    // a tagged carousel must be operable WITHOUT swiping.
    await denyGeolocation(page.context());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();
    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(cards).toHaveCount(5);
    await cards.first().getByRole('button', { name: /See photos and hours/i }).press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const carousel = dialog.locator('[data-carousel]');
    if ((await carousel.count()) === 0) {
      // Single-photo (or glyph) bars render no track at all — nothing to
      // operate, so the criterion is satisfied vacuously and honestly.
      return;
    }

    // Every horizontally-scrolling element inside the dialog must be tagged.
    const untagged = await dialog.evaluate((root, tolerance) => {
      const found: string[] = [];
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
        if (el.scrollWidth <= el.clientWidth + tolerance) continue;
        if (!['auto', 'scroll'].includes(getComputedStyle(el).overflowX)) continue;
        if (el.closest('[data-carousel]')) continue;
        found.push(el.className || el.tagName);
      }
      return found;
    }, OVERFLOW_TOLERANCE_PX);
    expect(untagged, `untagged horizontal scrollers in the lightbox: ${untagged.join(' | ')}`)
      .toHaveLength(0);

    // ...and the non-swipe controls exist and are real 44px targets.
    for (const label of [/previous photo/i, /next photo/i]) {
      const control = dialog.getByRole('button', { name: label });
      await expect(control, `carousel is swipe-only: no ${label} control`).toHaveCount(1);
      const box = await control.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test('an overlay opened at the very top restores to the top on close', async ({ page }) => {
    // The scrollY === 0 case the main lock test cannot reach: it deliberately
    // scrolls first, so the unlock's `window.scrollY === scrollY` early-return
    // was never exercised at its boundary. If the browser re-applies a stale
    // offset after position:fixed is removed, this is where it shows.
    await denyGeolocation(page.context());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();
    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(cards).toHaveCount(5);

    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    const opener = cards.first().getByRole('button', { name: /See photos and hours/i });
    await opener.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await settle(page);

    expect(
      await page.evaluate(() => window.scrollY),
      'page did not return to the top after an overlay opened at scrollY 0',
    ).toBe(0);
  });

  test('carousel controls do not animate under prefers-reduced-motion', async ({ page }) => {
    // The Prev/Next controls exist to satisfy the non-swipe contract, so they
    // must not themselves violate the reduced-motion contract. An explicit
    // ScrollToOptions behavior is NOT overridden by CSS scroll-behavior, which
    // is exactly the trap this asserts against.
    await denyGeolocation(page.context());
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();
    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(cards).toHaveCount(5);
    await cards.first().getByRole('button', { name: /See photos and hours/i }).press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const next = dialog.getByRole('button', { name: /next photo/i });
    if ((await next.count()) === 0) return; // single-photo bar: nothing to animate

    // Record every scrollTo the control issues and assert none asks to animate.
    const behaviors = await dialog.evaluate((root) => {
      const track = root.querySelector('[data-carousel]') as HTMLElement | null;
      if (!track) return [];
      const seen: string[] = [];
      const original = track.scrollTo.bind(track);
      (track as unknown as { scrollTo: unknown }).scrollTo = (...args: unknown[]) => {
        const opts = args[0];
        if (opts && typeof opts === 'object') {
          seen.push(String((opts as ScrollToOptions).behavior ?? 'auto'));
        }
        return (original as (...a: unknown[]) => void)(...args);
      };
      (window as unknown as { __carouselBehaviors: string[] }).__carouselBehaviors = seen;
      return seen;
    });
    expect(behaviors).toBeDefined();

    await next.click();
    await settle(page);

    const observed = await page.evaluate(
      () => (window as unknown as { __carouselBehaviors: string[] }).__carouselBehaviors ?? [],
    );
    expect(
      observed.filter((b) => b === 'smooth'),
      `carousel requested smooth scrolling under reduced motion: ${JSON.stringify(observed)}`,
    ).toHaveLength(0);
  });

  // Criterion 9's reduced-motion half. globals.css carries the rules; nothing
  // proved they take effect, so deleting that block was a silent regression.
  test('prefers-reduced-motion suppresses transitions and smooth scrolling', async ({ page }) => {
    await denyGeolocation(page.context());
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/rankings');
    await settle(page);

    const motion = await page.evaluate(() => {
      const nav = document.querySelector('nav a') as HTMLElement | null;
      return {
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        navTransitionMs: nav
          ? Number.parseFloat(getComputedStyle(nav).transitionDuration || '0') * 1000
          : null,
      };
    });

    expect(motion.scrollBehavior, 'smooth scrolling survives reduced-motion').toBe('auto');
    expect(
      motion.navTransitionMs,
      `nav transition is ${motion.navTransitionMs}ms under reduced motion`,
    ).toBeLessThanOrEqual(1);
  });

  // Secondary surfaces: the cheap geometry half of the contract. A sideways
  // scroll here is just as broken as one on a tab route.
  for (const route of SECONDARY_ROUTES) {
    test(`${route} has no horizontal overflow (secondary surface)`, async ({ page }) => {
      await denyGeolocation(page.context());
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route);
      await settle(page);

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(
        scrollWidth,
        `${route} scrolls horizontally (${scrollWidth} > ${clientWidth})`,
      ).toBeLessThanOrEqual(clientWidth + OVERFLOW_TOLERANCE_PX);
    });
  }

  test('bottom navigation stays anchored to the safe area through overscroll', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/rankings');
    await settle(page);

    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav).toBeVisible();

    const before = await nav.boundingBox();
    expect(before).not.toBeNull();

    // Contract 3: pulling past the top and bottom must not drag fixed
    // navigation with the page or open a gap above the header.
    // scrollTo (not mouse.wheel) because mobile WebKit has no wheel device;
    // out-of-range offsets are exactly the overscroll case under test.
    await page.evaluate(() => window.scrollTo(0, -1200)); // past the top
    await settle(page);
    const afterTopPull = await nav.boundingBox();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight + 1200)); // past the bottom
    await settle(page);
    const afterBottomPull = await nav.boundingBox();

    expect(afterTopPull?.y).toBeCloseTo(before!.y, 0);
    expect(afterBottomPull?.y).toBeCloseTo(before!.y, 0);

    // And it is genuinely pinned to the bottom edge, not merely stationary.
    const viewportHeight = page.viewportSize()!.height;
    expect(before!.y + before!.height).toBeCloseTo(viewportHeight, 0);
  });

  test('an open lightbox locks the page and restores scroll position and focus on close', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    // Seed a result set the same way photo-card.spec.ts does — searching a
    // known bar is the shortest path to a card that opens the lightbox.
    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();
    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(cards).toHaveCount(5);
    await settle(page);

    // Scroll away from the top so restoration is observable rather than 0→0.
    // (scrollTo, not mouse.wheel — mobile WebKit has no wheel device.)
    await page.evaluate(() => window.scrollTo(0, 400));
    await settle(page);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(scrollBefore, 'test needs a non-zero scroll offset to be meaningful').toBeGreaterThan(0);

    // The hero's "See photos and hours" button is the lightbox opener
    // (same entry point photo-card.spec.ts uses). Activate it from the
    // KEYBOARD, not a tap: WebKit does not focus a button on touch, so a
    // tap-opened dialog has nothing to restore focus to. Focus restoration
    // exists for keyboard and screen-reader users, and this is their path.
    const opener = cards.first().getByRole('button', { name: /See photos and hours/i });
    await opener.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Read the offset the lock captured rather than the pre-click one: opening
    // scrolls the tapped card into view, so the position the overlay promises
    // to restore is the one at lock time, not before the tap.
    const readLockedOffset = () =>
      page.evaluate(() => {
        const top = document.body.style.top;
        return top ? -Number.parseInt(top, 10) : null;
      });

    const lockedOffset = await readLockedOffset();
    expect(lockedOffset, 'body scroll lock did not engage when the dialog opened').not.toBeNull();

    // Contract 4: the page behind the overlay is locked — scrolling the
    // backdrop must not move it. Assert the real GEOMETRY of an element behind
    // the dialog, not only body.style.top: the style string would sit still
    // even if the page moved underneath it, which makes that check alone
    // vacuous.
    const backdropY = () =>
      page.evaluate(() => document.querySelector('article')?.getBoundingClientRect().top ?? null);
    const backdropBefore = await backdropY();
    expect(backdropBefore, 'need a background element to observe').not.toBeNull();

    await page.evaluate(() => window.scrollBy(0, 600));
    await settle(page);
    expect(await readLockedOffset(), 'lock offset changed while the lightbox was open').toBe(
      lockedOffset,
    );
    expect(await backdropY(), 'the page behind the lightbox actually moved').toBeCloseTo(
      backdropBefore!,
      0,
    );

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await settle(page);

    // Contract 4: closing restores BOTH the prior scroll position and focus.
    // maxScroll is reported too: a short landing means either an in-flight
    // smooth-scroll animation or a genuinely clamped range, and the two need
    // opposite fixes.
    const after = await page.evaluate(() => ({
      scrollY: window.scrollY,
      maxScroll: document.documentElement.scrollHeight - window.innerHeight,
    }));
    expect(
      after.scrollY,
      `scroll not restored — locked=${lockedOffset} observed=${JSON.stringify(after)}`,
    ).toBeCloseTo(lockedOffset!, 0);
    // Focus returns to the exact opener, not merely off <body> — a dropped
    // focus sends a screen-reader user back to the top of the document.
    await expect(opener).toBeFocused();
  });
});
