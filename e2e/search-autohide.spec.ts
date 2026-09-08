/**
 * search-autohide.spec.ts — g-90f908bc regression pin.
 *
 * THE BUG. BarPicker's search input is `sticky top-0` over the ~975-row list
 * on `/`. Pinned and opaque, it covered whatever bar card rested under it —
 * mobile-controls.spec.ts pass 2 failed on all three device projects with
 * "covered by Search bars" for the card straddling the bar at bottom rest.
 *
 * THE FIX. The bar hides (opacity-0 + pointer-events-none, layout preserved)
 * while the user scrolls down, and reveals on scroll-up / near-top / focus.
 *
 * These tests DISCRIMINATE the fix:
 *   1. at bottom rest the bar is transparent to hit-testing and the card
 *      under its slot is genuinely tappable (the exact failing condition);
 *   2. a gentle small-delta scroll-up reveals the bar again (the consult
 *      round's fling trap: per-event delta gating would fail exactly this);
 *   3. the revealed bar still works — filling it filters the list.
 *
 * Assertions are computed-style based (`opacity`), NOT Playwright visibility:
 * an opacity-0 element still counts as "visible" to Playwright, so
 * toBeHidden() would pass before the fix too and discriminate nothing.
 */
import { test, expect, type Page } from './helpers/test';
import { denyGeolocation } from './helpers/geo';

const SEARCH = { name: 'Search bars' };

/** The same bottom-scroll the mobile-controls audit performs. */
async function scrollEverythingToBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scrollables = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((el) => {
      const oy = window.getComputedStyle(el).overflowY;
      return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1;
    });
    for (const el of scrollables) el.scrollTop = el.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  });
}

test.describe('/ search bar auto-hide (g-90f908bc)', () => {
  test.beforeEach(async ({ page, context }) => {
    await denyGeolocation(context);
    await page.goto('/');
    await expect(page.getByRole('textbox', SEARCH)).toBeVisible({ timeout: 15_000 });
  });

  test('scrolled to bottom, the bar yields the tap to the card under it; scroll-up brings it back', async ({
    page,
  }) => {
    const search = page.getByRole('textbox', SEARCH);

    // At the top the bar is fully shown and interactive.
    await expect(search).toHaveCSS('opacity', '1');
    await expect(search).toHaveCSS('pointer-events', 'auto');

    await scrollEverythingToBottom(page);
    // Same settle the audit uses, plus the CSS transition window.
    await expect(search).toHaveCSS('opacity', '0', { timeout: 5_000 });
    await expect(search).toHaveCSS('pointer-events', 'none');

    // THE point of the fix: hit-testing at the bar's own slot must now pass
    // through to the list content resting there — this is the exact condition
    // that failed as "covered by Search bars". What exactly sits at that
    // point varies with the resting alignment (a card button, a divider, a
    // group heading) and none of those are defects; the one hit that must
    // never come back is the search input itself.
    const hitTag = await page.evaluate(() => {
      const input = document.querySelector<HTMLElement>('input[aria-label="Search bars"]');
      if (!input) return 'NO-INPUT';
      const box = input.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      if (!hit) return 'NO-HIT';
      if (hit === input || input.contains(hit)) return 'STILL-THE-INPUT';
      return hit.closest('button') ? 'BAR-ROW-BUTTON' : `LIST-CHROME:${hit.tagName}`;
    });
    expect(hitTag).not.toBe('STILL-THE-INPUT');
    expect(hitTag).not.toBe('NO-INPUT');
    expect(hitTag).not.toBe('NO-HIT');

    // Gentle scroll-up: many 2px steps, none exceeding the old per-event
    // threshold — cumulative direction detection is what must reveal it.
    // Each step is explicit `behavior: 'instant'` with a frame in between:
    // globals.css sets `html { scroll-behavior: smooth }`, so plain scrollTop
    // assignments animate asynchronously and a synchronous loop would read
    // stale positions and collapse to a single -2px move (measured).
    await page.evaluate(async () => {
      const scroller = document.scrollingElement ?? document.documentElement;
      for (let i = 0; i < 10; i++) {
        scroller.scrollTo({ top: scroller.scrollTop - 2, behavior: 'instant' });
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      }
    });
    await expect(search).toHaveCSS('opacity', '1', { timeout: 5_000 });
    await expect(search).toHaveCSS('pointer-events', 'auto');
  });

  test('the revealed bar is not decorative: filling it after the round-trip filters the list', async ({
    page,
  }) => {
    const search = page.getByRole('textbox', SEARCH);
    await scrollEverythingToBottom(page);
    await expect(search).toHaveCSS('opacity', '0', { timeout: 5_000 });

    // Reveal by scrolling back up, then use it.
    await page.evaluate(() => {
      const scroller = document.scrollingElement ?? document.documentElement;
      scroller.scrollTop = 0;
    });
    await expect(search).toHaveCSS('opacity', '1', { timeout: 5_000 });
    await search.fill('Attaboy');
    await expect(page.getByRole('button', { name: /Attaboy/ })).toBeVisible();
    // Focus pins it: still shown even though a fill scrolled/typed.
    await expect(search).toHaveCSS('opacity', '1');
  });
});
