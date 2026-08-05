/**
 * cancel-bottomnav.spec.ts (goal g-2c788c17)
 *
 * Layout OWNERSHIP proof for the two sheet surfaces that end in an
 * Apply/Cancel row above the fixed BottomNav:
 *   - VibeTweak (results surface) owns nav-height + safe-area clearance via
 *     its own bottom padding;
 *   - MapFilterSheet (/map) flows in-document and the page scrolls past the
 *     nav (its footer owns the clearance).
 *
 * The proof demanded by the goal: Apply and Cancel are fully visible, at
 * least 44px, TAPPABLE (elementFromPoint — geometry alone misses paint-over),
 * and their bounding rects are DISJOINT from the nav's; every nav tab stays
 * tappable with the sheet open; Cancel discards the draft and causes no
 * navigation. Runs on iPhone 13, Pixel 7, and the 402x681 project (added to
 * its testMatch — the shortest viewport is where this class of bug lives).
 *
 * Keyboard-open: emulated by shrinking the viewport by a typical mobile
 * keyboard height (~320px) with the /map search input focused. Playwright
 * cannot raise a real IME, and Chromium emulation pins env(safe-area-inset-*)
 * to 0 — the installed-PWA inset case is therefore covered by the CSS
 * ownership pins below (the formulas that reserve the inset), which is the
 * honest limit of emulation and is recorded as such.
 */

import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00');

type Box = { x: number; y: number; width: number; height: number };

function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** A real tap at the element's centre must reach the element (or a child). */
async function tapReaches(page: Page, name: RegExp): Promise<boolean> {
  return page.evaluate(
    (pattern: { source: string; flags: string }) => {
      const re = new RegExp(pattern.source, pattern.flags);
      const candidates = Array.from(document.querySelectorAll('button, a'));
      const el = candidates.find((c) => re.test((c as HTMLElement).innerText ?? ''));
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return el === hit || el.contains(hit);
    },
    { source: name.source, flags: name.flags },
  );
}

async function assertRowClearsNav(page: Page, surface: string) {
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav).toBeVisible();
  const navBox = (await nav.boundingBox())!;

  for (const label of [/^Apply$/, /^Cancel$/]) {
    const control = page.getByRole('button', { name: label });
    await control.scrollIntoViewIfNeeded();
    // globals.css sets `html { scroll-behavior: smooth }`, so geometry read
    // immediately after a scroll can be a mid-animation frame — the exact
    // flake vibe-tweak-reachable.spec.ts already fixed with this settle
    // (santa review: keep the proof reading the RESTING position).
    await page.waitForTimeout(400);
    await expect(control).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.height, `${surface} ${label} height`).toBeGreaterThanOrEqual(44);
    // THE regression assertion: the control's rect and the nav's rect are
    // disjoint — overlap means the nav is painted over the control.
    expect(
      intersects(box, navBox),
      `${surface} ${label} rect intersects BottomNav`,
    ).toBe(false);
    expect(await tapReaches(page, label), `${surface} ${label} not tappable`).toBe(true);
  }

  // Every nav tab stays tappable with the sheet open — the sheet must not
  // paint over the nav any more than the nav may paint over the sheet.
  for (const tab of [/Next Bar\??/i, /^Map$/i, /Rankings/i, /Friends/i, /Settings/i]) {
    const link = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: tab });
    await expect(link.first()).toBeVisible();
    const b = (await link.first().boundingBox())!;
    expect(b.height, `nav tab ${tab}`).toBeGreaterThanOrEqual(44);
  }
}

test.describe('Cancel/BottomNav ownership (g-2c788c17)', () => {
  test('VibeTweak on the results surface: row clears the nav; Cancel discards the draft', async ({
    page,
  }) => {
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();
    await page.getByRole('button', { name: /Tweak the vibe/i }).click();
    await expect(page.getByRole('heading', { name: /Tweak the vibe/i })).toBeVisible();

    await assertRowClearsNav(page, 'VibeTweak');

    // Draft-discard proof: toggle a chip, Cancel, reopen — the chip must be
    // back to its pre-draft state, and Cancel must not navigate.
    const chill = page.getByRole('button', { name: /^Chill\b/ });
    const energyRow = page.getByRole('button', { name: /^Energy\b/ });
    if ((await energyRow.getAttribute('aria-expanded')) !== 'true') {
      await energyRow.click();
    }
    const before = await chill.getAttribute('aria-pressed');
    await chill.click();
    await expect(chill).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');

    const urlBefore = page.url();
    await page.getByRole('button', { name: /^Cancel$/ }).click();
    expect(page.url()).toBe(urlBefore); // no navigation
    await expect(page.getByRole('heading', { name: /Tweak the vibe/i })).toHaveCount(0);

    await page.getByRole('button', { name: /Tweak the vibe/i }).click();
    const energyRow2 = page.getByRole('button', { name: /^Energy\b/ });
    if ((await energyRow2.getAttribute('aria-expanded')) !== 'true') {
      await energyRow2.click();
    }
    await expect(page.getByRole('button', { name: /^Chill\b/ })).toHaveAttribute(
      'aria-pressed',
      before ?? 'false',
    );
  });

  test('MapFilterSheet on /map: row clears the nav at full scroll', async ({ page }) => {
    await page.goto('/map');
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: /Tweak the vibe/i }).click();
    await expect(page.getByTestId('findbar-filters')).toBeVisible();

    await assertRowClearsNav(page, 'MapFilterSheet');

    // Cancel closes the sheet without navigating.
    const urlBefore = page.url();
    await page.getByRole('button', { name: /^Cancel$/ }).click();
    expect(page.url()).toBe(urlBefore);
    await expect(page.getByTestId('findbar-filters')).toHaveCount(0);
  });

  test('keyboard-open emulation on /map: focused input + shrunken viewport keeps the row clear', async ({
    page,
  }) => {
    const original = page.viewportSize()!;
    await page.goto('/map');
    await expect(page.getByRole('link', { name: /Leaflet/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: /Tweak the vibe/i }).click();
    await expect(page.getByTestId('findbar-filters')).toBeVisible();

    // A mobile keyboard occludes ~320px: shrink the viewport to mimic the
    // visual-viewport squeeze while the search input holds focus.
    // type="search" maps to the searchbox role, not textbox.
    await page.getByRole('searchbox', { name: 'Search bars' }).focus();
    await page.setViewportSize({
      width: original.width,
      height: Math.max(320, original.height - 320),
    });
    await assertRowClearsNav(page, 'MapFilterSheet (keyboard)');
    await page.setViewportSize(original);
  });

  test('safe-area ownership formulas are pinned (installed-PWA inset)', async ({ page }) => {
    // Chromium emulation pins env(safe-area-inset-*) to 0, so the installed
    // case cannot be exercised live here. What CAN be pinned: which element
    // OWNS which clearance. The nav owns its own inset padding; VibeTweak
    // owns nav-height + inset clearance in its scrollable padding. If either
    // formula is removed, this fails before a device ever sees it.
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();
    await page.getByRole('button', { name: /Tweak the vibe/i }).click();

    // Computed floors alone are satisfiable by STATIC padding (santa review:
    // swapping the env() formulas for fixed 8px/96px would pass a >= check
    // while losing installed-PWA clearance). Tailwind arbitrary values keep
    // the formula literally in the class attribute, so pin BOTH: the
    // computed floor AND the env() formula's presence in the DOM.
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const navPad = await nav.evaluate((el) => getComputedStyle(el).paddingBottom);
    expect(parseFloat(navPad)).toBeGreaterThanOrEqual(8);
    await expect(nav).toHaveClass(/env\(safe-area-inset-bottom\)/);

    const section = page
      .getByRole('heading', { name: /Tweak the vibe/i })
      .locator('xpath=ancestor::section[1]');
    const sectionPad = await section.evaluate(
      (el) => getComputedStyle(el).paddingBottom,
    );
    expect(parseFloat(sectionPad)).toBeGreaterThanOrEqual(96);
    await expect(section).toHaveClass(/env\(safe-area-inset-bottom\)/);
  });
});
