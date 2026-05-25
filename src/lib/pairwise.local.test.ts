import { beforeEach, describe, expect, it } from 'vitest';
import type { PairwiseComparison } from '@/types/ratings';
import {
  appendComparison,
  loadComparisons,
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
