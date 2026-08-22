/**
 * venue-tags.spec.ts — V8-5: at most five customer-facing tags at the bottom
 * of the bar lightbox (docs/V8-PRD-2026-08-13.md §"P1: venue presentation and
 * expansion", docs/V8-CHECKLIST-2026-08-13.md §2).
 *
 * The priority rule itself is proved in src/lib/tagDisplay.test.ts — that is a
 * pure function and belongs in a unit test. What only a browser can answer is
 * whether the chips actually land at the BOTTOM of the lightbox, stay off the
 * result card, and don't reintroduce the sideways scroll strip the goal-1
 * overflow contract forbids. Both phone sizes are exercised via the config's
 * iPhone 13 / Pixel 7 projects, so every assertion here is viewport-agnostic.
 */

import { test, expect, type Page } from '@playwright/test';
// catalogTest serves the FULL bars catalog from a mocked Supabase route, so a
// named venue's tag set is fixed rather than whatever the emergency core set
// happens to hold.
import { test as catalogTest } from './helpers/catalogTest';
import { denyGeolocation } from './helpers/geo';
import { bars } from '../src/lib/bars';
import { displayTag, topVenueTags } from '../src/lib/tagDisplay';

const OVERFLOW_TOLERANCE_PX = 1;

// Fixed clock (Fri 11pm local), the same pattern photo-card.spec.ts and
// one-results-view.spec.ts use: the results surface hard-filters KNOWN-closed
// bars, so an exact-count assertion is only deterministic under a mocked
// clock. Without this the toHaveCount(5) below passes on a Friday evening and
// fails on a Sunday morning — a flake, and the goal requires zero retries.
const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00');

async function openLightbox(page: Page) {
  await denyGeolocation(page.context());
  await page.clock.setFixedTime(FRIDAY_NIGHT);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
  await page.getByRole('button', { name: /Attaboy/ }).click();
  const cards = page.locator('article').filter({ hasText: /Vibe match/i });
  await expect(cards).toHaveCount(5);
  await cards.first().getByRole('button', { name: /See photos and hours/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // The Hours card is client-only state: BarLightbox sets `rows` in its mount
  // effect and renders `{rows ? <hours> : null}` (src/components/BarLightbox.tsx:114-124,
  // 307). So "dialog is visible" is NOT "dialog is laid out" — the card is
  // inserted a frame or two later and pushes everything below it down.
  //
  // Every geometry assertion in this file reads a boundingBox against that
  // layout. Measured 2026-08-18 on Pixel 7 under the release gate: tags at
  // y=193.5 (pre-insert) compared against hours at y=210.5 (post-insert), and
  // the bottom-of-lightbox assertion failed on a stale number while the DOM
  // order was correct all along. Worse is the silent direction — read a moment
  // earlier and the Hours heading has count 0, so the check skips itself and
  // the test passes having proved nothing.
  //
  // Wait for the dialog's own height to stop changing rather than for the
  // Hours card specifically: whether a bar HAS hours differs by fixture, so
  // waiting on the card would hang for the ones that legitimately never show
  // it. Bounded and best-effort — a dialog that never settles must fail on a
  // real assertion, not here.
  await dialog
    .evaluate(
      (el) =>
        new Promise<void>((resolve) => {
          let last = -1;
          let stable = 0;
          const tick = (): void => {
            const h = el.scrollHeight;
            if (h === last) stable += 1;
            else {
              last = h;
              stable = 0;
            }
            if (stable >= 2) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {
      /* see above */
    });
  return dialog;
}

test.describe('venue tags in the bar lightbox', () => {
  test('shows at most five tags, and never a raw enum or the word "pricey"', async ({
    page,
  }) => {
    const dialog = await openLightbox(page);
    const chips = dialog.locator('[data-venue-tags] li');

    const count = await chips.count();
    expect(count, 'the lightbox renders no tags at all').toBeGreaterThan(0);
    expect(count, 'more than five tags reached the lightbox').toBeLessThanOrEqual(5);

    const labels = await chips.allInnerTexts();
    for (const label of labels) {
      // displayTag() output is human-cased; a raw kebab enum means some render
      // site bypassed it.
      expect(label).not.toMatch(/^[a-z0-9]+(-[a-z0-9]+)+$/);
      expect(label.toLowerCase()).not.toContain('pricey');
      // Price is already in the eyebrow — a "$$" chip would just repeat it.
      expect(label.trim()).not.toMatch(/^\$+$/);
    }
  });

  test('tags sit at the bottom of the lightbox, below the hours and above the actions', async ({
    page,
  }) => {
    const dialog = await openLightbox(page);
    const tags = dialog.locator('[data-venue-tags]');
    await expect(tags).toHaveCount(1);

    // The hours card renders only for bars that carry hours — the emergency
    // core set used offline does not. Check for it rather than waiting on it
    // (boundingBox() would block until the 30s test timeout); when it IS
    // there, the tags must come after it.
    //
    // Read hours FIRST and the things it MOVES second. Written the other way
    // round this compared a tags.y captured before the Hours card mounted
    // against an hours.y captured after — 193.5 vs 210.5 on Pixel 7,
    // 2026-08-18, a failure with the DOM order correct all along. Hours is the
    // only late arrival here (it is client-only state, BarLightbox.tsx:114-124),
    // so measuring it first makes the comparison self-consistent whichever
    // side of the mount the reads land on.
    const hours = dialog.getByRole('heading', { name: 'Hours' });
    const hoursBox = (await hours.count()) > 0 ? await hours.boundingBox() : null;

    const tagsBox = await tags.boundingBox();
    const actionBox = await dialog.getByRole('link', { name: /Want to go/i }).boundingBox();

    expect(tagsBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    if (hoursBox) {
      expect(
        tagsBox!.y,
        'tags render above the hours card instead of at the bottom',
      ).toBeGreaterThan(hoursBox.y);
    }
    expect(
      tagsBox!.y,
      'tags render below the action row — the approved design keeps the actions last',
    ).toBeLessThan(actionBox!.y);
  });

  // The priority ORDER is proved as a unit in src/lib/tagDisplay.test.ts, but
  // nothing there notices if the COMPONENT renders the right five in the wrong
  // order — reversing venueTags before .map() keeps every unit test green.
  // So compare the rendered labels against what the real rule returns for
  // whichever venue the lightbox opened. catalogTest serves the full `bars`
  // catalog, so the imported array is the same data the app rendered.
  // openLightbox takes a Page, so it works under either fixture — no need to
  // re-inline the seed steps here.
  catalogTest('renders exactly what the priority rule returns, in order', async ({ page }) => {
    const dialog = await openLightbox(page);

    const name = await dialog.getByRole('heading', { level: 2 }).innerText();
    const bar = bars.find((candidate) => candidate.name === name);
    expect(bar, `lightbox opened "${name}", which is not in the served catalog`).toBeTruthy();

    const expected = topVenueTags(bar!.tags).map(displayTag);
    expect(expected.length, 'fixture bar carries no displayable tags').toBeGreaterThan(0);
    await expect(dialog.locator('[data-venue-tags] li')).toHaveText(expected);

    // Any tag the rule dropped must genuinely be absent, not merely reordered.
    for (const dropped of bar!.tags.filter((t) => !topVenueTags(bar!.tags).includes(t))) {
      await expect(dialog.locator('[data-venue-tags]')).not.toContainText(displayTag(dropped));
    }
  });

  test('tags do not crowd the result card behind the lightbox', async ({ page }) => {
    await denyGeolocation(page.context());
    await page.clock.setFixedTime(FRIDAY_NIGHT);
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Search bars' }).fill('Attaboy');
    await page.getByRole('button', { name: /Attaboy/ }).click();
    const cards = page.locator('article').filter({ hasText: /Vibe match/i });
    await expect(cards).toHaveCount(5);
    // The chip row belongs to the lightbox only (checklist §2: "without
    // crowding the result card").
    await expect(page.locator('[data-venue-tags]')).toHaveCount(0);
  });

  // The goal-1 overflow contract is written against the compact/large iPhone
  // range specifically, so set those sizes rather than relying on the config's
  // iPhone 13 / Pixel 7 projects — same reasoning as native-shell-contract.
  for (const viewport of [
    { name: 'compact iPhone', width: 390, height: 844 },
    { name: 'large iPhone', width: 430, height: 932 },
  ]) {
    test(`tags introduce no horizontal overflow or scroll strip on ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const dialog = await openLightbox(page);
      await expect(dialog.locator('[data-venue-tags] li').first()).toBeVisible();

      // Contract 2: the shell never scrolls horizontally.
      const geometry = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        geometry.scrollWidth,
        `lightbox with tags scrolls horizontally (${geometry.scrollWidth} > ${geometry.clientWidth})`,
      ).toBeLessThanOrEqual(geometry.clientWidth + OVERFLOW_TOLERANCE_PX);

      // Contract 5: the tagged photo carousel is the ONE allowed sideways
      // scroller. A chip row that overflows instead of wrapping would show up
      // here as an untagged strip.
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
      expect(
        untagged,
        `untagged horizontal scrollers in the lightbox: ${untagged.join(' | ')}`,
      ).toHaveLength(0);

      // The chip row itself must wrap, not clip: every chip stays inside the
      // dialog's width.
      const dialogBox = await dialog.boundingBox();
      for (const chip of await dialog.locator('[data-venue-tags] li').all()) {
        const box = await chip.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x + box!.width).toBeLessThanOrEqual(
          dialogBox!.x + dialogBox!.width + OVERFLOW_TOLERANCE_PX,
        );
      }
    });
  }
});
