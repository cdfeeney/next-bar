import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAFE_SCROLL_PX, deferUntilSafe, isAtSafePoint } from './deferredCatalogSwap';

/**
 * Option C (operator-approved 2026-07-30): the post-hydration catalog swap must
 * NOT land while the user is scrolled, because BarPicker groups by a fixed
 * neighborhood order and sorts alphabetically WITHIN each group — so new bars
 * insert THROUGHOUT the list, not at the end. Browsers do not adjust scroll for
 * content inserted above the viewport, so a row changes identity under the
 * user's finger.
 *
 * The subtlety these tests exist to pin: **this app scrolls an inner container,
 * not the document.** `window.scrollY` is always 0 on these routes, so a
 * safe-point check written against `scrollY` alone would report "safe" forever
 * and defer nothing. mobile-controls.spec.ts documents the same trap — its
 * original pass-2 `window.scrollTo` was a silent no-op.
 */

function makeScroller(scrollTop: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true });
  document.body.appendChild(el);
  return el;
}

describe('isAtSafePoint', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.scrollY = 0;
  });

  it('is safe on a fresh page with nothing scrolled', () => {
    expect(isAtSafePoint()).toBe(true);
  });

  it('is NOT safe when an INNER container is scrolled, even though scrollY is 0', () => {
    // The regression that matters. scrollY stays 0 on these routes.
    makeScroller(400);
    expect(window.scrollY).toBe(0);
    expect(isAtSafePoint()).toBe(false);
  });

  it('is NOT safe when the document itself is scrolled', () => {
    window.scrollY = 400;
    expect(isAtSafePoint()).toBe(false);
  });

  it('tolerates sub-threshold drift rather than demanding an exact zero', () => {
    makeScroller(SAFE_SCROLL_PX);
    expect(isAtSafePoint()).toBe(true);
  });
});

describe('deferUntilSafe', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.scrollY = 0;
  });

  it('applies immediately when already at a safe point', () => {
    const apply = vi.fn();
    deferUntilSafe(apply);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('does NOT apply while an inner container is scrolled', () => {
    makeScroller(400);
    const apply = vi.fn();
    deferUntilSafe(apply);
    expect(apply).not.toHaveBeenCalled();
  });

  it('applies once the scroller returns to the top', () => {
    const el = makeScroller(400);
    const apply = vi.fn();
    deferUntilSafe(apply);
    expect(apply).not.toHaveBeenCalled();

    el.scrollTop = 0;
    window.dispatchEvent(new Event('scroll'));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('applies at most once, however many scroll events arrive', () => {
    const el = makeScroller(400);
    const apply = vi.fn();
    deferUntilSafe(apply);
    el.scrollTop = 0;
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('cancel() prevents a pending swap from ever landing', () => {
    const el = makeScroller(400);
    const apply = vi.fn();
    const cancel = deferUntilSafe(apply);
    cancel();
    el.scrollTop = 0;
    window.dispatchEvent(new Event('scroll'));
    expect(apply).not.toHaveBeenCalled();
  });

  it('stops listening after it applies, leaving no dangling listener', () => {
    const el = makeScroller(400);
    const remove = vi.spyOn(window, 'removeEventListener');
    deferUntilSafe(vi.fn());
    el.scrollTop = 0;
    window.dispatchEvent(new Event('scroll'));
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), expect.anything());
    remove.mockRestore();
  });
});
