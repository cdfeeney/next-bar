/**
 * The three V8 cascade invariants, checked against a real matches() result.
 *
 * Returns the violations rather than throwing, so the replay can count them
 * across thousands of pages and report a number instead of dying on the first.
 */
import type { Bar, Coords, VibeTag } from '@/types';
import { haversineMiles } from '@/lib/distance';
import { rankScore } from '@/lib/matching';
import type { LearnedTaste } from '@/lib/tasteAffinity';
import { RADIUS_CAB, RADIUS_WALK } from '@/lib/constants';

/**
 * Tolerance for the ORDERING checks (a later result may not outscore an earlier
 * one by more than float noise).
 */
const EPSILON = 1e-12;

export type InvariantViolations = {
  closestBandFirst: string[];
  learnedTasteWithinBand: string[];
  /**
   * Exact-miles tie-break violations, measured at BIT-EXACT score equality —
   * which is the condition the ranker's own comparator fires on
   * (`b.score - a.score || a.miles - b.miles`).
   */
  exactMilesFinalTieBreak: string[];
  /**
   * MEASUREMENT, not a violation: adjacent results whose scores differ by no
   * more than EPSILON — i.e. equal to every meaningful digit — that were
   * nonetheless ordered farther-first, because the last bits of the float
   * decided instead of the miles. Reported, never asserted; see
   * docs/RANKING-EVAL-2026-08-19.md "Follow-ups".
   */
  nearTieFartherFirst: string[];
  /**
   * MEASUREMENT, not a violation: how many times the exact-miles tie-break
   * actually had something to decide — a taken bar sharing a BIT-EXACT score
   * with another in-band candidate. Without this, `exactMilesFinalTieBreak: []`
   * is indistinguishable from "the tie-break was never exercised", and
   * reporting a vacuous check as a confirmed invariant is exactly the kind of
   * passing grade this lane exists not to hand out.
   */
  exactTiesExercised: number;
};

export function bandOf(miles: number): number {
  return miles <= RADIUS_WALK ? 0 : miles <= RADIUS_CAB ? 1 : 2;
}

export function emptyViolations(): InvariantViolations {
  return {
    closestBandFirst: [],
    learnedTasteWithinBand: [],
    exactMilesFinalTieBreak: [],
    nearTieFartherFirst: [],
    exactTiesExercised: 0,
  };
}

/**
 * Verify one page.
 *
 * `pool` must be the SAME pool matches() saw (post-filter), otherwise a bar the
 * matcher legitimately never had is reported as a missed nearer candidate.
 */
export function checkCascade(args: {
  page: readonly Bar[];
  pool: readonly Bar[];
  coords: Coords;
  quizTags: VibeTag[];
  taste: LearnedTaste;
  cap: number;
  label: string;
  into: InvariantViolations;
}): InvariantViolations {
  const { page, pool, coords, quizTags, taste, cap, label, into } = args;
  const milesOf = (b: Bar) => haversineMiles(coords, b);
  const scoreOf = (b: Bar) => rankScore(b, quizTags, taste);

  const poolBands = [0, 1, 2].map((k) => pool.filter((b) => bandOf(milesOf(b)) === k));
  const pageBands = [0, 1, 2].map((k) => page.filter((b) => bandOf(milesOf(b)) === k));

  // 1. Closest band first, which is TWO claims — the right QUOTA per band, and
  //    the right ORDER within the page. Checking quotas alone passes a page
  //    that interleaves bands (a band-1 result ahead of a band-0 one), because
  //    partitioning the page by band before counting discards exactly the
  //    ordering the invariant is named after.
  let remaining = cap;
  for (let k = 0; k < 3; k++) {
    const expected = Math.min(remaining, poolBands[k].length);
    if (pageBands[k].length !== expected) {
      into.closestBandFirst.push(
        `${label}: band ${k} contributed ${pageBands[k].length}, expected ${expected} ` +
        `(pool ${poolBands[k].length}, ${remaining} slots left)`);
    }
    remaining -= pageBands[k].length;
  }
  for (let i = 1; i < page.length; i++) {
    const prev = bandOf(milesOf(page[i - 1]));
    const here = bandOf(milesOf(page[i]));
    if (here < prev) {
      into.closestBandFirst.push(
        `${label}: position ${i} is band ${here} but follows band ${prev}`);
    }
  }

  // 2. Learned taste within band: the bars taken from a band are its top
  //    scorers, in non-increasing score order.
  for (let k = 0; k < 3; k++) {
    const taken = pageBands[k];
    if (taken.length === 0) continue;
    for (let i = 1; i < taken.length; i++) {
      if (scoreOf(taken[i]) > scoreOf(taken[i - 1]) + EPSILON) {
        into.learnedTasteWithinBand.push(
          `${label}: band ${k} position ${i} outscores position ${i - 1}`);
      }
    }
    const takenIds = new Set(taken.map((b) => b.id));
    const worstTaken = Math.min(...taken.map(scoreOf));
    const better = poolBands[k].find(
      (b) => !takenIds.has(b.id) && scoreOf(b) > worstTaken + EPSILON);
    if (better) {
      into.learnedTasteWithinBand.push(
        `${label}: band ${k} skipped ${better.id} (score ${scoreOf(better)}) ` +
        `while taking a ${worstTaken}`);
    }
  }

  // 3. Exact miles as the FINAL tie-break: equal scores inside a band are
  //    ordered nearest-first, and miles never decide a non-tie.
  for (let k = 0; k < 3; k++) {
    const taken = pageBands[k];
    for (let i = 1; i < taken.length; i++) {
      const delta = scoreOf(taken[i - 1]) - scoreOf(taken[i]);
      const fartherFirst = milesOf(taken[i]) < milesOf(taken[i - 1]);
      if (!fartherFirst) continue;
      const message =
        `${label}: band ${k} position ${i} ordered farther-first ` +
        `(score delta ${delta}, ${milesOf(taken[i - 1])}mi then ${milesOf(taken[i])}mi)`;
      if (delta === 0) into.exactMilesFinalTieBreak.push(message);
      else if (Math.abs(delta) <= EPSILON) into.nearTieFartherFirst.push(message);
    }

    // The adjacent-pair scan above only sees ties the page kept BOTH halves of.
    // The tie-break's sharpest case is the page boundary: a bit-exact tie where
    // the FARTHER bar was taken and the nearer one left in the pool. At cap 1
    // there is no adjacent pair at all, and check 2's skipped-candidate scan
    // requires a STRICTLY higher score, so a tied-but-nearer skip slips past
    // both. Same pass counts how often the tie-break had anything to decide,
    // so "0 violations" can be read as "held" rather than "never fired".
    if (taken.length === 0) continue;
    const takenIds = new Set(taken.map((b) => b.id));
    const byScore = new Map<number, Bar[]>();
    for (const bar of poolBands[k]) {
      const bucket = byScore.get(scoreOf(bar));
      if (bucket) bucket.push(bar);
      else byScore.set(scoreOf(bar), [bar]);
    }
    for (const bar of taken) {
      const tied = byScore.get(scoreOf(bar)) ?? [];
      if (tied.length > 1) into.exactTiesExercised += 1;
      const nearerSkipped = tied.find(
        (other) => !takenIds.has(other.id) && milesOf(other) < milesOf(bar));
      if (nearerSkipped) {
        into.exactMilesFinalTieBreak.push(
          `${label}: band ${k} took ${bar.id} at ${milesOf(bar)}mi while skipping ` +
          `${nearerSkipped.id} at ${milesOf(nearerSkipped)}mi on a bit-exact score tie`);
      }
    }
  }

  return into;
}

/** Only the three CONTRACT invariants. nearTieFartherFirst is a measurement. */
export function violationCount(v: InvariantViolations): number {
  return v.closestBandFirst.length
    + v.learnedTasteWithinBand.length
    + v.exactMilesFinalTieBreak.length;
}
