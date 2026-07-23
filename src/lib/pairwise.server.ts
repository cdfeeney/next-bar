import type { SupabaseClient } from '@supabase/supabase-js';
import type { PairwiseComparison } from '@/types/ratings';

/**
 * Server-mode storage for pairwise comparisons (B0.4) — the Supabase
 * counterpart of pairwise.local.ts. Append-only, mirroring the table's
 * no-UPDATE policy: redoing a judgment inserts a new row and transcript
 * replay lets the later answer win.
 *
 * Transcript ORDER is load-bearing (rank-order replay is order-sensitive),
 * so reads sort by compared_at with id as a stable tiebreak for same-ms
 * rows.
 *
 * `session_id` (migration 0005) tags every insert with the client session
 * that produced it so a future reconcile flow can detect two devices
 * ranking against different base orderings.
 */

type Row = {
  winner_bar_id: string;
  loser_bar_id: string;
  compared_at: string;
};

function rowToComparison(row: Row): PairwiseComparison {
  return {
    winnerBarId: row.winner_bar_id,
    loserBarId: row.loser_bar_id,
    comparedAt: row.compared_at,
  };
}

/**
 * Fetch the user's full comparison transcript in replay order.
 * Returns null on transport/RLS error (distinguishable from "none yet").
 */
export async function fetchServerComparisons(
  supabase: SupabaseClient,
): Promise<PairwiseComparison[] | null> {
  const { data, error } = await supabase
    .from('pairwise_comparisons')
    .select('winner_bar_id, loser_bar_id, compared_at')
    .order('compared_at', { ascending: true })
    .order('id', { ascending: true });
  if (error || !data) return null;
  return (data as Row[]).map(rowToComparison);
}

export async function insertServerComparison(
  supabase: SupabaseClient,
  userId: string,
  comparison: PairwiseComparison,
  sessionId: string | null,
): Promise<void> {
  await supabase.from('pairwise_comparisons').insert({
    user_id: userId,
    winner_bar_id: comparison.winnerBarId,
    loser_bar_id: comparison.loserBarId,
    compared_at: comparison.comparedAt,
    session_id: sessionId,
  });
}

/**
 * One-shot merge of localStorage comparisons into the user's server
 * transcript. Insert-only, deduped on the (winner, loser, comparedAt)
 * tuple — the local list IS an append-only transcript, so identical
 * tuples are true duplicates, not intentional re-answers (those carry
 * fresh timestamps).
 *
 * Returns rows inserted, or null when the merge did NOT complete (fetch or
 * insert failure) — callers must not latch their merged-for flag on null.
 */
export async function mergeLocalComparisonsToServer(
  supabase: SupabaseClient,
  userId: string,
  localComparisons: ReadonlyArray<PairwiseComparison>,
  sessionId: string | null,
): Promise<number | null> {
  if (localComparisons.length === 0) return 0;

  const existing = await fetchServerComparisons(supabase);
  if (existing === null) return null;
  const seen = new Set(
    existing.map((c) => `${c.winnerBarId}|${c.loserBarId}|${c.comparedAt}`),
  );

  const toInsert = localComparisons
    .filter((c) => !seen.has(`${c.winnerBarId}|${c.loserBarId}|${c.comparedAt}`))
    .map((c) => ({
      user_id: userId,
      winner_bar_id: c.winnerBarId,
      loser_bar_id: c.loserBarId,
      compared_at: c.comparedAt,
      session_id: sessionId,
    }));

  if (toInsert.length === 0) return 0;

  const { error } = await supabase.from('pairwise_comparisons').insert(toInsert);
  if (error) return null;
  return toInsert.length;
}

/**
 * Delete the user's ENTIRE comparison transcript — the server half of the
 * Settings "Clear all ratings" action (santa-loop round-1 finding: without
 * this, the orphaned server transcript re-derives stale scores onto
 * re-rated bars on the next mount).
 */
export async function deleteAllServerComparisons(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  await supabase
    .from('pairwise_comparisons')
    .delete()
    .eq('user_id', userId);
}
