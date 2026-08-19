import { beforeAll, describe, expect, it } from 'vitest';
import type { Bar, VibeProfile, VibeTag } from '@/types';
import { bars as catalog } from '@/lib/bars';
import { matches, rankScore } from '@/lib/matching';
import { haversineMiles } from '@/lib/distance';
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
  bandOf,
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
  // The 900-user replay runs in beforeAll, NOT in the describe body. In the
  // body it executed at COLLECTION time: every `npm test` paid for it whatever
  // was selected, `-t` could not skip it, and any failure surfaced as a suite
  // collection error rather than a failing test. beforeAll runs only when a
  // test in this suite is actually selected.
  const violations = emptyViolations();
  let results: SegmentResult[] = [];
  beforeAll(() => {
    results = SEGMENTS.map((segment, i) => runSegment(segment, SEED + i, violations));
  });

  it('reports the release numbers (seed 20260819)', () => {
    // eslint-disable-next-line no-console
    console.log(
      `\n### Ranking replay — seed ${SEED}, catalog ${catalog.length} bars, ` +
      `${ALL_TAGS.length} tags, page ${RESULTS_COUNT}\n${reportTable(results)}\n` +
      `near-tie (|delta| <= 1e-12) pairs ordered farther-first: ` +
      `${violations.nearTieFartherFirst.length} of ` +
      `${USERS_PER_SEGMENT * SEGMENTS.length} pages\n` +
      `${violations.nearTieFartherFirst.slice(0, 3).join('\n')}\n` +
      `bit-exact score ties the miles tie-break actually had to decide: ` +
      `${violations.exactTiesExercised}\n`);
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

    // Zero violations of a check that never fired is not a confirmed invariant.
    // Printed rather than asserted: the replay must not fail because the real
    // catalog happens to produce no bit-exact ties, but nobody should read the
    // line above as evidence the tie-break works if it never had to decide.
    if (violations.exactTiesExercised === 0) {
      // eslint-disable-next-line no-console
      console.log(
        '\nNOTE: exact-miles tie-break VACUOUS on this run — no bit-exact score ' +
        'tie was ever exercised, so its 0 violations confirm nothing. ' +
        'See docs/RANKING-EVAL-2026-08-19.md.\n');
    }
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

/**
 * The invariant checker's own tests.
 *
 * "0 violations across 900 pages" is worth nothing unless the checker can
 * actually fail. Both cases below are pages the previous version of
 * `checkCascade` accepted silently: it partitioned the page by band before
 * counting, so band ORDER was never examined, and it compared miles only
 * between adjacent SELECTED results, so the page boundary — where the
 * tie-break matters most — was invisible.
 */
describe('cascadeInvariants: the checker catches planted violations', () => {
  const template = catalog[0];
  /** Same tags as the template, so rankScore returns a BIT-EXACT equal score. */
  const at = (id: string, lat: number, lng: number): Bar => ({ ...template, id, lat, lng });
  const origin = { lat: template.lat, lng: template.lng };
  /** ~0.7mi north (band 0) and ~2.8mi north (band 1) of the origin. */
  const near = at('near', template.lat + 0.010, template.lng);
  const mid = at('mid', template.lat + 0.014, template.lng);
  const far = at('far', template.lat + 0.040, template.lng);
  const noTaste = deriveLearnedTaste([], catalog);
  const check = (page: Bar[], pool: Bar[], cap: number) => checkCascade({
    page, pool, coords: origin, quizTags: template.tags.slice(0, 1),
    taste: noTaste, cap, label: 'planted', into: emptyViolations(),
  });

  it('fixture bands and scores are what the two cases need', () => {
    expect([bandOf(haversineMiles(origin, near)), bandOf(haversineMiles(origin, mid))]).toEqual([0, 0]);
    expect(bandOf(haversineMiles(origin, far))).toBe(1);
    // Bit-exact, not merely close: the tie-break fires on `===`.
    expect(rankScore(near, template.tags.slice(0, 1), noTaste))
      .toBe(rankScore(mid, template.tags.slice(0, 1), noTaste));
  });

  it('flags a page that puts a farther band ahead of a nearer one', () => {
    // Per-band QUOTAS are correct here (1 from each band, both pools hold 1).
    // Only the ordering is wrong, which is the case count-only checking missed.
    const v = check([far, near], [near, far], 2);
    expect(v.closestBandFirst).toHaveLength(1);
    expect(v.closestBandFirst[0]).toContain('position 1 is band 0 but follows band 1');
  });

  it('flags a tied-but-nearer bar skipped at the page boundary', () => {
    // cap 1: no adjacent pair exists, and the skipped candidate ties rather
    // than outscores, so neither the ordering scan nor the "better skipped"
    // scan can see it.
    const v = check([mid], [near, mid], 1);
    expect(v.exactMilesFinalTieBreak).toHaveLength(1);
    expect(v.exactMilesFinalTieBreak[0]).toContain('bit-exact score tie');
    expect(v.learnedTasteWithinBand).toEqual([]);
    expect(v.exactTiesExercised).toBe(1);
  });

  it('accepts the correctly ordered page', () => {
    const v = check([near, far], [near, far], 2);
    expect(violationCount(v)).toBe(0);
  });
});
