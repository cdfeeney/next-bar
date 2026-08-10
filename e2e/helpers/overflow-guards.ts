/**
 * Measurement primitives for the add-a-bar overflow guards.
 *
 * Extracted from `add-bar-overflow.spec.ts` so that spec stays under the
 * project's 800-line file cap (santa recovery round 2, Claude/FABLE). These are
 * pure instruments: every one takes its root selector as an argument and none
 * knows about the add-a-bar dialog specifically, so they are reusable by any
 * spec that needs to prove an element has no horizontal axis or that nothing
 * escapes its clipping box.
 */
import { expect, type Page } from '@playwright/test';

export async function widths(
  page: Page,
  selector: string,
): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate((sel) => {
    const el = sel === ':root' ? document.documentElement : document.querySelector(sel);
    if (!el) throw new Error(`missing element for ${sel}`);
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  }, selector);
}

/**
 * The assertion that actually generalises.
 *
 * Document- and dialog-level width checks are NOT sufficient for this modal.
 * CSS computes `overflow-x` to `auto` when only `overflow-y` is set, so every
 * `overflow-y-auto` container inside the dialog silently absorbs horizontal
 * overflow: the document and the dialog keep reporting scrollWidth ===
 * clientWidth while a nested scroller pans sideways. That blind spot hid a
 * 718px address inside a 342px row from the first version of this suite
 * (santa round 1: Claude/FABLE, Codex, GLM and DeepSeek all reached it
 * independently).
 *
 * So: walk every scroller in the dialog and prove each one has no horizontal
 * axis at all — not merely that it happens to be at scrollLeft 0.
 */
export async function expectNoHorizontalOverflowWithin(
  page: Page,
  rootSelector: string,
  where: string,
): Promise<void> {
  // Settle async layout first. Fonts and late images change scrollWidth after
  // open, so a synchronous walk can measure a narrower pre-swap layout, pass,
  // and never re-check (santa round 2: GLM + DeepSeek). The network fence
  // blocks the webfont so this resolves to the fallback immediately — that is
  // fine; what matters is that metrics are settled before measuring.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction((sel) => {
    const root = document.querySelector(sel);
    if (!root) return false;
    return Array.from(root.querySelectorAll('img')).every((img) => img.complete);
  }, rootSelector);

  const offenders = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) throw new Error(`guard root not mounted: ${sel}`);
    const out: { cls: string; scrollWidth: number; clientWidth: number; scrollLeft: number }[] = [];

    // Form controls and embedded content are REPLACED: their intrinsic box is
    // atomic, so an ancestor ellipsis cannot shorten them - it just clips them.
    const REPLACED = new Set([
      'IMG', 'SVG', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT',
      'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON',
    ]);
    // A non-replaced inline box IS the text. Its rect is the text's extent, so
    // an ancestor's ellipsis genuinely shortens it and it must never be read as
    // a box sticking out. `display: contents` generates no box at all, and its
    // children are visited separately by the same walk.
    const isTextLikeBox = (el: Element, cs: CSSStyleDeclaration): boolean =>
      cs.display === 'contents' || (cs.display === 'inline' && !REPLACED.has(el.tagName));
    // Nothing the user can perceive cannot be "clipped out of reach". This is
    // what keeps the standard visually-hidden (`sr-only`) span - 1x1, and laid
    // out after the text so its static position is far past the clip edge -
    // from being reported as an escapee.
    const isImperceptible = (el: Element, cs: CSSStyleDeclaration): boolean => {
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
      const r = el.getBoundingClientRect();
      return r.width * r.height <= 4;
    };
    // Overflow clips at the PADDING box, whose right edge sits one border-left
    // past the border box. Using `rect.left + clientWidth` understates it by
    // exactly that border and invents an escapee (santa recovery round 2:
    // DeepSeek and Kimi, reproduced at 20px).
    const clipRightEdge = (el: Element): number => {
      const cs = getComputedStyle(el);
      return el.getBoundingClientRect().left
        + parseFloat(cs.borderLeftWidth || '0')
        + el.clientWidth;
    };

    const all = [root, ...Array.from(root.querySelectorAll('*'))];
    for (const el of all) {
      const style = getComputedStyle(el as Element);
      const node = el as HTMLElement;

      // `hidden`/`clip` are NOT a pass. The first version of this helper
      // skipped them, which left the door open to the exact workaround the
      // goal forbids: silence a future overflow with `overflow-x: hidden` and
      // this guard would wave it through while the content sat clipped and
      // unreachable (santa round 2 — Codex, GLM and DeepSeek all reached it
      // independently). A legitimately hidden element that clips nothing has
      // scrollWidth === clientWidth, so this cannot false-positive.
      if (style.overflowX === 'hidden' || style.overflowX === 'clip') {
        // ...but INTENTIONAL truncation is explicitly allowed by criterion 3,
        // and it is implemented with overflow:hidden, so a naive
        // "hidden + scrollWidth > clientWidth" rule flags every `truncate` and
        // `line-clamp` in the modal. Verified empirically: it fired on the
        // picker's own name and address spans, which are supposed to truncate.
        // The real distinction is the AFFORDANCE — an ellipsis (or a clamp)
        // tells the user text was shortened; bare overflow-x:hidden hides it
        // silently, which is the workaround the goal bans.
        // `text-overflow: ellipsis` only actually PAINTS an ellipsis on a
        // single-line box. With `white-space: normal` the text wraps and the
        // ellipsis never renders, so accepting the property on its own would
        // exempt an element that is still clipping silently — the same hole
        // the line-clamp rule closed in round 3 (santa: DeepSeek). Tailwind's
        // `truncate` always sets nowrap, so requiring it costs nothing here.
        //
        // ...and the properties are still not enough on their own. They are
        // set-able on ANY element, so putting `truncate` on the bare
        // `overflow-hidden` <ul> that wraps the inline match rows used to exempt
        // the CLIPPER ITSELF while its unconstrained descendants — computing
        // `overflow-x: visible` — were skipped by the auto/scroll branch below.
        // `offenders` came back empty with a name clipped silently: exactly the
        // banned workaround, waved through (santa recovery round, Codex).
        //
        // The exemption therefore asks the question the property cannot: WOULD
        // AN ELLIPSIS ACTUALLY PAINT HERE? Two rules follow.
        //
        //  - Not a flex or grid container. `text-overflow` never paints on one,
        //    so `truncate` on a flex row button is decoration that silences the
        //    guard while an unconstrained child clips (Codex probed exactly
        //    this: clientWidth 96 vs scrollWidth 489, exemption granted, the
        //    overflowing child skipped as overflow-x:visible).
        //  - The overflow is TEXT overflow. An ellipsis shortens text; it cannot
        //    shorten a box, so a block, an atomic inline or a replaced element
        //    that sticks out of the content box is clipped with no affordance at
        //    all and must not buy an exemption.
        //
        // That second rule is MEASURED, not inferred from markup shape, and the
        // measurement replaces an `everyChildIsInline` test that was wrong in
        // both directions (santa recovery round 2, reproduced in both engines):
        //   * too narrow - `display:contents` (Codex), an `inline-flex` icon
        //     (Kimi, Claude), a `display:none` child, and the standard
        //     absolutely-positioned `sr-only` span (Claude, which blockifies to
        //     `display: block`) each cost correct markup its exemption;
        //   * too permissive - it read only DIRECT children, so a block
        //     grandchild under an inline child (DeepSeek) or a wide `<img>`
        //     (Kimi) was exempted while genuinely clipped.
        // Measuring boxes instead keeps `<div class="truncate"><span>{name}</span></div>`
        // exempt - the span is the text - while flagging anything actually cut off.
        const isFlexOrGrid = ['flex', 'inline-flex', 'grid', 'inline-grid'].includes(
          style.display,
        );
        const contentLimit = clipRightEdge(node);
        const overflowIsTextOnly = (Array.from(node.querySelectorAll('*')) as HTMLElement[])
          .every((d) => {
            const ds = getComputedStyle(d);
            if (isTextLikeBox(d, ds) || isImperceptible(d, ds)) return true;
            return d.getBoundingClientRect().right <= contentLimit + 1;
          });
        const hasEllipsis =
          style.textOverflow === 'ellipsis' &&
          (style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre') &&
          !isFlexOrGrid &&
          overflowIsTextOnly;
        // A line-clamp earns NO horizontal exemption. It is a VERTICAL
        // affordance — it wraps, then caps the line count — so it says nothing
        // about this axis. Round 3 added a `hasClamp` term that also required
        // `scrollWidth <= clientWidth`; that made it dead code, because the
        // offender test below fires only when `scrollWidth > clientWidth`, so
        // the two conditions are mutually exclusive and the term never exempted
        // anything (santa recovery round, GLM). Removing it is behaviour-
        // preserving and stops the guard reading as though clamps get a pass:
        // drop `break-words` while keeping `line-clamp-3` and an unbreakable
        // name clips sideways with no ellipsis, which must fail — it does,
        // because `text-overflow` stays `clip` on a `-webkit-box`.
        if (!hasEllipsis && node.scrollWidth > node.clientWidth) {
          out.push({
            cls: `[${style.overflowX}, no affordance] ` + (node.className?.toString().slice(0, 60) ?? ''),
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
            scrollLeft: -1,
          });
        }
        continue;
      }

      if (style.overflowX !== 'auto' && style.overflowX !== 'scroll') continue;
      // Try to move it: a container with no horizontal range cannot scroll.
      node.scrollLeft = 999;
      const moved = node.scrollLeft;
      node.scrollLeft = 0;
      if (node.scrollWidth > node.clientWidth || moved > 0) {
        out.push({
          cls: node.className?.toString().slice(0, 80) ?? '(no class)',
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          scrollLeft: moved,
        });
      }
    }
    return out;
  }, rootSelector);

  expect(offenders, `nested horizontal scroll at ${where}: ${JSON.stringify(offenders)}`).toEqual([]);
}

/**
 * Measure the ONE scroller that matters, pinned by a descendant so a future
 * `overflow-x-auto` utility elsewhere in the dialog cannot silently retarget
 * the assertion (the round-2 lesson).
 *
 * This deliberately duplicates the probe inlined in the criterion-6 test below
 * rather than refactoring it: that test is the frozen criterion-6 assertion and
 * the operator's instruction for this round was to preserve it exactly and ADD
 * coverage around it. It also records the pre-existing scrollTop as its
 * baseline instead of assuming 0, so a scroller that opens already-scrolled
 * cannot report a phantom move.
 */
export async function probeScroller(
  page: Page,
  rootSelector: string,
  pin: { selector: string; text?: string },
): Promise<{
  found: boolean; overflows: boolean; moved: boolean; clientHeight: number; matches: number;
}> {
  return page.locator(rootSelector).evaluate((el, pinArg) => {
    const candidates = (Array.from(el.querySelectorAll('*')) as HTMLElement[]).filter((n) => {
      const oy = getComputedStyle(n).overflowY;
      return oy === 'auto' || oy === 'scroll';
    });
    const matching = candidates.filter((n) =>
      Array.from(n.querySelectorAll(pinArg.selector)).some(
        (c) => !pinArg.text || (c.textContent ?? '').trim().startsWith(pinArg.text),
      ),
    );
    // `find` silently took the OUTERMOST match. If the dialog ever grows a
    // nested scroller around the same pin, the probe could measure a scroller
    // that still moves while the one criterion 6 cares about is frozen - a
    // tautology that never fails (santa recovery round 2, Kimi). Report the
    // count so the caller can require exactly one and fail loudly instead.
    const scroller = matching[0];
    if (!scroller) {
      return { found: false, overflows: false, moved: false, clientHeight: 0, matches: 0 };
    }
    const overflows = scroller.scrollHeight > scroller.clientHeight;
    const before = scroller.scrollTop;
    scroller.scrollTop = before + 150;
    const moved = scroller.scrollTop > before;
    scroller.scrollTop = before;
    return {
      found: true, overflows, moved, clientHeight: scroller.clientHeight,
      matches: matching.length,
    };
  }, pin);
}

/**
 * Geometric containment: does anything actually stick out of the box that
 * clips it?
 *
 * This complements the scrollWidth guard rather than replacing it. Integer
 * `clientWidth`/`scrollWidth` rounding makes the scrollWidth rule unusable at
 * 200% text — the picker scroller reports 297 vs 294 there purely from
 * sub-pixel accumulation — but the property that actually matters, "no content
 * is clipped out of reach", is measurable in fractional coordinates and is
 * immune to that rounding. What is reported is a BOX escaping an ancestor's
 * clipping box, which is the real defect (santa recovery round 2: Codex and GLM
 * both flagged the 200% case as unchecked).
 *
 * Two corrections from that round, each reproduced in chromium and webkit before
 * being made:
 *
 *  - Text-like boxes are skipped, boxes are not. Ancestor clipping does not move
 *    a descendant's DOMRect, so measuring every descendant flagged the ordinary
 *    `<div class="truncate"><span>{name}</span></div>` - the very composition the
 *    affordance rule above blesses - as a 760px escapee (Codex). The span IS the
 *    text; an ancestor ellipsis shortens it, so it is not a box sticking out.
 *  - Self-clipping descendants are NOT skipped. The previous version skipped any
 *    element whose own `overflow-x` was not `visible`, deferring it to the
 *    affordance rule - but that rule is not run in the 200% test, so a `truncate`
 *    span whose own BOX is wider than the row escaped unmeasured (Claude/FABLE).
 *    An element clipping its own CONTENT says nothing about where its own box sits.
 */
export async function expectNothingEscapesItsClipBox(
  page: Page,
  rootSelector: string,
  where: string,
): Promise<void> {
  const escapees = await page.locator(rootSelector).evaluate((root) => {
    const out: { cls: string; overshootPx: number }[] = [];
    const REPLACED = new Set([
      'IMG', 'SVG', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT',
      'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON',
    ]);
    const isTextLikeBox = (el: Element, cs: CSSStyleDeclaration): boolean =>
      cs.display === 'contents' || (cs.display === 'inline' && !REPLACED.has(el.tagName));
    const isImperceptible = (el: Element, cs: CSSStyleDeclaration): boolean => {
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
      const r = el.getBoundingClientRect();
      return r.width * r.height <= 4;
    };
    const clippers = ([root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[]).filter(
      (n) => getComputedStyle(n).overflowX !== 'visible',
    );
    for (const clipper of clippers) {
      const clipperStyle = getComputedStyle(clipper);
      // The padding box, not the border box, is where overflow clips.
      const limit = clipper.getBoundingClientRect().left
        + parseFloat(clipperStyle.borderLeftWidth || '0')
        + clipper.clientWidth;
      for (const n of Array.from(clipper.querySelectorAll('*')) as HTMLElement[]) {
        const style = getComputedStyle(n);
        if (isTextLikeBox(n, style) || isImperceptible(n, style)) continue;
        const right = n.getBoundingClientRect().right;
        // 1px covers sub-pixel layout; real clipping is orders of magnitude
        // larger (the defects this suite found were 718, 964 and 1062px).
        if (right > limit + 1) {
          out.push({
            cls: n.className?.toString().slice(0, 60) ?? '(no class)',
            overshootPx: Math.round(right - limit),
          });
        }
      }
    }
    return out;
  });
  expect(
    escapees,
    `content escapes its clipping box at ${where}: ${JSON.stringify(escapees)}`,
  ).toEqual([]);
}

export async function shrinkViewportHeight(page: Page, height: number): Promise<void> {
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp?.width ?? 390, height });
  // Let the resize settle before anything measures the new layout.
  await page.waitForFunction((h) => window.innerHeight <= h, height);
}
