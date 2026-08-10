/**
 * add-bar-overflow.spec.ts — Item 3 (goal g-b9dc294e).
 *
 * The add-a-bar modal pans horizontally on mobile (operator screenshot,
 * "Taylor Feedback", 2026-08-06). These assertions pin the CAUSE, not the
 * symptom: `overflow-x: hidden` on an ancestor would hide the panning while
 * leaving content clipped and unreachable, so every check below is a
 * *measurement* (scrollWidth vs clientWidth) plus a reachability check, and
 * none of them can be satisfied by clipping.
 *
 * Long names are injected as SYNTHETIC catalog rows through the loopback
 * fixture — no live lookup, no non-loopback traffic. The fence stays intact.
 *
 * Runs on every configured mobile project. `iPhone 17` (402x681) is the
 * shortest configured viewport on this branch and is where a
 * bottom-crowded/scroll-locked failure shows first, so criterion 6 is
 * asserted there too via the standard project matrix.
 */

import { test, expect, type Page } from '@playwright/test';
import { installCatalogFixture, loadBundledRows } from './helpers/catalogFixture';
import { denyGeolocation } from './helpers/geo';
import {
  expectNoHorizontalOverflowWithin,
  expectNothingEscapesItsClipBox,
  probeScroller,
  shrinkViewportHeight,
  widths,
} from './helpers/overflow-guards';

/**
 * Deliberately brutal: no spaces, so nothing can wrap at a word boundary.
 * A layout that survives this is containing its children rather than
 * relying on convenient text.
 */
const LONG_NAME =
  'Bar' + 'Supercalifragilisticexpialidocious'.repeat(3) + 'EndOfTheVeryLongName';
const LONG_ADDRESS =
  '1234567890 ' + 'NorthwesternBoulevardExtensionAnnexBuilding'.repeat(2) + ' Suite 9999';

/**
 * Bundled rows plus one row whose name and address cannot wrap.
 * The `id` is required by the fixture's row shape (it pages on id order), so
 * the return type carries it explicitly rather than a bare index signature.
 */
/** The synthetic row carrying the unbreakable name and address. */
const LONG_ROW_ID = 'aaa-overflow-fixture';

function rowsWithLongEntry(): (Record<string, unknown> & { id: string })[] {
  const base = loadBundledRows();
  const seed = base[0];
  return [
    ...base,
    {
      ...seed,
      id: LONG_ROW_ID,
      name: LONG_NAME,
      address: LONG_ADDRESS,
      neighborhood: seed.neighborhood,
    },
  ];
}

async function gotoRankings(page: Page): Promise<void> {
  await denyGeolocation(page.context());
  await installCatalogFixture(page, { rows: rowsWithLongEntry() });
  await page.goto('/rankings');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('next-bar:age-ack:v1', '1');
  });
  await page.reload();
}

/**
 * The OTHER add-a-bar entry point — and the one every returning user sees.
 *
 * `/rankings` mounts QuickAddBar in one of two variants. The empty state
 * mounts the `button` variant, which opens the dialog that every test above
 * drives. But as soon as `ratings.length > 0`, the header instead mounts
 * `variant="search"` (src/app/rankings/page.tsx:216) — an INLINE match list
 * that lives on the page, not inside any dialog.
 *
 * `gotoRankings` clears localStorage, so `hasNoRatings` is permanently true
 * and no assertion above can reach that variant. Seeding one rating is the
 * whole difference, and it is why a real affordance-free clip survived a
 * green suite through three Santa rounds.
 */
async function gotoRankingsWithExistingRating(page: Page): Promise<void> {
  await gotoRankings(page);
  // Rate the LONG synthetic row, not just an ordinary one. Seeding only an
  // ordinary bar leaves every row the guard actually measures badge-less,
  // because the search query matches only the synthetic row and
  // RatingBadgeView returns null for an unrated bar — so the `shrink-0` badge
  // span, one of the three classes this fix adds, would be measured empty and
  // that third of the row composition would go unexercised (santa: Claude
  // FABLE). An ordinary bar is seeded alongside it so the returning-user list
  // is not composed solely of the synthetic fixture.
  // READ THIS BEFORE COUNTING ANYTHING IN A FUTURE TEST. These two ratings are
  // NOT symmetric: storage holds TWO, but only ONE ranked row renders.
  //
  // The reason is a STALE MEMO, not an unresolvable id. Both surfaces read the
  // same catalog store, so once CatalogRefresh swaps the fixture rows in,
  // getBarById(LONG_ROW_ID) resolves perfectly well. But the ranked list builds
  // its entries in a useMemo keyed on [ratings] alone (src/app/rankings/
  // page.tsx), so it resolved ids BEFORE the swap and never recomputes while
  // ratings stay unchanged — the stale-reader case catalog.ts's SWAP-DAY
  // CHECKLIST warns about. The inline search list reads useBars() live, which
  // is why the synthetic row appears there.
  //
  // So the ghost holds ONLY while ratings are untouched after the swap. Change
  // a rating through the UI after mount, or add the catalog to that memo's
  // deps, and the row appears for real. Do not write "one ranked row per stored
  // rating" against this helper without accounting for that
  // (santa round 2: GLM; mechanism corrected in round 3 by Claude/FABLE + GLM).
  const ratedBarIds = [LONG_ROW_ID, loadBundledRows()[0].id];
  await page.evaluate((barIds) => {
    localStorage.setItem(
      'next-bar:ratings:v1',
      JSON.stringify(
        barIds.map((barId) => ({
          barId,
          rating: 'loved',
          ratedAt: new Date(0).toISOString(),
        })),
      ),
    );
  }, ratedBarIds);
  await page.reload();
}

/** The add-a-bar modal's dialog. */
const DIALOG_SELECTOR = 'div[role="dialog"][aria-label="Add a bar"]';

/**
 * The inline `variant="search"` match list rendered on /rankings itself —
 * OUTSIDE the dialog, which is why the dialog-scoped guard never saw it.
 */
const INLINE_MATCH_LIST_SELECTOR = 'ul[aria-label="Matching bars"]';

/** The dialog element for the add-a-bar modal. */
function modal(page: Page) {
  return page.locator(DIALOG_SELECTOR);
}

/** scrollWidth/clientWidth of a locator, measured in the browser. */

/**
 * Dialog-scoped guard — the original call shape, behaviour unchanged. Kept so
 * the existing assertions keep measuring exactly what they measured before.
 */
async function expectNoNestedHorizontalScroll(page: Page, where: string): Promise<void> {
  await expectNoHorizontalOverflowWithin(page, DIALOG_SELECTOR, where);
}

async function openAddBarModal(page: Page): Promise<void> {
  // Empty state renders the "+ Add a bar" trigger.
  const trigger = page.getByRole('button', { name: '+ Add a bar' });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(modal(page)).toBeVisible();
}

/** Search for the synthetic long-named bar and advance to the tier stage. */
async function selectLongBar(page: Page): Promise<void> {
  const search = modal(page).getByLabel('Search bars');
  await expect(search).toBeVisible();
  await search.click();
  await search.pressSequentially('Supercalifragilistic');
  const match = modal(page).getByRole('button', { name: new RegExp(LONG_NAME.slice(0, 24)) });
  await expect(match.first()).toBeVisible({ timeout: 10_000 });
  await match.first().click();
  await expect(modal(page).getByRole('heading')).toContainText('How was');
}

/** Shrink only the height, keeping each project's own width. */

test.describe('/rankings add-a-bar modal — no horizontal overflow', () => {
  test('document does not scroll horizontally with the modal open', async ({ page }) => {
    await gotoRankings(page);
    await openAddBarModal(page);

    const doc = await widths(page, ':root');
    expect(doc.scrollWidth).toBe(doc.clientWidth);
  });

  test('the modal itself does not scroll horizontally', async ({ page }) => {
    await gotoRankings(page);
    await openAddBarModal(page);

    const m = await widths(page, 'div[role="dialog"][aria-label="Add a bar"]');
    expect(m.scrollWidth).toBe(m.clientWidth);
  });

  test('window.scrollX stays 0 before and after interacting', async ({ page }) => {
    await gotoRankings(page);
    await openAddBarModal(page);

    expect(await page.evaluate(() => window.scrollX)).toBe(0);

    // Interact: type into the picker's search, then scroll the list vertically.
    const search = modal(page).getByLabel('Search bars');
    if (await search.count()) {
      await search.click();
      await search.pressSequentially('Bar');
    }
    await modal(page).evaluate((el) => {
      const scroller = el.querySelector('.overflow-y-auto');
      if (scroller) scroller.scrollTop = 200;
    });

    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });

  /**
   * The load-bearing one. A synthetic unbreakable name is selected so it
   * lands in the tier-stage header (`How was {name}?`), which is a flex row.
   * A flex child defaults to `min-width: auto` and therefore refuses to
   * shrink below its content — that is the documented cause class in
   * criterion 4.
   */
  test('a very long synthetic bar name cannot widen the modal', async ({ page }) => {
    await gotoRankings(page);
    await openAddBarModal(page);

    const search = modal(page).getByLabel('Search bars');
    await expect(search).toBeVisible();
    await search.click();
    await search.pressSequentially('Supercalifragilistic');

    const match = modal(page).getByRole('button', { name: new RegExp(LONG_NAME.slice(0, 24)) });
    await expect(match.first()).toBeVisible({ timeout: 10_000 });
    await match.first().click();

    // Now at the tier stage, whose heading interpolates the long name.
    await expect(modal(page).getByRole('heading')).toContainText('How was');

    const m = await widths(page, 'div[role="dialog"][aria-label="Add a bar"]');
    expect(m.scrollWidth).toBe(m.clientWidth);

    const doc = await widths(page, ':root');
    expect(doc.scrollWidth).toBe(doc.clientWidth);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });

  /**
   * Criterion 2/3: containment must come from wrapping or an intentional
   * truncation, never from an ancestor clipping content out of reach. The
   * heading must still be non-empty and within the dialog's box.
   */
  test('the long name is contained without being clipped out of reach', async ({ page }) => {
    await gotoRankings(page);
    await openAddBarModal(page);

    const search = modal(page).getByLabel('Search bars');
    await search.click();
    await search.pressSequentially('Supercalifragilistic');
    const match = modal(page).getByRole('button', { name: new RegExp(LONG_NAME.slice(0, 24)) });
    await expect(match.first()).toBeVisible({ timeout: 10_000 });
    await match.first().click();

    const heading = modal(page).getByRole('heading').first();
    await expect(heading).toBeVisible();

    const box = await heading.boundingBox();
    const dialogBox = await modal(page).boundingBox();
    expect(box).not.toBeNull();
    expect(dialogBox).not.toBeNull();
    // The heading's right edge stays inside the dialog: contained, not
    // spilling past the viewport where it would be unreachable.
    expect(box!.x + box!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1);

    // And it is genuinely rendering the NAME, not just the boilerplate:
    // asserting only 'How was' would still pass if the name were dropped
    // entirely (santa round 1, Codex).
    await expect(heading).toContainText(LONG_NAME.slice(0, 40));
  });

  /**
   * The picker stage, measured WHILE the long-address row is on screen. The
   * first version of this suite only measured after clicking through to the
   * tier stage, by which point the offending row had unmounted — which is
   * exactly how a 718px address hid behind a green suite.
   */
  test('no nested scroller pans sideways while a long address row is visible', async ({
    page,
  }) => {
    await gotoRankings(page);
    await openAddBarModal(page);

    const search = modal(page).getByLabel('Search bars');
    await search.click();
    await search.pressSequentially('Supercalifragilistic');

    const match = modal(page).getByRole('button', { name: new RegExp(LONG_NAME.slice(0, 24)) });
    await expect(match.first()).toBeVisible({ timeout: 10_000 });

    // The ADDRESS must actually be rendered, not merely absent-and-therefore-
    // narrow. Without this the containment fix could "pass" by regressing to no
    // address at all: hide or delete `{bar.address}` in BarPicker and every
    // width and scroller assertion below still goes green, because the row is
    // located by its NAME. The name half of criterion 2 was pinned with
    // toContainText in round 1; the address half never was (santa recovery
    // round, Codex). Codex named two triggers — deleting `{bar.address}` and
    // hiding it — and they need different assertions: `toContainText` reads
    // textContent, so it catches deletion but a `display:none` span still
    // matches (verified: the mutation passed 2/2 against a toContainText-only
    // version). Asserting the address is VISIBLE covers both. Truncation is
    // visual, so a truncated-but-rendered address still satisfies this.
    const addressEl = match.first().getByText(LONG_ADDRESS.slice(0, 30), { exact: false });
    await expect(addressEl).toBeVisible();
    // toBeVisible() is necessary but NOT sufficient: Playwright treats a
    // zero-opacity element as visible, so `opacity-0` on the address span would
    // pass everything above while the address is invisible on screen (Codex
    // probed it: isVisible() true with computed opacity 0). Pin the paint.
    await expect(addressEl).toHaveCSS('opacity', '1');

    // Row on screen — this is the moment that matters.
    await expectNoNestedHorizontalScroll(page, 'pick-bar stage with long address');
    // Geometric containment at DEFAULT text size too. It was reachable only
    // through the 200% test, which left the ordinary case relying entirely on
    // integer scrollWidth/clientWidth equality that this suite itself documents
    // as unreliable (santa recovery round 2, Kimi). The two instruments are
    // complementary, so both axes are checked at both text sizes.
    await expectNothingEscapesItsClipBox(page, DIALOG_SELECTOR, 'pick-bar stage with long address');
  });

  /** The tier stage, including the named-list chips, measured the same way. */
  test('no nested scroller pans sideways at the tier stage with a long list name', async ({
    page,
  }) => {
    await gotoRankings(page);
    // Seed a list whose name is one long unbreakable token: flex-wrap only
    // wraps BETWEEN chips, so a single oversized chip still overflows.
    // `createdAt`/`updatedAt` are REQUIRED by isBarList in src/lib/lists.ts.
    // Without them parseBarLists returns null, the store degrades to [], the
    // "No lists yet" branch renders instead of the chips, and this test passes
    // while never mounting the thing it exists to check — verified vacuous in
    // santa round 2 (Claude/FABLE), which is textbook coverage theater.
    await page.evaluate((name) => {
      const now = new Date(0).toISOString();
      localStorage.setItem(
        'next-bar:lists:v1',
        JSON.stringify([
          { id: 'overflow-list', name, barIds: [], createdAt: now, updatedAt: now },
        ]),
      );
    }, 'ListNamed' + 'Wwwwwwwwwwwwwwwwwwww'.repeat(6));
    await page.reload();

    await openAddBarModal(page);
    const search = modal(page).getByLabel('Search bars');
    await search.click();
    await search.pressSequentially('Supercalifragilistic');
    const match = modal(page).getByRole('button', { name: new RegExp(LONG_NAME.slice(0, 24)) });
    await expect(match.first()).toBeVisible({ timeout: 10_000 });
    await match.first().click();

    await expect(modal(page).getByRole('heading')).toContainText('How was');

    // Prove the chip actually mounted. Without this the seed could silently
    // fail validation again and the measurement below would assert nothing.
    await expect(
      modal(page).getByRole('button', { name: /ListNamedWwwwww/ }),
    ).toBeVisible();

    await expectNoNestedHorizontalScroll(page, 'tier stage with long list name');
  });

  /**
   * Criterion 6, made non-vacuous: the heading must not be allowed to grow
   * without bound and squeeze the scrollable region to nothing on the
   * shortest viewport.
   */
  test('a long name cannot crowd the scrollable region out of the modal', async ({ page }) => {
    await gotoRankings(page);
    await openAddBarModal(page);

    const search = modal(page).getByLabel('Search bars');
    await search.click();
    await search.pressSequentially('Supercalifragilistic');
    const match = modal(page).getByRole('button', { name: new RegExp(LONG_NAME.slice(0, 24)) });
    await expect(match.first()).toBeVisible({ timeout: 10_000 });
    await match.first().click();

    const heading = modal(page).getByRole('heading').first();
    const dialogBox = await modal(page).boundingBox();
    const headingBox = await heading.boundingBox();
    expect(headingBox).not.toBeNull();
    expect(dialogBox).not.toBeNull();

    // The heading may wrap, but it must not eat the modal: cap it at half the
    // dialog height so the tier buttons below stay reachable.
    expect(headingBox!.height).toBeLessThan(dialogBox!.height / 2);

    // And the tier options are actually visible, not pushed off.
    await expect(modal(page).getByRole('button', { name: /^Loved/ })).toBeVisible();
  });

  /** Criterion 11 + 12: the flow still works, and it does not navigate. */
  test('search, select, and close still work without changing the URL', async ({ page }) => {
    await gotoRankings(page);
    const urlBefore = page.url();
    await openAddBarModal(page);

    const search = modal(page).getByLabel('Search bars');
    await search.click();
    await search.pressSequentially('Supercalifragilistic');
    const match = modal(page).getByRole('button', { name: new RegExp(LONG_NAME.slice(0, 24)) });
    await expect(match.first()).toBeVisible({ timeout: 10_000 });
    await match.first().click();

    await expect(modal(page).getByRole('heading')).toContainText('How was');
    expect(page.url()).toBe(urlBefore);

    await modal(page).getByRole('button', { name: 'Close' }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(page.url()).toBe(urlBefore);
  });

  /**
   * Criterion 6: vertical scrolling must survive. The modal locks BODY
   * scroll deliberately; what must remain scrollable is the inner list.
   */
  test('vertical scrolling inside the modal still works', async ({ page }) => {
    await gotoRankings(page);
    await openAddBarModal(page);

    const result = await modal(page).evaluate((el) => {
      // Find the scroller by COMPUTED overflow-y, not by the `.overflow-y-auto`
      // class. Matching on a class string only proves the class is present.
      const candidates = (Array.from(el.querySelectorAll('*')) as HTMLElement[]).filter(
        (n) => {
          const oy = getComputedStyle(n).overflowY;
          return oy === 'auto' || oy === 'scroll';
        },
      );
      // Pin WHICH scroller this is. Taking the first computed match is not
      // enough: CSS computes overflow-y to `auto` on any element whose author
      // set only overflow-x, so a future `overflow-x-auto` utility placed
      // earlier in the dialog would silently retarget this assertion at an
      // element that has nothing to do with the list (santa round 2: DeepSeek
      // and Codex; Claude/FABLE raised the same risk as an advisory). The
      // scroller that matters is the one actually holding the picker rows.
      const scroller = candidates.find((n) => n.querySelector('li button'));
      if (!scroller) {
        return { found: false, overflows: false, moved: false, clientHeight: 0 };
      }
      const overflows = scroller.scrollHeight > scroller.clientHeight;
      scroller.scrollTop = 150;
      const moved = scroller.scrollTop > 0;
      scroller.scrollTop = 0;
      return { found: true, overflows, moved, clientHeight: scroller.clientHeight };
    });

    expect(result.found).toBe(true);
    // The list must GENUINELY overflow. The previous version returned
    // 'no-overflow' and still passed, so on any run where the list happened to
    // fit, "vertical scrolling still works" asserted nothing at all — and
    // criterion 6 is the one criterion a containment fix is most likely to
    // break (santa: Codex).
    expect(result.overflows).toBe(true);
    expect(result.moved).toBe(true);
    // A scrollport the user can actually see. scrollHeight > clientHeight plus
    // a writable scrollTop is satisfied by a collapsed container too: shrink
    // the scroller to a few pixels and the content still "scrolls"
    // programmatically while the user sees a slit (santa round 2: Codex, with
    // DeepSeek giving the same shape as a max-height collapse).
    expect(result.clientHeight).toBeGreaterThan(100);
  });

  /**
   * Criterion 6, TIER STAGE. The assertion above pins the scroller that holds
   * the picker rows, so the tier stage — a DIFFERENT `overflow-y-auto`
   * container (QuickAddBar's tier branch) — had no coverage at all: delete
   * `overflow-y-auto` there and every existing test still passes while the tier
   * options sit unreachable under a locked body (santa recovery round, Codex).
   */
  test('the tier stage still scrolls when its options overflow', async ({ page }) => {
    await gotoRankings(page);
    await openAddBarModal(page);
    await selectLongBar(page);

    // Three tier buttons fit comfortably on a tall phone, so measuring as-is
    // would assert nothing on iPhone 13 and Pixel 7 — measured: still no
    // overflow at 420px tall. Shrink until the stage genuinely overflows, then
    // REQUIRE that below, so this can never silently degrade into a no-op. The
    // floor is 300px, roughly what a 667px phone leaves with the keyboard up.
    //
    // Criterion 6 names SHORT VIEWPORTS explicitly, so this always shrinks at
    // least once. The earlier loop broke before its first iteration whenever the
    // stage already overflowed at full height, which would have asserted only
    // the tall case and silently stopped covering short viewports the moment the
    // tier stage gained content (santa recovery round 2, DeepSeek).
    const pin = { selector: 'button', text: 'Loved' };
    let tier = await probeScroller(page, DIALOG_SELECTOR, pin);
    for (const height of [420, 360, 300]) {
      await shrinkViewportHeight(page, height);
      tier = await probeScroller(page, DIALOG_SELECTOR, pin);
      if (tier.overflows) break;
    }
    expect(tier.found).toBe(true);
    // Exactly one scroller may answer to this pin, or the probe could be
    // measuring a different container than the one under test.
    expect(tier.matches).toBe(1);
    expect(tier.overflows).toBe(true);
    expect(tier.moved).toBe(true);
    // A usable scrollport, for the same reason criterion 6 asserts one: a
    // collapsed container still satisfies overflows+moved, and
    // toBeInViewport() below only needs a 1px intersection, so `max-h-px` on
    // the tier scroller would pass every other assertion here while being
    // untouchable (Codex: scrollHeight 240 on a 1px scroller, moved true). The
    // floor is one 44px tap target, matching the keyboard case rather than the
    // unobstructed `> 100`, because this test deliberately runs shrunken.
    expect(tier.clientHeight).toBeGreaterThan(44);

    // And every tier option is genuinely reachable, not just present in the
    // DOM — toBeVisible() would pass on a button clipped outside the scrollport.
    for (const label of [/^Loved/, /^Liked/, /^Pass/]) {
      const option = modal(page).getByRole('button', { name: label });
      await option.scrollIntoViewIfNeeded();
      await expect(option).toBeInViewport();
    }

    await expectNoNestedHorizontalScroll(page, 'tier stage on a short viewport');
  });

  /**
   * Criterion 6, KEYBOARD OPEN. Playwright cannot raise a real IME, so the
   * honest proxy is the geometric effect a keyboard has: the visual viewport
   * loses roughly half its height while a text field holds focus. The failure
   * this guards is a list that stops scrolling exactly when the user is typing.
   */
  test('vertical scrolling survives the on-screen keyboard opening', async ({ page }) => {
    await gotoRankings(page);
    await openAddBarModal(page);

    const search = modal(page).getByLabel('Search bars');
    await expect(search).toBeVisible();
    await search.click();
    await expect(search).toBeFocused();

    await shrinkViewportHeight(page, 380);
    // The field must STILL hold focus in the shrunken state, or this is an
    // ordinary resize test rather than the keyboard-open one it claims to be.
    // The shrink itself is deterministic - shrinkViewportHeight sets the
    // viewport and awaits innerHeight <= 380 - so the measurement below cannot
    // silently be taken at full height (santa recovery round 2, GLM raised the
    // opposite mechanism; the focus pin is what actually closes the gap).
    await expect(search).toBeFocused();

    const list = await probeScroller(page, DIALOG_SELECTOR, { selector: 'li button' });
    expect(list.found).toBe(true);
    expect(list.matches).toBe(1);
    expect(list.overflows).toBe(true);
    expect(list.moved).toBe(true);
    // A deliberately different bar from the unobstructed case's `> 100`: with
    // half the screen gone, what criterion 6 requires is that a usable slice of
    // list survives — at least one 44px tap target — not the full scrollport.
    // This ADDS a floor for the keyboard state; it does not relax that one.
    expect(list.clientHeight).toBeGreaterThan(44);

    await expectNoNestedHorizontalScroll(page, 'pick-bar stage with the keyboard open');
  });

  /**
   * Criterion 6, ACCESSIBILITY TEXT SIZES. Every Tailwind size in this modal is
   * rem-based, so doubling the root font size is what a user's large-text
   * setting actually does to this layout. It is also the harshest containment
   * case: the same unbreakable name, twice as wide.
   */
  test('vertical scrolling and containment survive doubled text size', async ({ page }) => {
    await gotoRankings(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await openAddBarModal(page);

    const list = await probeScroller(page, DIALOG_SELECTOR, { selector: 'li button' });
    expect(list.found).toBe(true);
    expect(list.matches).toBe(1);
    expect(list.overflows).toBe(true);
    expect(list.moved).toBe(true);
    // The usable-height floor this candidate adds to the tier and keyboard
    // states belongs here too, and its absence was the gap: a collapsed picker
    // scroller at 200% text still satisfies overflows+moved, because a 1px
    // scrollport with 240px of content is programmatically scrollable while the
    // user sees a slit (santa recovery round 2: Claude/FABLE and Kimi). Large
    // text is exactly when a height regression is most likely, so this asserts
    // the same 44px tap-target floor the other shrunken states use.
    expect(list.clientHeight).toBeGreaterThan(44);

    // Containment at 2x, measured the way 2x allows.
    //
    // The scrollWidth guard is NOT the right instrument here and the reason is
    // measured, not assumed: at 200% the picker scroller reports scrollWidth
    // 297 vs clientWidth 294 on iPhone 13, yet an attribution pass found
    // nothing out of reach — every descendant box ends at exactly the content
    // edge (maxRight 342.00 === left 48 + clientWidth 294), there is no padding
    // or scrollbar gutter (border-box 294 === clientWidth), and the only inline
    // text past the edge sits inside `truncate` spans clipping behind an
    // ellipsis on purpose. Those integers are sub-pixel accumulation. Asserting
    // equality would fail on a rounding artifact, and the only way to "pass" it
    // would be `overflow-x: hidden` on an ancestor — the banned workaround.
    //
    // So assert the property that actually matters, in fractional coordinates
    // that rounding cannot fake: nothing escapes the box that clips it. A child
    // overflowing at 200% — the case Codex and GLM both raised — is caught by
    // this, while the 3px artifact is not.
    await expectNothingEscapesItsClipBox(page, DIALOG_SELECTOR, 'pick-bar stage at 200% text');

    // Criterion 8 on the surface this goal owns.
    const m = await widths(page, DIALOG_SELECTOR);
    expect(m.scrollWidth).toBe(m.clientWidth);

    // The DOCUMENT is deliberately not asserted at 2x, and this one is not
    // subtle: /rankings already measures scrollWidth 550 vs clientWidth 390 at
    // 200% text BEFORE this modal opens, and opening it does not move the
    // number (measured both ways). The offenders are page chrome — the header's
    // `relative z-20 shrink-0 text-right` control at 176px wide, and the
    // five-tab bottom nav — neither owned by an add-a-bar item. Asserting it
    // here would fail on someone else's defect and pressure a future author
    // into "fixing" this modal for it. Recorded as a separate finding instead.
  });

  /**
   * Criteria 2/3/4 on the `variant="search"` path — the residual HIGH carried
   * out of santa round 3.
   *
   * The inline match list is a bare `overflow-hidden` <ul> whose row button
   * holds unconstrained inline spans. A name that cannot wrap is clipped
   * sideways with no ellipsis and no clamp: silent, unreachable, and exactly
   * the workaround this goal bans. Every assertion above is dialog-scoped, so
   * none of them could ever see this list.
   */
  test('the inline rankings search list cannot clip a long bar name', async ({ page }) => {
    await gotoRankingsWithExistingRating(page);

    // Non-vacuity, part 1: we are on the search variant, NOT the dialog path
    // the rest of this suite exercises.
    await expect(page.locator(DIALOG_SELECTOR)).toHaveCount(0);
    const search = page.getByLabel('Search bars');
    await expect(search).toBeVisible();

    await search.click();
    await search.pressSequentially('Supercalifragilistic');

    // Non-vacuity, part 2: the offending row is really mounted before we
    // measure it. Without this the guard would pass on an empty list.
    const list = page.locator(INLINE_MATCH_LIST_SELECTOR);
    await expect(list).toBeVisible();
    await expect(
      list.getByRole('button', { name: new RegExp(LONG_NAME.slice(0, 24)) }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Non-vacuity, part 3: the row really carries a rating badge. Without
    // this, the seed could regress to an unrated bar, RatingBadgeView would
    // return null, and the `shrink-0` span would be measured empty — the
    // long-name-BESIDE-other-content case would silently stop being tested.
    await expect(
      list.getByRole('button', { name: new RegExp(LONG_NAME.slice(0, 24)) }).first(),
    ).toContainText('Loved');

    await expectNoHorizontalOverflowWithin(
      page,
      INLINE_MATCH_LIST_SELECTOR,
      'inline rankings search match list',
    );

    // The page itself must not pan either. NOTE for whoever extends this:
    // this document-level check does NOT cover the ranked rows. The seeded
    // synthetic bar does not render as a ranked row here — verified by
    // asserting its heading and watching it fail — because the ranked list's
    // useMemo is keyed on [ratings] alone and resolved ids before the catalog
    // swap, NOT because the id is unresolvable (see
    // gotoRankingsWithExistingRating). GLM and Codex both flagged those rows
    // (their <h2> is a flex child with no min-w-0) as a still-unguarded
    // surface. Reaching them means perturbing ratings after the swap, or
    // giving the catalog to that memo — app-side changes, which is why this
    // is tracked as a separate item rather than folded in here.
    const doc = await widths(page, ':root');
    expect(doc.scrollWidth).toBe(doc.clientWidth);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });

  /**
   * Criteria 11/12 on the same path: selecting from the inline list must
   * still open the tier sheet, must not navigate, and the sheet reached this
   * way must be contained too.
   */
  test('the inline rankings search still selects a bar without changing the URL', async ({
    page,
  }) => {
    await gotoRankingsWithExistingRating(page);
    const urlBefore = page.url();

    const search = page.getByLabel('Search bars');
    await search.click();
    await search.pressSequentially('Supercalifragilistic');

    const match = page
      .locator(INLINE_MATCH_LIST_SELECTOR)
      .getByRole('button', { name: new RegExp(LONG_NAME.slice(0, 24)) });
    await expect(match.first()).toBeVisible({ timeout: 10_000 });
    await match.first().click();

    await expect(modal(page).getByRole('heading')).toContainText('How was');
    expect(page.url()).toBe(urlBefore);

    await expectNoNestedHorizontalScroll(page, 'tier stage entered from inline search');
  });
});
