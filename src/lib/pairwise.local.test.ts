import { beforeEach, describe, expect, it } from 'vitest';
import type { PairwiseComparison } from '@/types/ratings';
import {
  appendComparison,
  comparisonKey,
  loadComparisons,
  unionTranscripts,
  writeComparisons,
} from '@/lib/pairwise.local';

const KEY = 'next-bar:pairwise:v1';

function comp(winnerBarId: string, loserBarId: string, when = '2026-05-20T00:00:00.000Z'): PairwiseComparison {
  return { winnerBarId, loserBarId, comparedAt: when };
}

describe('pairwise.local', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('loadComparisons returns [] when the key is empty', () => {
    expect(loadComparisons()).toEqual([]);
  });

  it('writeComparisons + loadComparisons round-trip preserves order', () => {
    const items = [comp('a', 'b'), comp('c', 'd'), comp('e', 'f')];
    writeComparisons(items);
    expect(loadComparisons()).toEqual(items);
  });

  it('appendComparison adds a row and returns the new full list', () => {
    writeComparisons([comp('a', 'b')]);
    const next = appendComparison(comp('c', 'd'));
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual(comp('c', 'd'));
    expect(loadComparisons()).toEqual(next);
  });

  it('keeps both directions when the user flips a judgment', () => {
    appendComparison(comp('a', 'b', '2026-05-20T00:00:00.000Z'));
    appendComparison(comp('b', 'a', '2026-05-21T00:00:00.000Z'));
    expect(loadComparisons()).toEqual([
      comp('a', 'b', '2026-05-20T00:00:00.000Z'),
      comp('b', 'a', '2026-05-21T00:00:00.000Z'),
    ]);
  });

  it('malformed JSON yields [] without throwing', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(loadComparisons()).toEqual([]);
  });

  it('non-array JSON yields []', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ foo: 'bar' }));
    expect(loadComparisons()).toEqual([]);
  });

  it('rejects rows missing fields', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([{ winnerBarId: 'a', comparedAt: '2026-05-01' }]),
    );
    expect(loadComparisons()).toEqual([]);
  });

  it('rejects rows where winner equals loser', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { winnerBarId: 'a', loserBarId: 'a', comparedAt: '2026-05-01T00:00:00.000Z' },
      ]),
    );
    expect(loadComparisons()).toEqual([]);
  });
});

describe('unionTranscripts', () => {
  // Sign-in hydrate must never replace the local transcript with the
  // server's: when the upload fails and the fetch succeeds, replacing
  // permanently destroys comparisons that never made it up.
  const s1 = comp('attaboy', 'death-and-co', '2026-05-20T00:00:00.000Z');
  const s2 = comp('bar-54', 'attaboy', '2026-05-21T00:00:00.000Z');
  const localOnly = comp('death-and-co', 'bar-54', '2026-05-22T00:00:00.000Z');

  it('keeps local rows the server does not have', () => {
    const out = unionTranscripts([s1, s2], [s1, localOnly]);
    expect(out).toHaveLength(3);
    expect(out.map(comparisonKey)).toContain(comparisonKey(localOnly));
  });

  it('returns the server transcript unchanged when local adds nothing', () => {
    expect(unionTranscripts([s1, s2], [s1, s2])).toEqual([s1, s2]);
  });

  it('returns the server transcript unchanged when local is empty', () => {
    expect(unionTranscripts([s1, s2], [])).toEqual([s1, s2]);
  });

  it('orders the union by comparedAt so replay stays deterministic', () => {
    const early = comp('a', 'b', '2026-05-19T00:00:00.000Z');
    const out = unionTranscripts([s1, s2], [early]);
    expect(out.map((c) => c.comparedAt)).toEqual([
      '2026-05-19T00:00:00.000Z',
      '2026-05-20T00:00:00.000Z',
      '2026-05-21T00:00:00.000Z',
    ]);
  });

  it('collapses duplicates inside the local list', () => {
    const out = unionTranscripts([], [localOnly, localOnly]);
    expect(out).toEqual([localOnly]);
  });

  it('keeps a genuine re-answer — same pair, different comparedAt', () => {
    const reAnswer = comp('death-and-co', 'attaboy', '2026-05-23T00:00:00.000Z');
    const out = unionTranscripts([s1], [reAnswer]);
    expect(out).toHaveLength(2);
  });

  it('does not mutate either input', () => {
    const server = [s1];
    const local = [localOnly];
    unionTranscripts(server, local);
    expect(server).toEqual([s1]);
    expect(local).toEqual([localOnly]);
  });

  it('collapses duplicates inside the SERVER list too', () => {
    // pairwise_comparisons has no uniqueness constraint (migration 0002), so
    // an interrupted historical merge can leave the same tuple twice. Copying
    // the server array wholesale double-counted it in replay.
    expect(unionTranscripts([s1, s1, s2], [])).toEqual([s1, s2]);
  });

  it('sorts an unparseable comparedAt to the end deterministically', () => {
    // A NaN comparator leaves order implementation-defined, so one malformed
    // row could reshuffle score-bearing history on every rebuild.
    const bad = comp('x', 'y', 'not-a-date');
    const early = comp('a', 'b', '2026-05-19T00:00:00.000Z');
    const out = unionTranscripts([s1], [bad, early]);
    expect(out.map((c) => c.comparedAt)).toEqual([
      '2026-05-19T00:00:00.000Z',
      '2026-05-20T00:00:00.000Z',
      'not-a-date',
    ]);
    // Same inputs in a different order produce the same replay order.
    const again = unionTranscripts([s1], [early, bad]);
    expect(again.map((c) => c.comparedAt)).toEqual(
      out.map((c) => c.comparedAt),
    );
  });
});

describe('comparisonKey timestamp normalization', () => {
  // compared_at is timestamptz (migration 0002): PostgREST returns the stored
  // instant in Postgres ISO form, never the client's toISOString() spelling.
  // A string key made every already-synced row look new.
  it('treats the same instant as one row across ISO spellings', () => {
    const clientWrote = comp('a', 'b', '2026-08-12T23:50:00.000Z');
    const serverReturned = comp('a', 'b', '2026-08-12T23:50:00+00:00');
    expect(comparisonKey(serverReturned)).toBe(comparisonKey(clientWrote));
  });

  it('treats an offset spelling of the same instant as one row', () => {
    const v7Local = comp('a', 'b', '2026-08-12T23:50:00-04:00');
    const serverReturned = comp('a', 'b', '2026-08-13T03:50:00+00:00');
    expect(comparisonKey(serverReturned)).toBe(comparisonKey(v7Local));
  });

  it('still separates genuinely different instants', () => {
    expect(comparisonKey(comp('a', 'b', '2026-08-12T23:50:00Z'))).not.toBe(
      comparisonKey(comp('a', 'b', '2026-08-12T23:50:01Z')),
    );
  });

  it('does not collapse distinct unparseable timestamps onto one key', () => {
    expect(comparisonKey(comp('a', 'b', 'garbage-1'))).not.toBe(
      comparisonKey(comp('a', 'b', 'garbage-2')),
    );
  });

  it('unionTranscripts does not duplicate a row the server re-spelled', () => {
    const local = comp('a', 'b', '2026-08-12T23:50:00.000Z');
    const server = comp('a', 'b', '2026-08-12T23:50:00+00:00');
    expect(unionTranscripts([server], [local])).toEqual([server]);
  });
});
