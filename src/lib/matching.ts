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
import { nycHour, nycNightKey } from '@/lib/nightKey';
import {
  LATE_CLUB_BOOST,
  LATE_NIGHT_END_HOUR,
  LATE_NIGHT_START_HOUR,
  LATE_RESTAURANT_PENALTY,
  EXPLORATION_MIN_RESULTS,
  JACCARD_FLOOR,
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
 * A bar's WITHIN-BAND ordering value — the cascade's step 3.
 *
 *   c·learnedTaste + (1 - c)·quizPrior  (+ the late-night nudge)
 *
 * c = N/(N+10) shrinks the quiz prior away as real rating history arrives, so
 * quiz tags are a cold-start prior and never a permanent weighted term.
 * Distance is deliberately ABSENT: it selects the band and breaks ties, it is
 * not a ranking term. Exported as the offline-eval oracle (it replaces the
 * removed scoreBar in that role) — matches() is its only production caller.
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

  if (coords && (minMilesExclusive !== null || maxMiles !== null)) {
    pool = pool.filter((b) => {
      const miles = haversineMiles(coords, b);
      return (
        (minMilesExclusive === null || miles > minMilesExclusive) &&
        (maxMiles === null || miles <= maxMiles)
      );
    });
  }

  const cap = maxResults ?? MAX_RESULTS;

  // ---- V8 P1 cascade (docs/V8-PRD-2026-08-13.md) --------------------------
  // Quiz tags are a COLD-START PRIOR, never an admission gate. The old
  // adaptive-Jaccard filter (JACCARD_START relaxing to JACCARD_FLOOR) is gone:
  // no bar is rejected for tag mismatch any more. Ordering carries taste, and
  // the quiz prior fades as c grows with rating history.
  const late = biasNow !== undefined && isLateNight(biasNow);
  const rankOf = (bar: Bar): number => rankScore(bar, profile.tags, taste, late);

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
 * rotating at the NYC 6am rollover (nightKey.ts), never mid-evening
 * (DeepSeek review: a UTC-midnight key rotated at 8pm ET — prime time for
 * a NYC product; a LOCAL rollover, which this used to use, only got that
 * right for users whose device happened to be in New York).
 *
 * KNOWN + ACCEPTED FOR BETA: no per-user salt — users with identical tag
 * profiles share a night's pick. Decorrelating needs an identity/device
 * input this pure module doesn't have; revisit with the analytics
 * decision (escalation queue).
 */
function explorationSeed(tags: VibeTag[], now: Date): number {
  const input = `${[...tags].sort().join(',')}|${nycNightKey(now)}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
