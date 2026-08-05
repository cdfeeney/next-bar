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
  function fakeScroller(scrollTop: number, scrollHeight: number, clientHeight: number) {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
    return el;
  }

  it('reads scrollTop from an element target', () => {
    expect(scrollTopOf(fakeScroller(123, 2000, 800), document)).toBe(123);
  });

  it('clamps offsets outside the legal range (rubber-band overscroll)', () => {
    expect(scrollTopOf(fakeScroller(1300, 2000, 800), document)).toBe(1200);
    expect(scrollTopOf(fakeScroller(-15, 2000, 800), document)).toBe(0);
  });

  it('reads the document scroller for a Document target', () => {
    const scroller = document.scrollingElement ?? document.documentElement;
    const restore = ['scrollTop', 'scrollHeight', 'clientHeight'].map((k) => ({
      k,
      d: Object.getOwnPropertyDescriptor(scroller, k),
    }));
    Object.defineProperty(scroller, 'scrollTop', { value: 77, configurable: true });
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
    try {
      expect(scrollTopOf(document, document)).toBe(77);
    } finally {
      // jsdom shares the element across tests — restore.
      for (const { k, d } of restore) {
        if (d) Object.defineProperty(scroller, k, d);
        else delete (scroller as unknown as Record<string, unknown>)[k];
      }
    }
  });

  it('returns 0 for a null target', () => {
    expect(scrollTopOf(null, document)).toBe(0);
  });
});

describe('watchSearchVisibility', () => {
  function scrollable(
    scrollTop: number,
    opts: { scrollHeight?: number; clientHeight?: number; declared?: boolean } = {},
  ): HTMLDivElement {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollTop', {
      value: scrollTop,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(el, 'scrollHeight', {
      value: opts.scrollHeight ?? 2000,
      configurable: true,
    });
    Object.defineProperty(el, 'clientHeight', {
      value: opts.clientHeight ?? 800,
      configurable: true,
    });
    // `declared: true` marks the element as a REAL scroll container in
    // computed style, which is what subscribe-time seeding walks for.
    if (opts.declared) el.style.overflowY = 'auto';
    document.body.appendChild(el);
    return el;
  }

  it('fires onChange(false) when an inner container scrolls decisively down (capture phase)', () => {
    const el = scrollable(0);
    const onChange = vi.fn();
    const handle = watchSearchVisibility({ isFocused: () => false, onChange });
    (el as unknown as { scrollTop: number }).scrollTop = 300;
    el.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(onChange).toHaveBeenCalledWith(false);
    handle.stop();
    el.remove();
  });

  it('fires onChange(true) again on scroll-up and stops after cancel', () => {
    const el = scrollable(0);
    const onChange = vi.fn();
    const handle = watchSearchVisibility({ isFocused: () => false, onChange });
    (el as unknown as { scrollTop: number }).scrollTop = 300;
    el.dispatchEvent(new Event('scroll'));
    (el as unknown as { scrollTop: number }).scrollTop = 280;
    el.dispatchEvent(new Event('scroll'));
    expect(onChange).toHaveBeenLastCalledWith(true);

    handle.stop();
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
    const handle = watchSearchVisibility({
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

    handle.stop();
    listScroller.remove();
    tiny.remove();
  });

  it('keeps the bar visible while the input is focused, whatever the scroll does', () => {
    const el = scrollable(0);
    const onChange = vi.fn();
    const handle = watchSearchVisibility({ isFocused: () => true, onChange });
    (el as unknown as { scrollTop: number }).scrollTop = 500;
    el.dispatchEvent(new Event('scroll'));
    expect(onChange).not.toHaveBeenCalledWith(false);
    handle.stop();
    el.remove();
  });

  it('reveal() is the single writer: after a focus reveal, continued scroll-down hides again', () => {
    // Round-1 panel HIGH (Claude Opus lane, independently found by Codex):
    // a focus handler that writes React state directly desyncs the watcher's
    // change-dedup cache — the next downward scroll computes hidden==hidden
    // and never fires, leaving the bar stuck visible. reveal() must flow
    // through the watcher so there is exactly one writer.
    const el = scrollable(0);
    const onChange = vi.fn();
    const handle = watchSearchVisibility({ isFocused: () => false, onChange });

    (el as unknown as { scrollTop: number }).scrollTop = 400;
    el.dispatchEvent(new Event('scroll'));
    expect(onChange).toHaveBeenLastCalledWith(false);

    handle.reveal();
    expect(onChange).toHaveBeenLastCalledWith(true);

    (el as unknown as { scrollTop: number }).scrollTop = 700;
    el.dispatchEvent(new Event('scroll'));
    expect(onChange).toHaveBeenLastCalledWith(false);

    handle.stop();
    el.remove();
  });

  it('a sub-threshold wobble after reveal() does not re-hide (stale per-scroller state)', () => {
    // Round-2 panel HIGH/MED (Opus reproduced it; Codex converged): reveal()
    // used to flip only the published closure while the scroller's stored
    // state kept visible:false — the next event that crossed no threshold
    // (e.g. the tiny scroll browsers fire when the keyboard collapses on
    // blur) republished the stale false and the bar vanished on an upward
    // nudge. The published value must be the ONLY visibility continuation.
    const el = scrollable(0);
    const onChange = vi.fn();
    const handle = watchSearchVisibility({ isFocused: () => false, onChange });

    (el as unknown as { scrollTop: number }).scrollTop = 600;
    el.dispatchEvent(new Event('scroll'));
    expect(onChange).toHaveBeenLastCalledWith(false);

    handle.reveal();
    expect(onChange).toHaveBeenLastCalledWith(true);

    onChange.mockClear();
    // 2px upward wobble — under DIRECTION_COMMIT_PX, opposite direction.
    (el as unknown as { scrollTop: number }).scrollTop = 598;
    el.dispatchEvent(new Event('scroll'));
    expect(onChange).not.toHaveBeenCalledWith(false);

    handle.stop();
    el.remove();
  });

  it('clamps overscroll: rubber-band snap-back from past the bottom does not reveal', () => {
    // Round-1 panel MEDIUM (Codex; DeepSeek reached the same case): WebKit
    // rubber-banding reports offsets past the legal maximum, and the
    // snap-back to max would read as an upward gesture. Clamped, the whole
    // bounce is dy=0.
    const el = scrollable(0, { scrollHeight: 2000, clientHeight: 800 }); // max 1200
    const onChange = vi.fn();
    const handle = watchSearchVisibility({ isFocused: () => false, onChange });

    (el as unknown as { scrollTop: number }).scrollTop = 1150;
    el.dispatchEvent(new Event('scroll'));
    expect(onChange).toHaveBeenLastCalledWith(false);

    onChange.mockClear();
    (el as unknown as { scrollTop: number }).scrollTop = 1300; // overscroll past max
    el.dispatchEvent(new Event('scroll'));
    (el as unknown as { scrollTop: number }).scrollTop = 1200; // snap back to max
    el.dispatchEvent(new Event('scroll'));
    expect(onChange).not.toHaveBeenCalledWith(true);

    handle.stop();
    el.remove();
  });

  it('subscribing while already deep-scrolled publishes hidden immediately (mount/restore)', () => {
    // Round-1 panel MEDIUM, triple convergence (Codex, DeepSeek, GLM): the
    // picker can mount with the scroller already deep (in-place step swap,
    // back/forward scroll restoration) and no scroll event ever fires.
    const listScroller = scrollable(500, { declared: true });
    const anchor = document.createElement('input');
    listScroller.appendChild(anchor);

    const onChange = vi.fn();
    const handle = watchSearchVisibility({
      isFocused: () => false,
      onChange,
      anchor: () => anchor,
    });
    expect(onChange).toHaveBeenCalledWith(false);

    handle.stop();
    listScroller.remove();
  });

  it('recomputes from real offsets when the document becomes visible again', () => {
    // Round-1 GLM edge: a deferred catalog swap can commit while the tab is
    // hidden, and the browser may clamp scrollTop with NO scroll event — the
    // bar would otherwise stay stranded hidden at what is now the top.
    const listScroller = scrollable(500, { declared: true });
    const anchor = document.createElement('input');
    listScroller.appendChild(anchor);

    const onChange = vi.fn();
    const handle = watchSearchVisibility({
      isFocused: () => false,
      onChange,
      anchor: () => anchor,
    });
    expect(onChange).toHaveBeenLastCalledWith(false);

    (listScroller as unknown as { scrollTop: number }).scrollTop = 0;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onChange).toHaveBeenLastCalledWith(true);

    handle.stop();
    listScroller.remove();
  });
});
