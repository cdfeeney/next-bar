import type { Bar, VibeTag } from '@/types';
import type { BarRating } from '@/types/ratings';

/**
 * Learned taste from numeric scores (V8 P1 ranking contract).
 *
 * The approved model, verbatim from docs/V8-PRD-2026-08-13.md:
 *
 *   w = (score - 5.5) / 4.5
 *   A(tag) = Σw / (tag observation count + 5)
 *   c = N / (N + 10)
 *
 * These constants are explicit product assumptions. Do not change them
 * silently — a change here is a product decision, not a tuning knob.
 *
 * Scores are GRADED evidence: 5.5 is neutral, a 2.0 pushes its tags down as
 * hard as a 9.0 pushes them up, and repeated observations accumulate. This
 * replaces the old Set-of-loved-tags model, under which one Loved pub was
 * indistinguishable from two hundred and low scores vanished entirely.
 */

/** The approved score range. Out-of-range persisted values are clamped here. */
const SCORE_MIN = 1;
const SCORE_MAX = 10;

/** w = 0 here; the ends of the 1.0–10.0 range map to w = -1 and w = +1. */
const SCORE_MIDPOINT = 5.5;
const SCORE_HALF_RANGE = 4.5;

/** Per-tag shrinkage: one observation must not swing the rank like twenty. */
const TAG_SHRINKAGE = 5;

/** Cold-start shrinkage: quiz taste dominates while rating history is small. */
const CONFIDENCE_SHRINKAGE = 10;

export type LearnedTaste = {
  /** A(tag) for every tag the user has scored evidence on. */
  readonly affinity: ReadonlyMap<VibeTag, number>;
  /** N — scored ratings that landed on a catalog bar. */
  readonly n: number;
  /** c = N/(N+10) — how far learned taste outweighs the quiz prior. */
  readonly confidence: number;
};

export const EMPTY_TASTE: LearnedTaste = {
  affinity: new Map(),
  n: 0,
  confidence: 0,
};

/**
 * Pure: ratings + catalog -> per-tag affinity.
 *
 * Only ratings carrying a numeric score are evidence. An unscored rating is
 * not treated as neutral or midpoint — it is simply absent, because inventing
 * a score for it would be fabricating evidence the user never gave. Ratings on
 * bars outside the supplied catalog are skipped (no tags to attribute).
 *
 * NOT capped to the Settings top-five display tags: that cap is a presentation
 * choice in tasteProfile.ts and must not truncate ranker evidence.
 */
export function deriveLearnedTaste(
  ratings: readonly BarRating[],
  bars: readonly Bar[],
): LearnedTaste {
  const barById = new Map(bars.map((b) => [b.id, b]));

  const sumW = new Map<VibeTag, number>();
  const obs = new Map<VibeTag, number>();
  let n = 0;

  for (const r of ratings) {
    if (typeof r.score !== 'number' || !Number.isFinite(r.score)) continue;
    const bar = barById.get(r.barId);
    if (!bar) continue;

    n += 1;
    // Clamp at the trust boundary. Persisted ratings are NOT score-validated
    // (isBarRating in ratings.ts checks barId/rating/ratedAt only) and there is
    // no DB check constraint yet, so a tampered or legacy row can carry any
    // finite number. Unclamped, repeated extreme values overflow Σw to
    // Infinity and mixed signs yield NaN, which silently defeats the ranking
    // comparator and lets distance decide a non-tie.
    const score = Math.min(SCORE_MAX, Math.max(SCORE_MIN, r.score));
    const w = (score - SCORE_MIDPOINT) / SCORE_HALF_RANGE;
    for (const tag of bar.tags) {
      sumW.set(tag, (sumW.get(tag) ?? 0) + w);
      obs.set(tag, (obs.get(tag) ?? 0) + 1);
    }
  }

  const affinity = new Map<VibeTag, number>();
  for (const [tag, total] of sumW) {
    affinity.set(tag, total / ((obs.get(tag) ?? 0) + TAG_SHRINKAGE));
  }

  return {
    affinity,
    n,
    confidence: n / (n + CONFIDENCE_SHRINKAGE),
  };
}

/**
 * A bar's learned-taste value: the MEAN of A(tag) over its tags.
 *
 * The PRD fixes A(tag) but not how a bar's tags combine into one number.
 * Mean (not sum) is the implementation choice: summing would rank a bar higher
 * for merely carrying more tags, which is a catalog artifact rather than
 * taste. Flagged as an implementation choice, not a silent product decision.
 */
export function learnedTasteScore(
  bar: Pick<Bar, 'tags'>,
  taste: LearnedTaste,
): number {
  if (bar.tags.length === 0) return 0;
  let total = 0;
  for (const tag of bar.tags) total += taste.affinity.get(tag) ?? 0;
  return total / bar.tags.length;
}
