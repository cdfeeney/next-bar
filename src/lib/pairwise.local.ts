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
 * Transcript row identity: the (winner, loser, instant) tuple.
 *
 * One definition, used by both the local union below and the server merge in
 * `pairwise.server.ts`. A genuine re-answer carries a fresh `comparedAt`, so
 * it is a DIFFERENT row and survives dedup; only rows naming the same instant
 * collapse.
 *
 * The instant is compared as epoch milliseconds, NOT as the raw string. The
 * client writes `new Date().toISOString()` ("…T23:50:00.000Z"), but
 * `compared_at` is `timestamptz` (migration 0002) and PostgREST hands the
 * stored value back in Postgres ISO form ("…T23:50:00+00:00"). Those spell
 * the same instant and never byte-match, so a string key silently treats every
 * already-synced row as new: the hydrate union keeps a second copy of the
 * whole transcript, and a merge retry re-uploads it into an append-only
 * table. Both review lanes caught this; every fake in the unit tests had
 * masked it by echoing the client's own spelling back.
 *
 * An unparseable timestamp falls back to the raw string rather than collapsing
 * every such row onto a single NaN key.
 */
export function comparisonKey(c: PairwiseComparison): string {
  const instant = Date.parse(c.comparedAt);
  const stamp = Number.isNaN(instant) ? `raw:${c.comparedAt}` : String(instant);
  return `${c.winnerBarId}|${c.loserBarId}|${stamp}`;
}

/**
 * Server transcript plus any local rows the server does not have, in replay
 * order (`comparedAt`, then original position as a stable tiebreak).
 *
 * Used on sign-in hydrate: if the upload failed but the fetch succeeded,
 * overwriting local state with the server's rows destroys the comparisons
 * that never made it up. The transcript is append-only, so union is the only
 * safe reconciliation — the failed merge retries on the next sign-in.
 */
export function unionTranscripts(
  server: ReadonlyArray<PairwiseComparison>,
  local: ReadonlyArray<PairwiseComparison>,
): PairwiseComparison[] {
  const seen = new Set(server.map(comparisonKey));
  const extra = local.filter((c) => {
    const key = comparisonKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (extra.length === 0) return [...server];
  return [...server, ...extra].sort(
    (a, b) => Date.parse(a.comparedAt) - Date.parse(b.comparedAt),
  );
}

/**
 * Append a single comparison to the stored list. Returns the new full
 * list so callers can recompute scores without a follow-up read.
 *
 * No dedup: a user who flip-flops "A > B" then "B > A" intentionally
 * leaves both rows so deterministic transcript replay can apply the later
 * insertion decision while preserving the historical record.
 */
export function appendComparison(
  comparison: PairwiseComparison,
): PairwiseComparison[] {
  const current = loadComparisons();
  const updated = [...current, comparison];
  writeComparisons(updated);
  return updated;
}
