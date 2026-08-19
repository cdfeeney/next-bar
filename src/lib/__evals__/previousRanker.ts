/**
 * The PREVIOUS ranker, recovered verbatim from commit 2221cbf (the parent of
 * 233009a, which replaced it with the V8 cascade). It exists here, inside
 * __evals__, so the replay can measure the cascade against what it replaced.
 *
 * DO NOT import this from src/lib or src/components. It is a measurement
 * baseline, not a code path. Its constants were deleted from constants.ts by
 * 233009a and are re-declared locally on purpose — reintroducing them to
 * constants.ts would put a dead product assumption back in the shipping build.
 */
import type { Bar, Coords, VibeTag } from '@/types';
import { haversineMiles } from '@/lib/distance';
import { jaccard } from '@/lib/matching';

/** Recovered from 2221cbf:src/lib/constants.ts. */
const VIBE_WEIGHT = 0.5;
const DIST_WEIGHT = 0.4;
const RATING_WEIGHT = 0.1;
const DIST_DECAY_MILES = 1.5;
const JACCARD_START = 0.25;
const JACCARD_FLOOR = 0.10;
const JACCARD_STEP = 0.05;
const MIN_CANDIDATES = 3;

/** 2221cbf:src/lib/matching.ts scoreBar, unchanged. */
export function previousScoreBar(
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

/**
 * 2221cbf:src/lib/matching.ts matches(), reduced to the ranking core: the
 * adaptive-Jaccard admission loop plus the blended sort.
 *
 * Omitted deliberately, because they are IDENTICAL in both rankers and would
 * only add a second copy that can drift: the excludeIds / CLOSED_PERMANENTLY /
 * lastVerified / neighborhood / radius filters. The replay hands both rankers
 * the same already-filtered pool, so the comparison isolates the ranking
 * change. The exploration slot is also omitted — it fired only at cap >= 10
 * and the replay measures a 5-slot page.
 */
export function previousMatches(args: {
  pool: Bar[];
  quizTags: VibeTag[];
  coords: Coords | null;
  lovedTags: VibeTag[];
  cap: number;
}): Bar[] {
  const { pool, quizTags, coords, lovedTags, cap } = args;
  const relaxTarget = Math.max(MIN_CANDIDATES, cap);

  let candidates: Bar[];
  if (quizTags.length === 0) {
    candidates = pool;
  } else {
    let threshold = JACCARD_START;
    candidates = [];
    while (threshold >= JACCARD_FLOOR - 1e-9 && candidates.length < relaxTarget) {
      candidates = pool.filter((b) => jaccard(quizTags, b.tags) >= threshold);
      if (candidates.length >= relaxTarget) break;
      threshold = Math.round((threshold - JACCARD_STEP) * 100) / 100;
    }
  }

  return candidates
    .map((bar) => ({ bar, score: previousScoreBar(bar, quizTags, coords, lovedTags) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((r) => r.bar);
}
