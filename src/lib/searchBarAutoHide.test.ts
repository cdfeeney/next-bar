/**
 * searchBarAutoHide — the state machine that hides BarPicker's sticky search
 * while the user scrolls down and reveals it on scroll-up or near the top.
 *
 * Written RED-first for g-90f908bc. The consult round explicitly predicted the
 * per-event-delta trap (mobile fling emits many 1–3px scroll events, so a
 * per-event `dy > threshold` gate never fires) — the fling tests below pin the
 * cumulative-delta behavior that avoids it.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DIRECTION_COMMIT_PX,
  HIDE_AFTER_PX,
  REVEAL_NEAR_TOP_PX,
  initialAutoHideState,
  nextAutoHideState,
  scrollTopOf,
  watchSearchVisibility,
} from './searchBarAutoHide';

/** Feed a sequence of absolute y positions through the machine. */
function run(
  ys: number[],
  opts: { from?: ReturnType<typeof initialAutoHideState>; focused?: boolean } = {},
) {
  let state = opts.from ?? initialAutoHideState();
  for (const y of ys) {
    state = nextAutoHideState(state, y, opts.focused ?? false);
  }
  return state;
}

describe('nextAutoHideState', () => {
  it('starts visible at the top', () => {
    expect(initialAutoHideState().visible).toBe(true);
  });

  it('hides on a single decisive downward scroll past the hide threshold', () => {
    const state = run([0, HIDE_AFTER_PX + 40]);
    expect(state.visible).toBe(false);
  });

  it('hides on a mobile fling of many small deltas (no single event exceeds the commit threshold)', () => {
    // 2px per event from 60 to 160 — the trap case: per-event gating would
    // keep this visible forever and the covered-card spec failure would stay.
    const ys: number[] = [];
    for (let y = 60; y <= 160; y += 2) ys.push(y);
    const state = run(ys, { from: { ...initialAutoHideState(), lastY: 60 } });
    expect(state.visible).toBe(false);
  });

  it('reveals on a gentle scroll-up of many small deltas', () => {
    const hidden = run([0, 400]);
    expect(hidden.visible).toBe(false);
    const ys: number[] = [];
    for (let y = 400; y >= 380; y -= 1) ys.push(y);
    const state = run(ys, { from: hidden });
    expect(state.visible).toBe(true);
  });

  it('does not hide while still within the near-top zone', () => {
    const state = run([0, 2, 4, 6, REVEAL_NEAR_TOP_PX]);
    expect(state.visible).toBe(true);
  });

  it('never hides before passing HIDE_AFTER_PX even on a decisive downward move', () => {
    const state = run([0, HIDE_AFTER_PX - 10]);
    expect(state.visible).toBe(true);
  });

  it('always reveals when back within the near-top zone regardless of direction', () => {
    // Direction is "down" between the last two samples of a bounce, but the
    // resting position is the top — the search bar must be there.
    const state = run([0, 400, 2, REVEAL_NEAR_TOP_PX - 1]);
    expect(state.visible).toBe(true);
  });

  it('sub-threshold jitter does not flap the state', () => {
    const hidden = run([0, 400]);
    // ±1px alternation stays under DIRECTION_COMMIT_PX in each direction.
    const state = run([401, 400, 401, 400], { from: hidden });
    expect(state.visible).toBe(false);
    const visible = run([400, 380], { from: hidden });
    // sanity: an actual upward move still reveals
    expect(visible.visible).toBe(true);
  });

  it('a direction reversal resets the accumulator (down-up-down needs fresh commitment)', () => {
    const hidden = run([0, 400]);
    // Up 3px (uncommitted), then down 3px (uncommitted): still hidden…
    const wobble = run([397, 400], { from: hidden });
    expect(wobble.visible).toBe(false);
    // …and up past the commit threshold reveals.
    const revealed = run([397, 400, 395], { from: hidden });
    expect(revealed.visible).toBe(true);
  });

  it('focus always wins: a focused input never hides', () => {
    const state = run([0, 500, 900], { focused: true });
    expect(state.visible).toBe(true);
  });

  it('exports sane constants', () => {
    expect(REVEAL_NEAR_TOP_PX).toBeGreaterThan(0);
    expect(HIDE_AFTER_PX).toBeGreaterThan(REVEAL_NEAR_TOP_PX);
    expect(DIRECTION_COMMIT_PX).toBeGreaterThan(0);
  });
});

describe('scrollTopOf', () => {
  it('reads scrollTop from an element target', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollTop', { value: 123, configurable: true });
    expect(scrollTopOf(el, document)).toBe(123);
  });

  it('reads the document scroller for a Document target', () => {
    const scroller = document.scrollingElement ?? document.documentElement;
    const original = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(scroller),
      'scrollTop',
    );
    Object.defineProperty(scroller, 'scrollTop', { value: 77, configurable: true });
    try {
      expect(scrollTopOf(document, document)).toBe(77);
    } finally {
      // jsdom shares the element across tests — restore.
      if (original) Object.defineProperty(scroller, 'scrollTop', original);
      else delete (scroller as unknown as Record<string, unknown>).scrollTop;
    }
  });

  it('returns 0 for a null target', () => {
    expect(scrollTopOf(null, document)).toBe(0);
  });
});

describe('watchSearchVisibility', () => {
  function scrollable(scrollTop: number): HTMLDivElement {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollTop', {
      value: scrollTop,
      configurable: true,
      writable: true,
    });
    document.body.appendChild(el);
    return el;
  }

  it('fires onChange(false) when an inner container scrolls decisively down (capture phase)', () => {
    const el = scrollable(0);
    const onChange = vi.fn();
    const stop = watchSearchVisibility({ isFocused: () => false, onChange });
    (el as unknown as { scrollTop: number }).scrollTop = 300;
    el.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(onChange).toHaveBeenCalledWith(false);
    stop();
    el.remove();
  });

  it('fires onChange(true) again on scroll-up and stops after cancel', () => {
    const el = scrollable(0);
    const onChange = vi.fn();
    const stop = watchSearchVisibility({ isFocused: () => false, onChange });
    (el as unknown as { scrollTop: number }).scrollTop = 300;
    el.dispatchEvent(new Event('scroll'));
    (el as unknown as { scrollTop: number }).scrollTop = 280;
    el.dispatchEvent(new Event('scroll'));
    expect(onChange).toHaveBeenLastCalledWith(true);

    stop();
    onChange.mockClear();
    (el as unknown as { scrollTop: number }).scrollTop = 600;
    el.dispatchEvent(new Event('scroll'));
    expect(onChange).not.toHaveBeenCalled();
    el.remove();
  });

  it('ignores scrollers that do not contain the anchor (the tiny-scroller reveal bug)', () => {
    // The observed flake: mobile-controls pass 2 pushes EVERY scrollable to
    // its bottom. An unrelated scroller with a 2-8px range then reports a
    // near-top offset and would re-reveal the bar over the list. With the
    // anchor filter, only the input's own scrollport chain votes.
    const listScroller = scrollable(0);
    const anchor = document.createElement('input');
    listScroller.appendChild(anchor);
    const tiny = scrollable(0);

    const onChange = vi.fn();
    const stop = watchSearchVisibility({
      isFocused: () => false,
      onChange,
      anchor: () => anchor,
    });

    (listScroller as unknown as { scrollTop: number }).scrollTop = 400;
    listScroller.dispatchEvent(new Event('scroll'));
    expect(onChange).toHaveBeenLastCalledWith(false);

    // The unrelated scroller lands at 3px — inside the near-top zone. It
    // must NOT flip the bar back on.
    onChange.mockClear();
    (tiny as unknown as { scrollTop: number }).scrollTop = 3;
    tiny.dispatchEvent(new Event('scroll'));
    expect(onChange).not.toHaveBeenCalled();

    stop();
    listScroller.remove();
    tiny.remove();
  });

  it('keeps the bar visible while the input is focused, whatever the scroll does', () => {
    const el = scrollable(0);
    const onChange = vi.fn();
    const stop = watchSearchVisibility({ isFocused: () => true, onChange });
    (el as unknown as { scrollTop: number }).scrollTop = 500;
    el.dispatchEvent(new Event('scroll'));
    expect(onChange).not.toHaveBeenCalledWith(false);
    stop();
    el.remove();
  });
});
