/**
 * want-to-go-writers.spec.ts (goal g-8557db39)
 *
 * The Want-to-Go list had ZERO production writers after /discover was
 * archived (see src/lib/wantToGo.ts) — it could only shrink. These specs
 * pin the restored writers on the two surfaces where a user meets a bar:
 * the Next Bar result card and the map detail lightbox. Both write through
 * the same shared persistence (useWantToGo → lib/wantToGo), so a saved bar
 * shows up on the /rankings Want-to-go tab.
 *
 * Fixed clock (Fri 11pm) for the same reason as one-results-view: live
 * surfaces hard-filter known-closed bars, so counts are only deterministic
 * under a mocked clock.
 */

import { test, expect, type Page } from '@playwright/test';
import { denyGeolocation } from './helpers/geo';

const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00');

const cardsOf = (page: Page) =>
  page.locator('article').filter({ hasText: /Vibe match/i });

async function gotoResults(page: Page): Promise<void> {
  await denyGeolocation(page.context());
  await page.clock.setFixedTime(FRIDAY_NIGHT);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
  await page.getByRole('button', { name: /Attaboy/ }).click();
  await expect(cardsOf(page).first()).toBeVisible();
}

test.describe('Want to go — result card writer', () => {
  test('saving from a result card persists to the Want-to-go tab, and unsaving removes it', async ({
    page,
  }) => {
    await gotoResults(page);
    const firstCard = cardsOf(page).first();
    const heading = await firstCard.getByRole('heading').first().innerText();
    // Card headings read "1. Bar Name" — strip the rank prefix.
    const barName = heading.replace(/^\d+\.\s*/, '').trim();

    const save = firstCard.getByRole('button', { name: /^Save .* to Want to go$/ });
    await expect(save).toBeVisible();
    await expect(save).toHaveAttribute('aria-pressed', 'false');

    const urlBefore = page.url();
    await save.click();

    // NEGATIVE assertions (CLAUDE.md interaction rule): saving must not
    // navigate and must not close/replace the results surface.
    expect(page.url()).toBe(urlBefore);
    await expect(cardsOf(page).first()).toBeVisible();

    // The control flips to the saved state in place.
    const saved = firstCard.getByRole('button', { name: /^Remove .* from Want to go$/ });
    await expect(saved).toHaveAttribute('aria-pressed', 'true');

    // It really persisted: the Want-to-go tab on /rankings lists it.
    await page.goto('/rankings');
    await page.getByRole('button', { name: /Want to go/i }).first().click();
    await expect(page.getByText(barName, { exact: false }).first()).toBeVisible();

    // Unsaving from the card removes it again (round-trip). Re-enter the
    // results flow rather than goBack(): results are component state on
    // `/`, so history-back lands on an empty home, not this surface.
    await gotoResults(page);
    const savedToggle = cardsOf(page)
      .first()
      .getByRole('button', { name: /^Remove .* from Want to go$/ });
    // The saved state SURVIVED a full page load — that is the persistence
    // proof; the earlier rankings check proved the shared read path.
    await expect(savedToggle).toBeVisible();
    await savedToggle.click();
    await expect(
      cardsOf(page).first().getByRole('button', { name: /^Save .* to Want to go$/ }),
    ).toHaveAttribute('aria-pressed', 'false');

    // And it is gone from the Want-to-go tab.
    await page.goto('/rankings');
    await page.getByRole('button', { name: /Want to go/i }).first().click();
    await expect(page.getByText(barName, { exact: false })).toHaveCount(0);
  });

  test('the toggle is a 44px touch target with a state-bearing accessible name', async ({
    page,
  }) => {
    await gotoResults(page);
    const toggle = cardsOf(page)
      .first()
      .getByRole('button', { name: /Want to go$/ });
    const box = await toggle.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    // Accessible name carries STATE (Save… / Remove…), not a bare label.
    await expect(toggle).toHaveAccessibleName(/^(Save|Remove) .* Want to go$/);
  });
});

test.describe('Want to go — map detail writer', () => {
  test('saving from the bar lightbox persists and does NOT close the dialog', async ({
    page,
  }) => {
    await gotoResults(page);
    // The lightbox is reachable from a result card's photo tile.
    const opener = cardsOf(page)
      .first()
      .getByRole('button', { name: /See photos and hours for/i });
    await opener.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const save = dialog.getByRole('button', { name: /^Save .* to Want to go$/ });
    await expect(save).toBeVisible();
    const urlBefore = page.url();
    await save.click();

    // NEGATIVE assertions: saving inside the dialog must not navigate and
    // must not dismiss the dialog.
    expect(page.url()).toBe(urlBefore);
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: /^Remove .* from Want to go$/ }),
    ).toHaveAttribute('aria-pressed', 'true');

    // The result card UNDERNEATH is still mounted (the lightbox is its
    // sibling) — its toggle must follow the dialog's write without a
    // remount (santa: Claude+Codex convergent). Close the dialog and check
    // the card without navigating.
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    expect(page.url()).toBe(urlBefore);
    await expect(
      cardsOf(page).first().getByRole('button', { name: /Want to go$/ }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
