/**
 * Search-bar auto-hide — g-90f908bc.
 *
 * THE PROBLEM. BarPicker's search input is `sticky top-0` over a ~975-row
 * list. A pinned opaque bar over a scrolling list means that at ANY deep rest
 * position some row straddles it — its centre point resolves to the bar, so
 * the row is untappable right where it sits. e2e/mobile-controls.spec.ts
 * pass 2 catches exactly that on `/` (at rest, scrolled to bottom), and the
 * assertion is correct: the covered card genuinely cannot be tapped without
 * first nudging it out from under the bar.
 *
 * THE FIX (product behavior, not spec exemption). The canonical mobile
 * pattern: hide the bar while the user scrolls DOWN, reveal it the moment
 * they scroll UP or return near the top. Search stays one small gesture away
 * from any depth, and nothing opaque covers a resting row. Hidden means
 * `opacity-0 pointer-events-none` — layout is preserved (no reflow, no
 * interaction with deferredCatalogSwap) and hit-testing passes through to
 * the card underneath.
 *
 * ⚠️ TWO TRAPS, BOTH INHERITED FROM SIBLING MODULES:
 *
 * 1. Inner scrollers (deferredCatalogSwap's trap): this app scrolls inner
 *    containers on several surfaces — scrolls there do NOT bubble to window,
 *    only the capture phase sees them. The watcher binds capture-phase.
 *
 * 2. Per-event deltas (caught in this goal's consult round): a mobile fling
 *    or smooth programmatic scroll emits a stream of 1–3px scroll events. A
 *    per-event `dy > threshold` gate would never fire and the bar would never
 *    hide. Direction commitment must be judged on the CUMULATIVE delta since
 *    the last direction change, not on any single event.
 *
 * A11Y DECISION (consult round): the hidden input stays in the accessibility
 * tree and stays focusable — focus (Shift+Tab, SR focus, autofocus) forces it
 * visible again. `aria-hidden` would drop it from the tab order and make
 * search unreachable from deep positions for keyboard users, which is the
 * worse trade. This matches the standard hide-on-scroll app-bar semantics.
 */

/** At or above this scroll offset the bar is unconditionally visible. */
export const REVEAL_NEAR_TOP_PX = 8;

/**
 * Never hide before the user is at least this far down: hiding the bar while
 * its own resting slot is still on screen would look like it vanished.
 */
export const HIDE_AFTER_PX = 56;

/**
 * Cumulative same-direction travel that commits a direction. Small enough
 * that a one-finger nudge reveals, large enough that ±1px momentum jitter
 * does not flap the bar.
 */
export const DIRECTION_COMMIT_PX = 4;

export type AutoHideState = {
  visible: boolean;
  /** Last observed scroll offset for this scroller. */
  lastY: number;
  /**
   * Cumulative signed travel in the current direction; resets when the
   * direction reverses. Positive = down.
   */
  acc: number;
};

export function initialAutoHideState(y = 0): AutoHideState {
  return { visible: true, lastY: y, acc: 0 };
}

/** Advance the machine with a new absolute scroll offset. Pure. */
export function nextAutoHideState(
  state: AutoHideState,
  y: number,
  isFocused: boolean,
): AutoHideState {
  const dy = y - state.lastY;
  // Direction reversal abandons the previous commitment.
  const acc = (dy >= 0) === (state.acc >= 0) ? state.acc + dy : dy;

  let visible = state.visible;
  if (isFocused) {
    visible = true;
  } else if (y <= REVEAL_NEAR_TOP_PX) {
    visible = true;
  } else if (acc > DIRECTION_COMMIT_PX && y > HIDE_AFTER_PX) {
    visible = false;
  } else if (acc < -DIRECTION_COMMIT_PX) {
    visible = true;
  }

  return { visible, lastY: y, acc };
}

/**
 * Current scroll offset of whatever fired the event, CLAMPED to the
 * scroller's legal range. WebKit rubber-banding reports offsets past the
 * maximum (and below zero at the top); the snap-back from an overshoot would
 * otherwise read as a committed opposite-direction gesture and re-reveal the
 * bar at bottom rest (round-1 panel: Codex and DeepSeek independently).
 * Clamped, the entire bounce is dy=0.
 */
export function scrollTopOf(target: EventTarget | null, doc: Document): number {
  if (!target) return 0;
  const el =
    target instanceof HTMLElement
      ? target
      : ((doc.scrollingElement ?? doc.documentElement) as HTMLElement | null);
  if (!el) return 0;
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  return Math.min(Math.max(0, el.scrollTop), max);
}

export type WatchOptions = {
  /** True while the search input owns focus — the bar never hides then. */
  isFocused: () => boolean;
  /** Called with the new visibility ONLY when it changes. */
  onChange: (visible: boolean) => void;
  /**
   * The element whose scrollport chain decides visibility — the search input.
   * Only the document and ancestor scrollers of this element are listened to.
   * Without this filter, ANY scrollable on the page feeds the machine: a
   * 2–8px-deep incidental scroller pushed to its own bottom reports a
   * near-top offset and re-reveals the bar over the list it has nothing to
   * do with (observed: device-dependent flake in mobile-controls pass 2,
   * because whether such a scroller even exists depends on sub-pixel layout).
   */
  anchor?: () => HTMLElement | null;
  doc?: Document;
};

export type WatchHandle = {
  stop: () => void;
  /**
   * Reveal through the watcher — the SINGLE writer of visibility. A focus
   * handler that writes the consumer's state directly desyncs this module's
   * change-dedup cache: the next downward scroll computes hidden==hidden,
   * never fires onChange, and the bar sticks visible over the list
   * (round-1 panel HIGH — Claude lane, independently found by Codex).
   */
  reveal: () => void;
};

/**
 * Subscribe to every scroller on the page (document and inner containers
 * alike) and drive `onChange`. Callers in effects must call `stop()` on
 * unmount, same contract as deferUntilSafe's cancel.
 *
 * Each scroller gets its own state entry (a WeakMap keyed by the event
 * target), so a dialog's inner list and the document cannot corrupt each
 * other's direction accumulators.
 */
export function watchSearchVisibility(options: WatchOptions): WatchHandle {
  const doc = options.doc ?? document;
  const win = doc.defaultView;
  const states = new WeakMap<EventTarget, AutoHideState>();
  let visible = true;

  const publish = (next: boolean): void => {
    if (next !== visible) {
      visible = next;
      options.onChange(next);
    }
  };

  /**
   * The scrollers that actually move the anchor: the document plus every
   * ancestor that declares itself a vertical scroll container.
   */
  const relevantScrollers = (): EventTarget[] => {
    const targets: EventTarget[] = [doc];
    let node = options.anchor?.()?.parentElement ?? null;
    while (node && node !== doc.body) {
      const oy = win?.getComputedStyle(node).overflowY;
      if (oy === 'auto' || oy === 'scroll') targets.push(node);
      node = node.parentElement;
    }
    return targets;
  };

  /**
   * Re-derive visibility from CURRENT offsets, replacing accumulated
   * direction state. Used at subscribe (the picker can mount with the
   * scroller already deep: in-place step swap, back/forward scroll
   * restoration — no scroll event ever fires; round-1 panel, found
   * independently by Codex, DeepSeek and GLM) and when the tab becomes
   * visible again (a deferred catalog swap committed while hidden can shrink
   * scrollHeight and the browser clamps scrollTop silently — GLM).
   */
  const resample = (): void => {
    const sampled = relevantScrollers().map((target) => ({
      target,
      y: scrollTopOf(target, doc),
    }));
    const anyDeep = sampled.some(({ y }) => y > HIDE_AFTER_PX);
    const next = options.isFocused() || !anyDeep;
    for (const { target, y } of sampled) {
      states.set(target, { visible: next, lastY: y, acc: 0 });
    }
    publish(next);
  };

  const onScroll = (event: Event): void => {
    const target = event.target;
    if (!target) return;
    // Only scrollers that actually move the search input may vote: the
    // document always does; an element scroller only if the input is inside
    // it. Unrelated scrollables (however deep or shallow) are noise.
    const anchorEl = options.anchor?.() ?? null;
    if (anchorEl && target instanceof HTMLElement && !target.contains(anchorEl)) return;
    const y = scrollTopOf(target, doc);
    const stored = states.get(target) ?? initialAutoHideState();
    // The PUBLISHED value is the only visibility continuation. Per-scroller
    // storage carries lastY/acc alone: a stored `visible` would be a second
    // source of truth that reveal() (or any future writer) can leave stale,
    // and a later sub-threshold event would republish it — the bar hiding on
    // a 2px upward nudge right after a focus reveal (round-2 panel, found
    // independently by two lanes, reproduced against the shipped module).
    const next = nextAutoHideState({ ...stored, visible }, y, options.isFocused());
    states.set(target, next);
    publish(next.visible);
  };

  const onVisibility = (): void => {
    if (doc.visibilityState === 'visible') resample();
  };

  // Capture phase — inner-container scrolls do not bubble (trap #1).
  win?.addEventListener('scroll', onScroll, { capture: true, passive: true });
  doc.addEventListener('visibilitychange', onVisibility);
  resample();

  return {
    stop: () => {
      win?.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      doc.removeEventListener('visibilitychange', onVisibility);
    },
    reveal: () => publish(true),
  };
}
