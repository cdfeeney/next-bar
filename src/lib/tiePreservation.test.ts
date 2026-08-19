import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BarRating } from '@/types/ratings';
import { fetchServerRatings, mergeLocalRatingsToServer } from '@/lib/ratings.server';
import { reconcileScores, sortRatingsByScore } from '@/lib/pairwise';

/**
 * V8-2 continuity, criterion 5: two bars at the SAME numeric score must stay
 * exactly tied through a full local → server → local round trip.
 *
 * A tie is the fragile case. Rounding on write, a NOT NULL default, an
 * ordering step that rewrites what it sorts, or a reconcile pass that fires
 * with no transcript would each silently break one of the two bars apart —
 * and the V7 fixture (two bars at 8.8) is exactly what an upgrading user has.
 *
 * Unlike the per-function fakes elsewhere, this fake keeps STATE: rows written
 * by the merge are the rows the next read returns. That persistence is the
 * whole point — a round trip that never reads back what it wrote proves
 * nothing.
 */
function fakeServer(initial: Array<Record<string, unknown>> = []) {
  const rows = [...initial];
  const client = {
    from() {
      return {
        select() {
          return Promise.resolve({ data: [...rows], error: null });
        },
        insert(newRows: Array<Record<string, unknown>>) {
          rows.push(...newRows);
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, rows };
}

const TIED_SCORE = 8.8;

const LOCAL: BarRating[] = [
  {
    barId: 'attaboy',
    rating: 'loved',
    ratedAt: '2026-08-12T23:00:00.000Z',
    score: TIED_SCORE,
  },
  {
    barId: 'death-and-co',
    rating: 'loved',
    ratedAt: '2026-08-12T23:30:00.000Z',
    score: TIED_SCORE,
  },
  {
    barId: 'bar-54',
    rating: 'loved',
    ratedAt: '2026-08-12T23:45:00.000Z',
    score: 9.4,
  },
];

async function roundTrip(local: BarRating[]): Promise<BarRating[]> {
  const { client } = fakeServer();
  const inserted = await mergeLocalRatingsToServer(client, 'user-1', local);
  // Round-4: the merge returns the inserted barIds, not a count.
  expect(inserted).toHaveLength(local.length);
  const back = await fetchServerRatings(client);
  expect(back).not.toBeNull();
  return back!;
}

describe('tie preservation across a local→server→local round trip', () => {
  it('both tied bars come back at the identical score', async () => {
    const back = await roundTrip(LOCAL);
    const byBar = new Map(back.map((r) => [r.barId, r]));

    expect(byBar.get('attaboy')!.score).toBe(TIED_SCORE);
    expect(byBar.get('death-and-co')!.score).toBe(TIED_SCORE);
    expect(byBar.get('attaboy')!.score).toBe(byBar.get('death-and-co')!.score);
  });

  it('the untied bar keeps its own distinct score', async () => {
    const back = await roundTrip(LOCAL);
    expect(back.find((r) => r.barId === 'bar-54')!.score).toBe(9.4);
  });

  it('the round trip is value-identical, not merely close', async () => {
    // Guards a float/round-trip regression that a toBeCloseTo would hide.
    const back = await roundTrip(LOCAL);
    expect([...back].sort((a, b) => a.barId.localeCompare(b.barId))).toEqual(
      [...LOCAL].sort((a, b) => a.barId.localeCompare(b.barId)),
    );
  });

  it('a second merge (re-sign-in) does not split the tie', async () => {
    const { client } = fakeServer();
    await mergeLocalRatingsToServer(client, 'user-1', LOCAL);
    await mergeLocalRatingsToServer(client, 'user-1', LOCAL);
    const back = await fetchServerRatings(client);
    const tied = back!.filter((r) => r.score === TIED_SCORE);
    expect(tied).toHaveLength(2);
    expect(back).toHaveLength(3);
  });

  it('ranking the round-tripped ratings keeps the tie tied and adjacent', async () => {
    const back = await roundTrip(LOCAL);
    const ranked = sortRatingsByScore(back);

    expect(ranked.map((r) => r.barId)).toEqual([
      'bar-54',
      'death-and-co',
      'attaboy',
    ]);
    // Tied pair is adjacent, ordered by recency, and neither score moved.
    expect(ranked[1].score).toBe(TIED_SCORE);
    expect(ranked[2].score).toBe(TIED_SCORE);
  });

  it('reconcileScores with no comparisons leaves the tie exactly as-is', async () => {
    const back = await roundTrip(LOCAL);
    expect(reconcileScores(back, [])).toEqual(back);
  });

  it('a tie survives when the server already holds one of the two bars', async () => {
    // Half-synced account: the merge must not re-score the bar it skips.
    const { client } = fakeServer([
      {
        bar_id: 'attaboy',
        tier: 'loved',
        rated_at: '2026-08-12T23:00:00.000Z',
        score: TIED_SCORE,
      },
    ]);
    await mergeLocalRatingsToServer(client, 'user-1', LOCAL);
    const back = await fetchServerRatings(client);

    expect(back).toHaveLength(3);
    expect(back!.filter((r) => r.score === TIED_SCORE)).toHaveLength(2);
  });
});
