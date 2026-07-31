/**
 * Deferred catalog swap — operator decision "option C", 2026-07-30.
 *
 * THE PROBLEM. `/` renders the whole catalog through BarPicker, which groups by
 * a FIXED neighborhood order and sorts alphabetically WITHIN each group. So the
 * post-hydration `replaceCatalog` inserts new bars THROUGHOUT the list, not at
 * the end. Browsers do not adjust scroll position for content inserted above the
 * viewport, so a row can change identity under the user's finger mid-scroll.
 *
 * WHY NOT SCROLL ANCHORING. That direction was explored and refuted: it cannot
 * make the failing spec pass, and it does not address the user-visible defect
 * either — anchoring keeps a pixel offset, not the row someone was reading.
 * Padding was also refuted: it only ever protected the last row.
 *
 * OPTION C. Hold the swapped-in catalog while the user is scrolled, and commit
 * it at a point where applying it cannot move anything under them.
 *
 * ⚠️ THE TRAP THIS MODULE EXISTS TO AVOID. **This app scrolls an inner
 * container, not the document.** `window.scrollY` is 0 on these routes and
 * `window.scrollTo` is a no-op — `e2e/mobile-controls.spec.ts` documents the
 * same trap, where the original pass-2 scroll silently did nothing and
 * re-measured the top of the page. A safe-point check written against `scrollY`
 * alone would therefore report "safe" forever and defer nothing, producing a fix
 * that looks right and changes nothing. We check every scrollable element too.
 */

/**
 * Treat this much drift as "at the top". Not an exact zero: momentum scrolling
 * and rubber-banding routinely leave a pixel or two behind, and a swap that
 * waits for a literal 0 could wait forever.
 */
export const SAFE_SCROLL_PX = 4;

/**
 * True when nothing on the page is scrolled away from its top — neither the
 * document nor any inner scroller. Applying a catalog swap here cannot move
 * content out from under the reader, because there is nothing above the
 * viewport to grow.
 */
export function isAtSafePoint(doc: Document = document): boolean {
  const win = doc.defaultView;
  if (win && win.scrollY > SAFE_SCROLL_PX) return false;
  // The inner-scroller case — the one that actually happens here.
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('*'))) {
    if (el.scrollTop > SAFE_SCROLL_PX) return false;
  }
  return true;
}

/**
 * Run `apply` at the next safe point — immediately if we are already at one.
 *
 * Returns a cancel function. Cancelling is what makes this safe to call from an
 * effect: an unmount must not leave a listener that later swaps the catalog of a
 * page that no longer exists.
 *
 * `apply` runs at most once. Scroll events are cheap to receive and the check
 * only walks the DOM while a swap is genuinely pending, so this stops costing
 * anything the moment it commits.
 */
export function deferUntilSafe(apply: () => void, doc: Document = document): () => void {
  let done = false;
  const win = doc.defaultView;

  const commit = (): void => {
    if (done) return;
    done = true;
    stop();
    apply();
  };

  const onScroll = (): void => {
    if (done) return;
    if (isAtSafePoint(doc)) commit();
  };

  // Leaving the page is also a safe point: nothing is under the user's finger,
  // and committing now means the catalog is already correct if they come back.
  const onHidden = (): void => {
    if (doc.visibilityState === 'hidden') commit();
  };

  function stop(): void {
    // `capture: true` because scrolls on inner containers do NOT bubble to
    // window — only the capture phase sees them. Without this the listener
    // would never fire for the very case this module exists to handle.
    win?.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
    doc.removeEventListener('visibilitychange', onHidden);
  }

  if (isAtSafePoint(doc)) {
    apply();
    return () => {
      done = true;
    };
  }

  win?.addEventListener('scroll', onScroll, { capture: true, passive: true });
  doc.addEventListener('visibilitychange', onHidden);

  return () => {
    if (done) return;
    done = true;
    stop();
  };
}
