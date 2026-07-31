import { expect, test } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

// Fixed clock (Fri 11pm) for the same reason the other home specs use one: the
// live surfaces hard-filter known-closed bars, so the results view is only
// deterministic under a mocked clock.
const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00');

/** Reach the results surface, which is where "Tweak the vibe" lives. */
async function openResults(page: import('@playwright/test').Page) {
  await denyGeolocation(page.context());
  await page.clock.setFixedTime(FRIDAY_NIGHT);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
  await page.getByRole('button', { name: /Attaboy/ }).click();
  await expect(page.getByRole('button', { name: /Tweak the vibe/i })).toBeVisible();
}

/**
 * Goal g-44007df6, acceptance criterion 5.
 *
 * VibeTweak's Apply/Cancel row is the LAST child of a scrolling section, and
 * BottomNav is `fixed bottom-0 z-[1000]` with a raised centre button that
 * extends ~28px above the bar. With no bottom clearance those two buttons sat
 * underneath the nav on a short viewport and could not be tapped at all — the
 * user could change their vibe and then have no way to confirm it.
 *
 * Geometry alone is not enough to catch this: a button can be inside the
 * viewport and still be un-tappable because something is painted on top. So the
 * assertion is `elementFromPoint` at the button's centre, which is what a tap
 * actually does. Run at rest, scrolled to the bottom, which is where the row
 * naturally sits.
 *
 * The `iPhone 17` project is 402x681 — the compact viewport named in the goal.
 * This spec is viewport-agnostic and runs on every configured project.
 */

/** Does a real tap at this element's centre reach the element itself? */
async function tapReaches(page: import('@playwright/test').Page, name: RegExp) {
  return page.evaluate((pattern) => {
    const re = new RegExp(pattern, 'i');
    const el = Array.from(document.querySelectorAll('button')).find((b) =>
      re.test((b.textContent || '').trim()),
    );
    if (!el) return { found: false as const };
    const box = el.getBoundingClientRect();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const blocker =
      hit === null
        ? 'nothing'
        : (hit as HTMLElement).getAttribute?.('aria-label') ||
          (hit as HTMLElement).className ||
          hit.tagName;
    return {
      found: true as const,
      // Fully inside the viewport, both edges — not just the centre.
      insideViewport: box.top >= 0 && box.bottom <= window.innerHeight,
      reached: hit !== null && (hit === el || el.contains(hit) || hit.contains(el)),
      blocker: String(blocker).slice(0, 60),
      box: { top: Math.round(box.top), bottom: Math.round(box.bottom) },
      viewportH: window.innerHeight,
    };
  }, name.source);
}

/** Drive the real scroller — `window.scrollTo` is a no-op here (inner container). */
async function scrollToBottom(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      if (el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
    }
  });
  await page.waitForTimeout(400);
}

test.describe('VibeTweak actions clear the fixed bottom nav', () => {
  test('Apply and Cancel are fully visible and actually tappable at rest', async ({ page }) => {
    await openResults(page);
    await page.getByRole('button', { name: /Tweak the vibe/i }).click();

    // The surface is up.
    await expect(page.getByRole('button', { name: /^Apply$/i })).toBeVisible();

    await scrollToBottom(page);

    for (const label of [/^Apply$/, /^Cancel$/]) {
      const r = await tapReaches(page, label);
      expect(r.found, `${label} button not found`).toBe(true);
      if (!r.found) continue;

      expect(
        r.insideViewport,
        `${label} is not fully inside the viewport: top=${r.box.top} bottom=${r.box.bottom} viewportH=${r.viewportH}`,
      ).toBe(true);

      expect(
        r.reached,
        `${label} is covered by "${r.blocker}" — a tap at its centre hits that instead. ` +
          `This is the bug: the button is on screen but not usable.`,
      ).toBe(true);
    }
  });

  test('Cancel actually dismisses the surface and does NOT change the URL', async ({ page }) => {
    await openResults(page);
    const before = page.url();
    await page.getByRole('button', { name: /Tweak the vibe/i }).click();
    await expect(page.getByRole('button', { name: /^Cancel$/i })).toBeVisible();

    await scrollToBottom(page);
    await page.getByRole('button', { name: /^Cancel$/i }).click();

    // Negative assertions — the class of bug unit tests miss (CLAUDE.md).
    await expect(page.getByRole('button', { name: /^Apply$/i })).toHaveCount(0);
    expect(page.url()).toBe(before);
  });
});
