import { beforeEach, describe, expect, test, vi } from 'vitest';
import { clearReviewCache, fetchBarDetails, fetchBarReviews } from './barReviews';

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
      data: { reviews: [{ text: 'great', author: 'A', rating: 5 }] },
      error: null,
    });
    expect(await fetchBarReviews('attaboy')).toEqual([
      { text: 'great', author: 'A', rating: 5 },
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
      data: { reviews: [{ text: 'later', author: 'B', rating: 4 }] },
      error: null,
    });
    expect(await fetchBarReviews('flaky-bar')).toEqual([
      { text: 'later', author: 'B', rating: 4 },
    ]);
  });

  test('a rejected request fails closed without poisoning the cache', async () => {
    maybeSingle.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchBarDetails('flaky-bar')).toBeUndefined();
    maybeSingle.mockResolvedValueOnce({
      data: { address: '1 Main St', blurb: 'Back online.' },
      error: null,
    });
    expect(await fetchBarDetails('flaky-bar')).toEqual({
      address: '1 Main St',
      blurb: 'Back online.',
    });
  });

  test('returns and caches validated heavy details for one opened bar', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        address: '134 Eldridge St',
        blurb: 'A tiny cocktail bar.',
        place_id: 'place-1',
        photo_count: 2,
        photo_attributions: ['A', 'B'],
        reviews: null,
      },
      error: null,
    });
    expect(await fetchBarDetails('attaboy')).toEqual({
      address: '134 Eldridge St',
      blurb: 'A tiny cocktail bar.',
      googlePlaceId: 'place-1',
      photoCount: 2,
      photoAttributions: ['A', 'B'],
    });
    await fetchBarDetails('attaboy');
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  test('fails closed on malformed detail fields', async () => {
    maybeSingle.mockResolvedValue({
      data: { address: 42, reviews: 'not-an-array' },
      error: null,
    });
    expect(await fetchBarDetails('attaboy')).toBeUndefined();
  });
});
