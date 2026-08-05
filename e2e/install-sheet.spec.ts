/**
 * install-sheet.spec.ts (goal g-43d6da5f crit 1)
 *
 * The iOS "Add to Home Screen" instruction sheet is a bottom sheet on
 * mobile (items-end) — exactly where the fixed BottomNav lives. The nav
 * must never paint over or intercept the sheet's controls. Geometry
 * proof: elementFromPoint at the control's centre resolves to the control
 * itself, the same technique the other bottom-crowded specs pin.
 *
 * iOS-Safari-only surface: the sheet renders only when the UA reads as
 * iPhone Safari, which in this suite means the WebKit projects.
 */

import { test, expect } from '@playwright/test';

test.describe('iOS install sheet vs BottomNav', () => {
  test('sheet controls render above the nav and are genuinely tappable', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'webkit', 'iOS-Safari-only surface');
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Install on iPhone' }).click();
    const dialog = page.getByRole('dialog', { name: 'Install on iPhone' });
    await expect(dialog).toBeVisible();

    const gotIt = dialog.getByRole('button', { name: 'Got it' });
    await expect(gotIt).toBeVisible();
    const hitTarget = await gotIt.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (hit === null) return 'null';
      if (el.contains(hit)) return 'self';
      return hit.closest('nav') !== null ? 'nav' : 'other';
    });
    expect(hitTarget, 'BottomNav paints over the install sheet').toBe('self');

    // The tap genuinely lands: the sheet closes.
    await gotIt.click();
    await expect(dialog).not.toBeVisible();
  });

  test('keyboard contract: focus moves in, Escape closes, focus returns to the opener', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'webkit', 'iOS-Safari-only surface');
    await page.goto('/settings');
    const trigger = page.getByRole('button', { name: 'Install on iPhone' });
    // Keyboard-style open (WebKit does not focus buttons on click — the
    // opener capture needs a genuinely focused trigger, exactly like a
    // keyboard user produces; same pattern as search's keyboard-only test).
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Install on iPhone' });
    await expect(dialog).toBeVisible();
    // Focus lands on the dialog's action, not stranded on the background.
    await expect(dialog.getByRole('button', { name: 'Got it' })).toBeFocused();
    // aria-modal is honest: Tab cannot leave the dialog (single-element trap).
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Got it' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Got it' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    // Focus returns to what opened the sheet.
    await expect(trigger).toBeFocused();
  });
});
