import type { Bar, Coords } from '@/types';
import { haversineMiles } from '@/lib/distance';

/**
 * arrangeWidenedHand — the "widening deals a fresh hand" product rule
 * (goal g-d3f8d912, operator 2026-08-02).
 *
 * Pure-proximity ranking meant Walkable → Worth a cab → Anywhere could
 * re-deal the same nearest five bars: every bar valid at the narrow
 * radius stays valid — and best-ranked — at the wider one. The rule:
 * a widened hand prefers bars NEWLY ELIGIBLE at the wider radius, then
 * other unseen bars anywhere within it, and reuses previously shown bars
 * only when the pool cannot otherwise fill the count.
 *
 * This is an ARRANGEMENT, not a ranking: `ranked` arrives already scored
 * and hard-filtered by matches() (vibe, business status, staleness,
 * radius, visited/seed exclusions), and relative order within each
 * bucket is preserved exactly — no randomness, no re-scoring, so hands
 * stay deterministic and explainable (acceptance 5).
 *
 * Degradations are honest (acceptance 6): without coords or a known
 * previous radius the newly-eligible bucket is empty and the hand is
 * simply unseen-first; a pool smaller than `count` yields a short hand.
 */
export type WidenedHand = {
  hand: Bar[];
  /** True when the hand had to reuse previously shown bars to fill. */
  usedFallback: boolean;
};

export function arrangeWidenedHand(args: {
  /** Full ranked eligibility list at the NEW radius, best first. */
  ranked: readonly Bar[];
  coords: Coords | null;
  /** The radius in force before the widening tap; null = unknown. */
  prevMaxMiles: number | null;
  /** Bars already shown this search context (soft — never hard-excluded here). */
  seenIds: readonly string[];
  count: number;
}): WidenedHand {
  const { ranked, coords, prevMaxMiles, seenIds, count } = args;
  const seen = new Set(seenIds);

  const newlyEligible: Bar[] = [];
  const unseen: Bar[] = [];
  const fallback: Bar[] = [];
  // Belt-and-braces id dedup (santa: DeepSeek): ids are unique upstream by
  // construction (bars table PK; static catalog), but the paged catalog
  // fetch can theoretically duplicate a row across a page boundary, and a
  // duplicate here would burn two hand slots on one bar.
  const placed = new Set<string>();
  for (const bar of ranked) {
    if (placed.has(bar.id)) continue;
    placed.add(bar.id);
    if (seen.has(bar.id)) {
      fallback.push(bar);
    } else if (
      coords !== null &&
      prevMaxMiles !== null &&
      haversineMiles(coords, bar) > prevMaxMiles
    ) {
      newlyEligible.push(bar);
    } else {
      unseen.push(bar);
    }
  }

  const hand = [...newlyEligible, ...unseen, ...fallback].slice(0, count);
  const usedFallback = hand.some((bar) => seen.has(bar.id));
  return { hand, usedFallback };
}
