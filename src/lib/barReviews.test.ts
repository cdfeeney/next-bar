import { beforeEach, describe, expect, test, vi } from 'vitest';
import { clearReviewCache, fetchBarReviews } from './barReviews';

const maybeSingle = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  }),
}));

describe('fetchBarReviews', () => {
  beforeEach(() => {
    clearReviewCache();
    maybeSingle.mockReset();
  });

  test('rejects a malformed id without querying', async () => {
    expect(await fetchBarReviews('../../etc/passwd')).toBeUndefined();
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  test('returns the row reviews and caches the hit', async () => {
    maybeSingle.mockResolvedValue({
      data: { reviews: [{ text: 'great', author: 'A' }] },
      error: null,
    });
    expect(await fetchBarReviews('attaboy')).toEqual([
      { text: 'great', author: 'A' },
    ]);
    await fetchBarReviews('attaboy');
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  // The bug this pins: caching by "get() !== undefined" treats a
  // no-reviews bar as a cache MISS, so it re-queries on every open.
  test('a bar with no reviews is only queried once', async () => {
    maybeSingle.mockResolvedValue({ data: { reviews: null }, error: null });
    expect(await fetchBarReviews('no-reviews-bar')).toBeUndefined();
    expect(await fetchBarReviews('no-reviews-bar')).toBeUndefined();
    expect(await fetchBarReviews('no-reviews-bar')).toBeUndefined();
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  test('an error does not poison the cache', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await fetchBarReviews('flaky-bar')).toBeUndefined();
    maybeSingle.mockResolvedValue({
      data: { reviews: [{ text: 'later', author: 'B' }] },
      error: null,
    });
    expect(await fetchBarReviews('flaky-bar')).toEqual([
      { text: 'later', author: 'B' },
    ]);
  });
});
