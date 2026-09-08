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

/**
 * The vibes the user EXPLICITLY selected, deduplicated — or null when no
 * selection is active (V8-R-NXT-009 / D-C-41).
 *
 * The distinction is the whole point: a SAVED QUIZ PROFILE is a cold-start
 * prior, not a choice the user just made, so it never reaches here. Only an
 * APPLIED Tweak-the-vibe pick sets `isExplicitVibe`, and an applied EMPTY pick
 * is a CLEAR — it returns null, which restores ungated ranking and removes the
 * badge exactly as if the surface had never been opened.
 *
 * Deduplication happens once, here, so N is the number of DISTINCT vibes for
 * both the badge denominator and the eligibility threshold.
 */
export function selectedVibes(profile: VibeProfile): VibeTag[] | null {
  if (profile.isExplicitVibe !== true) return null;
  const unique = [...new Set(profile.tags)];
  return unique.length > 0 ? unique : null;
}

/** How many of the SELECTED vibes a bar carries. Both sides deduplicated. */
export function vibeMatchCount(selected: VibeTag[], barTags: VibeTag[]): number {
  const bar = new Set(barTags);
  let num = 0;
  for (const tag of new Set(selected)) {
    if (bar.has(tag)) num += 1;
  }
  return num;
}

/**
 * ELIGIBILITY (V8-R-NXT-009 / D-C-41): with N distinct selected vibes a bar
 * must carry at least max(1, N - 1) of them. So 1/2, 3/4 and 5/6 are admitted
 * — one miss is forgiven — while 0/1, 0/2, 2/4 and 4/6 are not.
 *
 * With NO selection this gates nothing: quiz cold-start and learned taste are
 * untouched, and no bar is rejected for tag mismatch.
 */
export function isVibeEligible(selected: VibeTag[], barTags: VibeTag[]): boolean {
  const den = new Set(selected).size;
  if (den === 0) return true;
  return vibeMatchCount(selected, barTags) >= Math.max(1, den - 1);
}

/**
 * The match badge, or NULL when there is nothing honest to show.
 *
 * The denominator is N — the number of vibes the user actually picked — not
 * `min(|user|, |bar|)`, which quietly shrank the denominator to flatter a bar
 * with few tags. Returning null (rather than 0/1) for an empty selection is
 * what makes "no explicit selection, no badge" structural: the card cannot
 * render a badge it was never given.
 */
export function vibeMatchBadge(
  selected: VibeTag[],
  barTags: VibeTag[],
): { num: number; den: number } | null {
  const den = new Set(selected).size;
  if (den === 0) return null;
  return { num: vibeMatchCount(selected, barTags), den };
}

export type MatchesArgs = {
  profile: VibeProfile;
  coords: Coords | null;
  preferredNeighborhoods: ManhattanNeighborhood[];
  /** Exclusive lower edge for a distance band; null keeps nearby bars. */
  minMilesExclusive?: number | null;
  maxMiles: number | null;
  /** Broader travel searches rank the admitted pool together; exact miles still break ties. */
  distanceBands?: boolean;
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

export function matches(args: MatchesArgs): Bar[] {
  const {
    profile,
    coords,
    preferredNeighborhoods,
    minMilesExclusive = null,
    maxMiles,
    distanceBands = true,
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
  // distance filter because an applied pick changes what that filter admits.
  const selected = selectedVibes(profile);

  // ELIGIBILITY, not ordering (V8-R-NXT-009 / D-C-41). This runs BEFORE the
  // distance filter, before banding, before the cap — and before ResultsView's
  // route-candidate truncation, which only ever sees what this returns. There
  // is deliberately no second pass that lets a rejected bar back in: the fill
  // order, the band expansion, "run it again" and the route supplement all
  // draw from this pool, so a bar the user's picks rejected cannot reappear as
  // padding. Fewer results — or none — is the honest answer.
  if (selected) {
    pool = pool.filter((b) => isVibeEligible(selected, b.tags));
  }

  // Explicit vibes never widen a caller's geographic bounds.
  if (coords && (minMilesExclusive !== null || maxMiles !== null)) {
    pool = pool.filter((b) => {
      const miles = haversineMiles(coords, b);
      return (minMilesExclusive === null || miles > minMilesExclusive) &&
        (maxMiles === null || miles <= maxMiles);
    });
  }

  const cap = maxResults ?? MAX_RESULTS;

  // ---- V8 P1 cascade (docs/V8-PRD-2026-08-13.md) --------------------------
  // Quiz tags are a COLD-START PRIOR, never an admission gate. The old
  // adaptive-Jaccard filter (JACCARD_START relaxing to JACCARD_FLOOR) is gone:
  // no bar is rejected for tag mismatch any more. Ordering carries taste, and
  // the quiz prior fades as c grows with rating history.
  const late = biasNow !== undefined && isLateNight(biasNow);

  const rankOf = selected
    ? (bar: Bar): number => explicitVibeScore(bar, selected, taste, late)
    : (bar: Bar): number => rankScore(bar, profile.tags, taste, late);

  // Step 2 — fill from the CLOSEST band first, expanding only when the closer
  // band cannot fill the page. Bands reuse the existing distance-chip
  // constants; inventing new thresholds here would be a new product
  // assumption. With no coords there is nothing to band on, so the whole pool
  // is one band (the pre-GPS behavior).
  const milesOf = coords
    ? (bar: Bar) => haversineMiles(coords, bar)
    : () => 0;
  const bands: Bar[][] = coords && distanceBands ? [[], [], []] : [pool];
  if (coords && distanceBands) {
    for (const bar of pool) {
      const mi = milesOf(bar);
      bands[mi <= RADIUS_WALK ? 0 : mi <= RADIUS_CAB ? 1 : 2].push(bar);
    }
  }

  // Step 2b USED to re-order each band's matching bars ahead of its
  // nonmatching ones so an active tweak expanded before it fell back. Under
  // D-C-41 there is nothing left to fall back TO — every bar that survived the
  // eligibility filter matches — so the bands are walked as they are.

  // Steps 3 + 4 — within a band, learned taste orders; EXACT MILES are only
  // the final tie-breaker, never a ranking term of their own.
  const ranked: { bar: Bar; score: number; miles: number }[] = [];
  for (const band of bands) {
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

