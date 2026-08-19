/**
 * Offline replay harness — synthetic users over the REAL catalog.
 *
 * Measurement only. Nothing here is imported by the app.
 *
 * There is no logged rating history to replay, so users are generated from a
 * seeded latent taste vector and their ratings are DERIVED from it. That makes
 * the ground truth exact (we know what the user actually likes) at the cost of
 * assuming the model's own shape — see the report's Threats section.
 */
import type { Bar, Coords, VibeTag } from '@/types';
import type { BarRating } from '@/types/ratings';
import { haversineMiles } from '@/lib/distance';

/** Deterministic LCG — same generator the existing eval specs use. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Rating noise, in score points, before the 1–10 clamp. */
const RATING_NOISE_SD = 0.75;
/** A legacy "Loved" bar, for the previous ranker's lovedTags term. */
export const LOVED_SCORE_THRESHOLD = 8;
/** How many quiz tags a synthetic user picks. */
const QUIZ_TAG_COUNT = 3;

export type SyntheticUser = {
  readonly id: number;
  readonly coords: Coords;
  readonly quizTags: VibeTag[];
  readonly ratings: BarRating[];
  readonly ratedIds: ReadonlySet<string>;
  /** Ground truth: latent utility in [-1, 1] per tag. */
  readonly latent: ReadonlyMap<VibeTag, number>;
};

/** Box-Muller, driven by the seeded rng so noise is reproducible too. */
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Ground-truth utility of a bar for a user: mean latent value over its tags. */
export function trueUtility(bar: Bar, latent: ReadonlyMap<VibeTag, number>): number {
  if (bar.tags.length === 0) return 0;
  let total = 0;
  for (const tag of bar.tags) total += latent.get(tag) ?? 0;
  return total / bar.tags.length;
}

function sampleDistinct<T>(items: readonly T[], count: number, rng: () => number): T[] {
  const pool = [...items];
  const take = Math.min(count, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, take);
}

/**
 * One synthetic user with `ratingCount` ratings.
 *
 * Rated bars are drawn uniformly from the catalog, NOT weighted toward the
 * user's home or taste. A real history is biased on both axes; uniform draw is
 * the assumption this replay makes, and it is the one most likely to flatter
 * neither ranker (a distance-biased history would hand the cascade its own
 * prior back as evidence).
 */
export function makeUser(
  id: number,
  catalog: readonly Bar[],
  allTags: readonly VibeTag[],
  ratingCount: number,
  rng: () => number,
): SyntheticUser {
  const latent = new Map<VibeTag, number>();
  for (const tag of allTags) latent.set(tag, rng() * 2 - 1);

  const home = catalog[Math.floor(rng() * catalog.length)];
  const coords: Coords = { lat: home.lat, lng: home.lng };

  // Quiz tags are the user's genuinely favourite tags, mildly shuffled: a quiz
  // is a noisy self-report, not a perfect readout of latent taste.
  const quizTags = [...allTags]
    .sort((a, b) => (latent.get(b) ?? 0) + rng() * 0.4 - ((latent.get(a) ?? 0) + rng() * 0.4))
    .slice(0, QUIZ_TAG_COUNT);

  const rated = sampleDistinct(catalog, ratingCount, rng);
  const ratings: BarRating[] = rated.map((bar) => ({
    barId: bar.id,
    rating: 'liked',
    ratedAt: '2026-08-01T00:00:00.000Z',
    score: Math.min(10, Math.max(1,
      5.5 + 4.5 * trueUtility(bar, latent) + gaussian(rng) * RATING_NOISE_SD)),
  }));

  return {
    id, coords, quizTags, ratings, latent,
    ratedIds: new Set(rated.map((b) => b.id)),
  };
}

/** Gain in [0, 1] from a utility in [-1, 1]. Linear: no extra shape assumed. */
export function gainOf(utility: number): number {
  return (utility + 1) / 2;
}

/**
 * NDCG@k against the ground-truth utility of the HELD-OUT pool.
 *
 * Linear gain, log2 discount, ideal taken from the best k bars actually
 * available in that user's pool — so 1.0 means "picked the five best bars
 * there were", not "beat an unreachable ideal".
 */
export function ndcgAt(
  ranked: readonly Bar[],
  pool: readonly Bar[],
  latent: ReadonlyMap<VibeTag, number>,
  k: number,
): number {
  const dcg = (bars: readonly Bar[]) => bars
    .slice(0, k)
    .reduce((sum, bar, i) => sum + gainOf(trueUtility(bar, latent)) / Math.log2(i + 2), 0);

  const ideal = [...pool]
    .sort((a, b) => trueUtility(b, latent) - trueUtility(a, latent));
  const idcg = dcg(ideal);
  return idcg === 0 ? 0 : dcg(ranked) / idcg;
}

export function medianMiles(bars: readonly Bar[], coords: Coords): number {
  if (bars.length === 0) return NaN;
  const miles = bars.map((b) => haversineMiles(coords, b)).sort((a, b) => a - b);
  const mid = Math.floor(miles.length / 2);
  return miles.length % 2 === 1 ? miles[mid] : (miles[mid - 1] + miles[mid]) / 2;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? NaN
    : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (n-1). */
export function stdev(values: readonly number[]): number {
  if (values.length < 2) return NaN;
  const m = mean(values);
  const ss = values.reduce((sum, v) => sum + (v - m) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}

/**
 * Half-width of the 95% CI for a mean (normal approximation).
 *
 * Used on the PAIRED per-user NDCG delta, where both rankers saw the identical
 * user and pool — so the CI answers "is this gap distinguishable from zero",
 * which a bare difference of means cannot.
 */
export function ci95(values: readonly number[]): number {
  return values.length < 2 ? NaN : 1.96 * stdev(values) / Math.sqrt(values.length);
}
