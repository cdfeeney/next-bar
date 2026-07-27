import { describe, expect, test } from 'vitest';
import { advanceShownIds } from './resultsRefresh';

describe('advanceShownIds (QA-6 run-it-again)', () => {
  test('appends a full page to the shown history', () => {
    expect(advanceShownIds([], ['a', 'b', 'c', 'd', 'e'], 5)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  test('accumulates across successive refreshes', () => {
    const first = advanceShownIds([], ['a', 'b', 'c', 'd', 'e'], 5);
    expect(advanceShownIds(first, ['f', 'g', 'h', 'i', 'j'], 5)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
      'j',
    ]);
  });

  test('wraps to the start when the current page came back short', () => {
    // Pool of 7: page one showed 5, page two showed the tail 2 — refreshing
    // off a short page starts the cycle over instead of ranking into
    // nothing.
    expect(advanceShownIds(['a', 'b', 'c', 'd', 'e'], ['f', 'g'], 5)).toEqual(
      [],
    );
  });

  test('small pools (never a full page) always wrap — refresh is a no-op', () => {
    expect(advanceShownIds([], ['a', 'b', 'c'], 5)).toEqual([]);
  });

  test('does not mutate the previous history', () => {
    const prev = ['a', 'b', 'c', 'd', 'e'];
    advanceShownIds(prev, ['f', 'g', 'h', 'i', 'j'], 5);
    expect(prev).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
