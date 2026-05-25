/**
 * Local-mode storage for pairwise comparisons (the v0.4 / signed-out path).
 *
 * Comparisons are append-only: a user redoing a judgment inserts a new
 * row rather than mutating an old one, matching the Supabase schema's
 * "no UPDATE policy" rule. Scores are derived from the full comparison
 * list, so the most recent comparison naturally dominates.
 *
 * Storage shape mirrors the `pairwise_comparisons` table:
 *   { winnerBarId: string, loserBarId: string, comparedAt: ISO string }
 *
 * Like `loadRatings`, this module silently returns [] on parse errors so
 * a corrupt key never crashes the app.
 */

import type { PairwiseComparison } from '@/types/ratings';

const KEY = 'next-bar:pairwise:v1';

function isComparison(value: unknown): value is PairwiseComparison {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.winnerBarId === 'string' &&
    typeof obj.loserBarId === 'string' &&
    obj.winnerBarId !== obj.loserBarId &&
    typeof obj.comparedAt === 'string'
  );
}

function isComparisonArray(value: unknown): value is PairwiseComparison[] {
  return Array.isArray(value) && value.every(isComparison);
}

export function loadComparisons(): PairwiseComparison[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!isComparisonArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Overwrite the full comparisons list. Used by tests and any future
 * "clear all" / migration flow; typical writes should go through
 * `appendComparison`.
 */
export function writeComparisons(items: PairwiseComparison[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Quota / private-mode — non-fatal; comparison just won't persist.
  }
}

/**
 * Append a single comparison to the stored list. Returns the new full
 * list so callers can recompute scores without a follow-up read.
 *
 * No dedup: a user who flip-flops "A > B" then "B > A" intentionally
 * leaves both rows so the recent answer dominates the winrate math
 * (and the historical record is preserved).
 */
export function appendComparison(
  comparison: PairwiseComparison,
): PairwiseComparison[] {
  const current = loadComparisons();
  const updated = [...current, comparison];
  writeComparisons(updated);
  return updated;
}
