import type {
  Bar,
  Coords,
  ManhattanNeighborhood,
  VibeProfile,
  VibeTag,
} from '@/types';
import { haversineMiles } from '@/lib/distance';
import { daysAgo } from '@/lib/freshness';
import { effectiveNight } from '@/lib/cadence';
import {
  DIST_DECAY_MILES,
  DIST_WEIGHT,
  LATE_CLUB_BOOST,
  LATE_NIGHT_END_HOUR,
  LATE_NIGHT_START_HOUR,
  LATE_RESTAURANT_PENALTY,
  EXPLORATION_MIN_RESULTS,
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
   * Live-surface clock for the LATE-NIGHT bias (operator 2026-07-27):
   * between LATE_NIGHT_START_HOUR and LATE_NIGHT_END_HOUR, club/dance
   * venues get a small additive boost and restaurant-bars a small
   * penalty — nightlife first when it's nightlife o'clock. Omitted on
   * quiz/planning surfaces (they browse, not "right now").
   */
  biasNow?: Date;
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

/** 10pm–3:59am local — when the night bias applies. */
export function isLateNight(now: Date): boolean {
  const h = now.getHours();
  return h >= LATE_NIGHT_START_HOUR || h < LATE_NIGHT_END_HOUR;
}

/**
 * Additive late-night nudge at tie-breaker scale: genuine nightlife
 * (club/dance) up, restaurant-bars down — unless the venue is BOTH (a
 * restaurant that becomes a club keeps its night credibility).
 */
export function lateNightAdjustment(bar: Pick<Bar, 'tags'>): number {
  const isClub = bar.tags.includes('club') || bar.tags.includes('dance');
  if (isClub) return LATE_CLUB_BOOST;
  if (bar.tags.includes('restaurant-bar')) return -LATE_RESTAURANT_PENALTY;
  return 0;
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
    biasNow,
    lovedTags = [],
  } = args;

  const exclude = new Set(excludeIds ?? []);
  let pool = bars
    .filter((b) => !exclude.has(b.id))
    // Never SUGGEST a dead bar: Places refresh (2026-07-23) found ~31
    // catalog bars permanently closed. Badge-only handling isn't enough —
    // the matcher must hard-filter them.
    .filter((b) => b.businessStatus !== 'CLOSED_PERMANENTLY')
    .filter((b) => daysAgo(b.lastVerified, now) <= LAST_VERIFIED_HARD_FILTER_DAYS);

  if (preferredNeighborhoods.length > 0) {
    const allowed = new Set(preferredNeighborhoods);
    pool = pool.filter((b) => allowed.has(b.neighborhood));
  }

  if (coords && maxMiles !== null) {
    pool = pool.filter((b) => haversineMiles(coords, b) <= maxMiles);
  }

  const cap = maxResults ?? MAX_RESULTS;
  // QA-6: the relax loop fills the REQUESTED page, not the legacy
  // 3-result minimum — "5 suggestions everywhere" must not stop relaxing
  // at 4 candidates. The blended score still ranks best-first, so bars
  // admitted by a relaxed threshold naturally sit at the bottom.
  const relaxTarget = Math.max(MIN_CANDIDATES, cap);

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
    while (threshold >= JACCARD_FLOOR - 1e-9 && candidates.length < relaxTarget) {
      candidates = pool.filter((b) => jaccard(profile.tags, b.tags) >= threshold);
      if (candidates.length >= relaxTarget) break;
      threshold = Math.round((threshold - JACCARD_STEP) * 100) / 100;
    }
  }

  // Rank by the blended score (vibe + proximity + loved affinity). Compute each
  // bar's score once, then sort, rather than recomputing inside the comparator.
  const late = biasNow !== undefined && isLateNight(biasNow);
  const ranked = candidates
    .map((bar) => ({
      bar,
      score:
        scoreBar(bar, profile.tags, coords, lovedTags) +
        (late ? lateNightAdjustment(bar) : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const top = ranked.slice(0, cap).map((r) => r.bar);

  // Exploration slot (B7b — ε-greedy, simplified): on surfaces showing 10+
  // results, the last slot goes to a QUALIFIED long-tail pick (still vibe-
  // matched at or above the Jaccard floor) instead of the Nth-best score —
  // pure exploit never re-surfaces the catalog's depth. Deterministically
  // seeded from (profile tags, day): stable within a day, rotates daily.
  // Small surfaces (default MAX_RESULTS = 3) are never taxed a slot.
  if (cap >= EXPLORATION_MIN_RESULTS && ranked.length > cap) {
    // Every tail bar already cleared the adaptive Jaccard gate (which
    // bottoms out at JACCARD_FLOOR) or the empty-profile bypass — that IS
    // the "qualified" bar (DeepSeek review: a second floor filter here was
    // dead code inviting divergence).
    const tail = ranked.slice(cap);
    const seed = explorationSeed(profile.tags, now ?? new Date());
    top[cap - 1] = tail[seed % tail.length].bar;
  }

  return top;
}

/**
 * FNV-1a hash of (sorted profile tags + effective NIGHT) — deterministic
 * for a given profile/night so the pick doesn't jitter between renders,
 * rotating at the 5am LOCAL night rollover (cadence.ts), never mid-evening
 * (DeepSeek review: a UTC-midnight key rotated at 8pm ET — prime time for
 * a NYC product).
 *
 * KNOWN + ACCEPTED FOR BETA: no per-user salt — users with identical tag
 * profiles share a night's pick. Decorrelating needs an identity/device
 * input this pure module doesn't have; revisit with the analytics
 * decision (escalation queue).
 */
function explorationSeed(tags: VibeTag[], now: Date): number {
  const night = effectiveNight(now);
  const day = `${night.getFullYear()}-${night.getMonth() + 1}-${night.getDate()}`;
  const input = `${[...tags].sort().join(',')}|${day}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
