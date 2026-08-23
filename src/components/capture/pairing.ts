/**
 * Dual-shot pairing — the pure half of `next-bar-camera-modes.png`'s paired
 * composition step. Kept out of the component so the three edits the canvas
 * locks (swap main, keep only one, rotate either) are testable without a
 * camera, a canvas, or a browser.
 *
 * Immutable by construction: every operation returns a new pair.
 */

export type Pair = {
  /** The photo that fills the frame. */
  main: string;
  /** The inset. Null once the user keeps only one shot. */
  inset: string | null;
};

/** Swap which of the two shots fills the frame. A no-op on a single photo. */
export function swapMain(pair: Pair): Pair {
  if (pair.inset === null) return pair;
  return { main: pair.inset, inset: pair.main };
}

/**
 * Keep only one of the pair. Keeping the inset promotes it to main, so the
 * result is always a valid single photo rather than an empty frame.
 */
export function keepOnly(pair: Pair, which: 'main' | 'inset'): Pair {
  if (which === 'main') return { main: pair.main, inset: null };
  if (pair.inset === null) return pair;
  return { main: pair.inset, inset: null };
}

/** Replace one side with an already-rotated data URL. */
export function replaceSide(
  pair: Pair,
  which: 'main' | 'inset',
  url: string,
): Pair {
  if (which === 'main') return { ...pair, main: url };
  if (pair.inset === null) return pair;
  return { ...pair, inset: url };
}

/** A pair is a dual shot only while both halves survive. */
export function pairKind(pair: Pair): 'single' | 'dual' {
  return pair.inset === null ? 'single' : 'dual';
}
