import type {
  Bar,
  Coords,
  ManhattanNeighborhood,
  VibeProfile,
  VibeTag,
} from '@/types';
import { haversineMiles } from '@/lib/distance';
import {
  EMPTY_TASTE,
  learnedTasteScore,
  type LearnedTaste,
} from '@/lib/tasteAffinity';
import { daysAgo } from '@/lib/freshness';
import { nycHour } from '@/lib/nightKey';
import {
  LATE_CLUB_BOOST,
  LATE_NIGHT_END_HOUR,
  LATE_NIGHT_START_HOUR,
  LATE_RESTAURANT_PENALTY,
  EXPLORATION_MIN_RESULTS,
  LAST_VERIFIED_HARD_FILTER_DAYS,
  RADIUS_CAB,
  RADIUS_WALK,
  MAX_RESULTS,
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
  /** Exclusive lower edge for a distance band; null keeps nearby bars. */
  minMilesExclusive?: number | null;
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
   * Learned taste from numeric scores (V8 P1). Omitted = no rating history,
   * so c = 0 and the quiz prior alone orders the page — the cold-start case.
   */
  taste?: LearnedTaste;
};

/**
 * 10pm–3:59am in NEW YORK — when the night bias applies.
 *
 * getHours() answered in the device's zone, so a user in Los Angeles got the
 * club boost and the restaurant penalty three hours off (round-3 panel, Codex).
 * This is an NYC-only matcher; the hour comes from the same module as the
 * rollover, so there is one clock here and nowhere else.
 */
export function isLateNight(now: Date): boolean {
  const h = nycHour(now);
  if (Number.isNaN(h)) return false; // broken clock: no bias rather than a wrong one
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

/**
 * Explicit-intent weighting — APPROVED product assumption (operator,
 * 2026-08-19). Do not re-tune silently; a change here is a product decision.
 *
 * An APPLIED Tweak-the-vibe pick is an instruction the user just gave, not a
 * prior to be shrunk away. Routed through the quiz term it was weighted
 * (1 - c), so at 200 ratings (c = 0.952) an explicit pick carried 4.8% of the
 * ranking — a matching cocktail bar lost to a nonmatching pub the user simply
 * had more history with. On the explicit path the split is FIXED at 80/20 and
 * independent of c.
 *
 * This is a SEPARATE path, not a re-tuning of the (1 - c) prior: with no
 * tweak applied, rankScore and the band walk below behave exactly as before.
 */
const EXPLICIT_VIBE_WEIGHT = 0.8;
const EXPLICIT_TASTE_WEIGHT = 1 - EXPLICIT_VIBE_WEIGHT;

/**
 * A bar's WITHIN-BAND ordering value — the cascade's step 3.
 *
 *   c·learnedTaste + (1 - c)·quizPrior  (+ the late-night nudge)
 *
 * c = N/(N+10) shrinks the quiz prior away as real rating history arrives, so
 * quiz tags are a cold-start prior and never a permanent weighted term.
 * Distance is deliberately ABSENT: it selects the band and breaks ties, it is
 * not a ranking term. Exported as the offline-eval oracle (it replaces the
 * removed scoreBar in that role) — matches() is its only production caller.
 *
 * Used when NO vibe tweak is active; an applied tweak ranks by
 * explicitVibeScore instead.
 */
export function rankScore(
  bar: Bar,
  quizTags: VibeTag[],
  taste: LearnedTaste,
  late = false,
): number {
  const c = taste.confidence;
  return (
    c * learnedTasteScore(bar, taste) +
    (1 - c) * jaccard(quizTags, bar.tags) +
    (late ? lateNightAdjustment(bar) : 0)
  );
}

/**
 * rankScore's counterpart for an ACTIVE vibe tweak:
 *
 *   0.8·vibeMatch + 0.2·learnedTaste  (+ the same late-night nudge)
 *
 * No confidence term — that is the whole point. Learned taste still shapes
 * the order (it breaks ties among equally matching bars, and pushes a bar the
 * user has scored badly down), but it can no longer outvote what the user
 * just asked for. Exported alongside rankScore as the offline-eval oracle for
 * the explicit path.
 */
export function explicitVibeScore(
  bar: Bar,
  vibeTags: VibeTag[],
  taste: LearnedTaste,
  late = false,
): number {
  return (
    EXPLICIT_VIBE_WEIGHT * jaccard(vibeTags, bar.tags) +
    EXPLICIT_TASTE_WEIGHT * learnedTasteScore(bar, taste) +
    (late ? lateNightAdjustment(bar) : 0)
  );
}

/**
 * The band fill order an ACTIVE tweak walks: every band's MATCHING bars
 * first, then every band's nonmatching ones.
 *
 * So a matching bar a cab ride away outranks a nonmatching bar underfoot,
 * but only once the closer bands are out of matches — expansion before
 * fallback. A bar matches when it carries at least one picked tag; the
 * bands and their radii are untouched, only the visit order changes.
 */
function vibeMatchFillOrder(
  bands: Bar[][],
  isMatch: (bar: Bar) => boolean,
): Bar[][] {
  return [
    ...bands.map((band) => band.filter(isMatch)),
    ...bands.map((band) => band.filter((bar) => !isMatch(bar))),
  ];
}

export function matches(args: MatchesArgs): Bar[] {
  const {
    profile,
    coords,
    preferredNeighborhoods,
    minMilesExclusive = null,
    maxMiles,
    bars,
    excludeIds,
    maxResults,
    now,
    biasNow,
    taste = EMPTY_TASTE,
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

  // The explicit-intent path (EXPLICIT_VIBE_WEIGHT). Active only for an
  // APPLIED tweak carrying at least one tag — an empty pick is a CLEARED
  // tweak, which must rank exactly like no tweak at all. Resolved BEFORE the
  // distance filter because an applied pick widens what that filter admits.
  const explicitTags =
    profile.isExplicitVibe === true && profile.tags.length > 0
      ? profile.tags
      : null;
  const pickedTags = explicitTags ? new Set(explicitTags) : null;
  const isVibeMatch = (bar: Bar): boolean =>
    pickedTags !== null && bar.tags.some((t) => pickedTags.has(t));

  if (coords && (minMilesExclusive !== null || maxMiles !== null)) {
    pool = pool.filter((b) => {
      const miles = haversineMiles(coords, b);
      if (minMilesExclusive !== null && miles <= minMilesExclusive) return false;
      if (maxMiles === null || miles <= maxMiles) return true;
      // Criterion 5's expansion, and the ONLY thing that makes it reachable.
      // Every distance chip is an exclusive ring (Walkable ≤ RADIUS_WALK, cab
      // RADIUS_WALK–RADIUS_CAB, anywhere beyond it), so filtering the pool to
      // the selected ring first left exactly one band non-empty and the
      // cross-band fill order below had nothing to expand into. An APPLIED
      // pick therefore reaches PAST the ring's outer edge — but only for a bar
      // that actually matches it, and never inside the ring's inner edge. A
      // NONMATCHING bar outside the chosen scope is still never admitted, so
      // the chip keeps bounding the fallback; only the vibe the user just
      // asked for can widen it.
      return isVibeMatch(b);
    });
  }

  const cap = maxResults ?? MAX_RESULTS;

  // ---- V8 P1 cascade (docs/V8-PRD-2026-08-13.md) --------------------------
  // Quiz tags are a COLD-START PRIOR, never an admission gate. The old
  // adaptive-Jaccard filter (JACCARD_START relaxing to JACCARD_FLOOR) is gone:
  // no bar is rejected for tag mismatch any more. Ordering carries taste, and
  // the quiz prior fades as c grows with rating history.
  const late = biasNow !== undefined && isLateNight(biasNow);

  const rankOf = explicitTags
    ? (bar: Bar): number => explicitVibeScore(bar, explicitTags, taste, late)
    : (bar: Bar): number => rankScore(bar, profile.tags, taste, late);

  // Step 2 — fill from the CLOSEST band first, expanding only when the closer
  // band cannot fill the page. Bands reuse the existing distance-chip
  // constants; inventing new thresholds here would be a new product
  // assumption. With no coords there is nothing to band on, so the whole pool
  // is one band (the pre-GPS behavior).
  const milesOf = coords
    ? (bar: Bar) => haversineMiles(coords, bar)
    : () => 0;
  const bands: Bar[][] = coords ? [[], [], []] : [pool];
  if (coords) {
    for (const bar of pool) {
      const mi = milesOf(bar);
      bands[mi <= RADIUS_WALK ? 0 : mi <= RADIUS_CAB ? 1 : 2].push(bar);
    }
  }

  // Step 2b — an active tweak fills from matching candidates across every
  // band before it falls back to nonmatching ones. Without a tweak this is
  // the same `bands` array, so the walk is unchanged.
  // Same predicate the distance filter widened on, so a bar admitted as a
  // match can never be sorted as a nonmatch here.
  const fillOrder = explicitTags
    ? vibeMatchFillOrder(bands, isVibeMatch)
    : bands;

  // Steps 3 + 4 — within a band, learned taste orders; EXACT MILES are only
  // the final tie-breaker, never a ranking term of their own.
  const ranked: { bar: Bar; score: number; miles: number }[] = [];
  for (const band of fillOrder) {
    if (ranked.length >= cap) break;
    ranked.push(
      ...band
        .map((bar) => ({ bar, score: rankOf(bar), miles: milesOf(bar) }))
        .sort((a, b) => b.score - a.score || a.miles - b.miles),
    );
  }

  const top = ranked.slice(0, cap).map((r) => r.bar);

  // The B7b exploration slot used to overwrite the last result on 10+ slot
  // surfaces with a deterministic long-tail pick. REMOVED 2026-08-19 by
  // operator direction: V8 ranking correctness wins over the old exploration
  // behavior, and every returned result must be ordered by
  // distance band -> learned taste -> exact miles. The overwrite bypassed
  // steps 3 and 4 for the Map's tenth result. If exploration is wanted again
  // it returns as its own goal, designed to fit the cascade rather than to
  // punch a hole in it. The deleted implementation (explorationSeed, the
  // deterministic night-keyed pick and its evals) is recoverable from git at
  // e4299f4 — do not rebuild it from scratch.

  return top;
}

