import type {
  Bar,
  Coords,
  ManhattanNeighborhood,
  VibeProfile,
  VibeTag,
} from '@/types';
import { haversineMiles } from '@/lib/distance';
import { daysAgo } from '@/lib/freshness';
import {
  DIST_DECAY_MILES,
  DIST_WEIGHT,
  JACCARD_FLOOR,
  JACCARD_START,
  JACCARD_STEP,
  LAST_VERIFIED_HARD_FILTER_DAYS,
  MAX_RESULTS,
  MIN_CANDIDATES,
  RATING_WEIGHT,
  VIBE_WEIGHT,
} from '@/lib/constants';

export function jaccard(a: VibeTag[], b: VibeTag[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const tag of setA) {
    if (setB.has(tag)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

export function vibeMatchBadge(
  user: VibeTag[],
  bar: VibeTag[],
): { num: number; den: number } {
  const setUser = new Set(user);
  const setBar = new Set(bar);
  let num = 0;
  for (const tag of setUser) {
    if (setBar.has(tag)) num += 1;
  }
  const den = Math.max(1, Math.min(setUser.size, setBar.size));
  return { num, den };
}

export type MatchesArgs = {
  profile: VibeProfile;
  coords: Coords | null;
  preferredNeighborhoods: ManhattanNeighborhood[];
  maxMiles: number | null;
  bars: Bar[];
  excludeIds?: string[];
  maxResults?: number;
  now?: Date;
  /**
   * Flattened vibe tags from the bars the user has Loved, used to nudge
   * bars with a similar taste profile up the rank. Optional — when omitted
   * or empty, the affinity term is 0 and ranking falls back to vibe +
   * proximity only (fully backward-compatible).
   */
  lovedTags?: VibeTag[];
};

/**
 * Blended ranking score in [0, 1]. Replaces the old pure-distance / pure-jaccard
 * sort so vibe strength is never discarded from the final order once GPS is on.
 *
 *   score = VIBE_WEIGHT·jaccard(user, bar)
 *         + DIST_WEIGHT·proximity            (exp decay; 1 when no coords)
 *         + RATING_WEIGHT·lovedAffinity      (jaccard(bar tags, loved tags))
 *
 * All three terms are in [0, 1] and the weights sum to 1, so no axis can
 * dominate by scale. With coords === null the proximity term is a constant 1
 * for every bar, so it drops out of the ordering and the rank reduces to vibe
 * (+ loved affinity) — matching the pre-GPS behavior.
 */
export function scoreBar(
  bar: Bar,
  userTags: VibeTag[],
  coords: Coords | null,
  lovedTags: VibeTag[],
): number {
  const vibe = jaccard(userTags, bar.tags);
  const proximity = coords
    ? Math.exp(-haversineMiles(coords, bar) / DIST_DECAY_MILES)
    : 1;
  const affinity = lovedTags.length > 0 ? jaccard(bar.tags, lovedTags) : 0;
  return VIBE_WEIGHT * vibe + DIST_WEIGHT * proximity + RATING_WEIGHT * affinity;
}

export function matches(args: MatchesArgs): Bar[] {
  const {
    profile,
    coords,
    preferredNeighborhoods,
    maxMiles,
    bars,
    excludeIds,
    maxResults,
    now,
    lovedTags = [],
  } = args;

  const exclude = new Set(excludeIds ?? []);
  let pool = bars
    .filter((b) => !exclude.has(b.id))
    .filter((b) => daysAgo(b.lastVerified, now) <= LAST_VERIFIED_HARD_FILTER_DAYS);

  if (preferredNeighborhoods.length > 0) {
    const allowed = new Set(preferredNeighborhoods);
    pool = pool.filter((b) => allowed.has(b.neighborhood));
  }

  if (coords && maxMiles !== null) {
    pool = pool.filter((b) => haversineMiles(coords, b) <= maxMiles);
  }

  let candidates: Bar[];
  if (profile.tags.length === 0) {
    // No vibe preference (e.g. location-first "suggest near me" before the quiz
    // is taken). The Jaccard filter would reject every bar — jaccard(vs []) is
    // always 0, below the floor — so skip it entirely and let the blended score
    // rank the whole pool by proximity (+ loved affinity).
    candidates = pool;
  } else {
    let threshold = JACCARD_START;
    candidates = [];
    while (threshold >= JACCARD_FLOOR - 1e-9 && candidates.length < MIN_CANDIDATES) {
      candidates = pool.filter((b) => jaccard(profile.tags, b.tags) >= threshold);
      if (candidates.length >= MIN_CANDIDATES) break;
      threshold = Math.round((threshold - JACCARD_STEP) * 100) / 100;
    }
  }

  // Rank by the blended score (vibe + proximity + loved affinity). Compute each
  // bar's score once, then sort, rather than recomputing inside the comparator.
  const ranked = candidates
    .map((bar) => ({ bar, score: scoreBar(bar, profile.tags, coords, lovedTags) }))
    .sort((a, b) => b.score - a.score);

  const cap = maxResults ?? MAX_RESULTS;
  return ranked.slice(0, cap).map((r) => r.bar);
}
