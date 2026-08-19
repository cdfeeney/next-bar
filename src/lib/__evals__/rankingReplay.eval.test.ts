import { describe, expect, it } from 'vitest';
import type { Bar, VibeProfile, VibeTag } from '@/types';
import { bars as catalog } from '@/lib/bars';
import { matches } from '@/lib/matching';
import { deriveLearnedTaste } from '@/lib/tasteAffinity';
import { daysAgo } from '@/lib/freshness';
import { LAST_VERIFIED_HARD_FILTER_DAYS, RESULTS_COUNT } from '@/lib/constants';
import { previousMatches } from './previousRanker';
import {
  LOVED_SCORE_THRESHOLD,
  ci95,
  makeRng,
  makeUser,
  mean,
  median,
  medianMiles,
  ndcgAt,
  type SyntheticUser,
} from './replayHarness';
import {
  checkCascade,
  emptyViolations,
  violationCount,
  type InvariantViolations,
} from './cascadeInvariants';

/**
 * Ranking release evaluation — offline replay of the V8 D2 cascade against the
 * weighted-sum ranker it replaced (recovered from 2221cbf).
 *
 * EVIDENCE ONLY. This spec must never change ranker behavior. It asserts the
 * three cascade invariants and reproducibility; the quality numbers are
 * REPORTED, not asserted, because a threshold here would quietly become a
 * product decision. The written report is docs/RANKING-EVAL-2026-08-19.md.
 */

/** Fixed inputs. Changing any of these changes every number in the report. */
const SEED = 20260819;
const NOW = new Date('2026-08-19T23:00:00.000Z');
const USERS_PER_SEGMENT = 300;
/** Below this a segment's numbers are reported as not meaningful. */
const MIN_MEANINGFUL_USERS = 30;

const SEGMENTS = [
  { label: '0-4 ratings', min: 0, max: 4 },
  { label: '5-20 ratings', min: 5, max: 20 },
  { label: '100+ ratings', min: 100, max: 150 },
] as const;

/** The pool matches() itself would rank, so invariants are checked fairly. */
function evalPool(exclude: ReadonlySet<string>): Bar[] {
  return catalog
    .filter((b) => !exclude.has(b.id))
    .filter((b) => b.businessStatus !== 'CLOSED_PERMANENTLY')
    .filter((b) => daysAgo(b.lastVerified, NOW) <= LAST_VERIFIED_HARD_FILTER_DAYS);
}

const ALL_TAGS: VibeTag[] = [...new Set(catalog.flatMap((b) => b.tags))].sort();

type SegmentResult = {
  label: string;
  users: number;
  ratingsMedian: number;
  poolMedian: number;
  cascade: { ndcg: number; medianMiles: number };
  previous: { ndcg: number; medianMiles: number };
  /** Paired per-user NDCG@5 delta (cascade - previous) and its 95% CI half-width. */
  ndcgDelta: { mean: number; ci95: number };
};

type UserResult = {
  ratingCount: number;
  poolSize: number;
  cascadeNdcg: number;
  previousNdcg: number;
  cascadeMiles: number;
  previousMiles: number;
};

/**
 * One user, both rankers, identical held-out pool.
 *
 * The cascade is driven through the REAL `matches()` (rated bars excluded by
 * id, not pre-filtered out) so what is measured is the shipping code path.
 * `pool` is that same post-filter set, handed to the baseline and to the
 * invariant checker so all three see one candidate set.
 */
function evaluateUser(
  user: SyntheticUser,
  label: string,
  violations: InvariantViolations,
): UserResult {
  const pool = evalPool(user.ratedIds);
  const taste = deriveLearnedTaste(user.ratings, catalog);
  const profile = { tags: user.quizTags, answers: {} } as unknown as VibeProfile;

  const cascadePage = matches({
    profile,
    coords: user.coords,
    preferredNeighborhoods: [],
    maxMiles: null,
    bars: catalog,
    excludeIds: [...user.ratedIds],
    maxResults: RESULTS_COUNT,
    now: NOW,
    taste,
  });

  const previousPage = previousMatches({
    pool,
    quizTags: user.quizTags,
    coords: user.coords,
    lovedTags: lovedTagsOf(user, catalog),
    cap: RESULTS_COUNT,
  });

  checkCascade({
    page: cascadePage,
    pool,
    coords: user.coords,
    quizTags: user.quizTags,
    taste,
    cap: RESULTS_COUNT,
    label,
    into: violations,
  });

  return {
    ratingCount: user.ratings.length,
    poolSize: pool.length,
    cascadeNdcg: ndcgAt(cascadePage, pool, user.latent, RESULTS_COUNT),
    previousNdcg: ndcgAt(previousPage, pool, user.latent, RESULTS_COUNT),
    cascadeMiles: medianMiles(cascadePage, user.coords),
    previousMiles: medianMiles(previousPage, user.coords),
  };
}

function runSegment(
  segment: (typeof SEGMENTS)[number],
  seed: number,
  violations: InvariantViolations,
): SegmentResult {
  const rng = makeRng(seed);
  const users: UserResult[] = [];

  for (let i = 0; i < USERS_PER_SEGMENT; i++) {
    const count = segment.min + Math.floor(rng() * (segment.max - segment.min + 1));
    const user = makeUser(i, catalog, ALL_TAGS, count, rng);
    users.push(evaluateUser(user, `${segment.label} u${i}`, violations));
  }

  const column = (pick: (u: UserResult) => number) => users.map(pick);
  const paired = users.map((u) => u.cascadeNdcg - u.previousNdcg);

  return {
    label: segment.label,
    users: USERS_PER_SEGMENT,
    ratingsMedian: median(column((u) => u.ratingCount)),
    poolMedian: median(column((u) => u.poolSize)),
    cascade: {
      ndcg: mean(column((u) => u.cascadeNdcg)),
      medianMiles: median(column((u) => u.cascadeMiles)),
    },
    previous: {
      ndcg: mean(column((u) => u.previousNdcg)),
      medianMiles: median(column((u) => u.previousMiles)),
    },
    ndcgDelta: { mean: mean(paired), ci95: ci95(paired) },
  };
}

/** Legacy "Loved" evidence for the previous ranker: score >= 8.0. */
function lovedTagsOf(user: SyntheticUser, all: readonly Bar[]): VibeTag[] {
  const byId = new Map(all.map((b) => [b.id, b]));
  const tags = user.ratings
    .filter((r) => typeof r.score === 'number' && r.score >= LOVED_SCORE_THRESHOLD)
    .flatMap((r) => byId.get(r.barId)?.tags ?? []);
  return [...new Set(tags)];
}

function fmt(n: number, digits = 4): string {
  return Number.isFinite(n) ? n.toFixed(digits) : 'n/a';
}

function reportTable(results: readonly SegmentResult[]): string {
  const head =
    '| segment | users (n) | median ratings | held-out pool | cascade NDCG@5 | prev NDCG@5 | ' +
    'NDCG delta (95% CI) | cascade median mi | prev median mi | miles delta |\n' +
    '|---|---|---|---|---|---|---|---|---|---|';
  const rows = results.map((r) => {
    const note = r.users < MIN_MEANINGFUL_USERS ? ' (TOO FEW USERS — not meaningful)' : '';
    return `| ${r.label}${note} | ${r.users} | ${r.ratingsMedian} | ${fmt(r.poolMedian, 0)} | ` +
      `${fmt(r.cascade.ndcg)} | ${fmt(r.previous.ndcg)} | ` +
      `${fmt(r.ndcgDelta.mean)} +/- ${fmt(r.ndcgDelta.ci95)} | ` +
      `${fmt(r.cascade.medianMiles, 3)} | ${fmt(r.previous.medianMiles, 3)} | ` +
      `${fmt(r.cascade.medianMiles - r.previous.medianMiles, 3)} |`;
  });
  return [head, ...rows].join('\n');
}

describe('eval: V8 cascade offline replay', () => {
  const violations = emptyViolations();
  const results = SEGMENTS.map((segment, i) => runSegment(segment, SEED + i, violations));

  it('reports the release numbers (seed 20260819)', () => {
    // eslint-disable-next-line no-console
    console.log(
      `\n### Ranking replay — seed ${SEED}, catalog ${catalog.length} bars, ` +
      `${ALL_TAGS.length} tags, page ${RESULTS_COUNT}\n${reportTable(results)}\n` +
      `near-tie (|delta| <= 1e-12) pairs ordered farther-first: ` +
      `${violations.nearTieFartherFirst.length} of ` +
      `${USERS_PER_SEGMENT * SEGMENTS.length} pages\n` +
      `${violations.nearTieFartherFirst.slice(0, 3).join('\n')}\n`);
    expect(results).toHaveLength(SEGMENTS.length);
    for (const r of results) {
      expect(r.users).toBeGreaterThanOrEqual(MIN_MEANINGFUL_USERS);
    }
  });

  it('holds all three cascade invariants on every page', () => {
    expect(violations.closestBandFirst.slice(0, 3)).toEqual([]);
    expect(violations.learnedTasteWithinBand.slice(0, 3)).toEqual([]);
    expect(violations.exactMilesFinalTieBreak.slice(0, 3)).toEqual([]);
    expect(violationCount(violations)).toBe(0);
  });

  // NOT an invariant assertion. The cascade's tie-break fires on bit-exact
  // score equality, so two bars that are mathematically tied but summed in a
  // different tag order can still be ordered farther-first. Measured, reported
  // in docs/RANKING-EVAL-2026-08-19.md, and left to a follow-up goal — fixing
  // it here would change ranker behavior, which this lane must not do.
  it('measures near-tie ordering without asserting a threshold', () => {
    expect(violations.nearTieFartherFirst.length).toBeGreaterThanOrEqual(0);
  });

  it('is reproducible — the same seed reproduces the same numbers', () => {
    const again = runSegment(SEGMENTS[1], SEED + 1, emptyViolations());
    expect(again).toEqual(results[1]);
  });
});
