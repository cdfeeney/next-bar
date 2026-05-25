import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BarRating } from '@/types/ratings';
import {
  clearRating,
  getRating,
  loadRatings,
  setRating,
  sortRatingsByTierThenRecency,
} from '@/lib/ratings';

const KEY = 'next-bar:ratings:v1';

function looksLikeRating(arg: unknown): boolean {
  if (arg === null || typeof arg !== 'object') return false;
  const obj = arg as Record<string, unknown>;
  return (
    typeof obj.barId === 'string' &&
    typeof obj.rating === 'string' &&
    typeof obj.ratedAt === 'string'
  );
}

describe('ratings lib', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  function assertNoRatingLogs(): void {
    const allCalls = [
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ];
    for (const call of allCalls) {
      for (const arg of call) {
        expect(looksLikeRating(arg)).toBe(false);
      }
    }
  }

  it('loadRatings returns [] when nothing is stored', () => {
    expect(loadRatings()).toEqual([]);
    assertNoRatingLogs();
  });

  it('setRating then loadRatings returns the rating', () => {
    setRating('bar-1', 'loved');
    const all = loadRatings();

    expect(all).toHaveLength(1);
    expect(all[0].barId).toBe('bar-1');
    expect(all[0].rating).toBe('loved');
    expect(typeof all[0].ratedAt).toBe('string');
    // ratedAt should parse as a valid ISO date.
    expect(Number.isNaN(Date.parse(all[0].ratedAt))).toBe(false);
    assertNoRatingLogs();
  });

  it('setRating twice for the same barId overwrites (length stays 1)', () => {
    setRating('bar-1', 'liked');
    setRating('bar-1', 'pass');

    const all = loadRatings();
    expect(all).toHaveLength(1);
    expect(all[0].rating).toBe('pass');
    assertNoRatingLogs();
  });

  it('setRating for different barIds appends', () => {
    setRating('bar-1', 'loved');
    setRating('bar-2', 'liked');
    setRating('bar-3', 'pass');

    const all = loadRatings();
    expect(all).toHaveLength(3);
    const ids = all.map((r) => r.barId).sort();
    expect(ids).toEqual(['bar-1', 'bar-2', 'bar-3']);
    assertNoRatingLogs();
  });

  it('getRating returns null when not rated', () => {
    expect(getRating('never-rated')).toBeNull();
    setRating('bar-1', 'loved');
    expect(getRating('never-rated')).toBeNull();
    expect(getRating('bar-1')).toBe('loved');
    assertNoRatingLogs();
  });

  it('clearRating removes the rating', () => {
    setRating('bar-1', 'loved');
    setRating('bar-2', 'liked');
    expect(loadRatings()).toHaveLength(2);

    clearRating('bar-1');

    const all = loadRatings();
    expect(all).toHaveLength(1);
    expect(all[0].barId).toBe('bar-2');
    expect(getRating('bar-1')).toBeNull();
    assertNoRatingLogs();
  });

  it('sortRatingsByTierThenRecency: Loved before Liked before Pass; within tier, newer first', () => {
    const items: BarRating[] = [
      { barId: 'a', rating: 'pass', ratedAt: '2026-05-10T00:00:00.000Z' },
      { barId: 'b', rating: 'liked', ratedAt: '2026-05-05T00:00:00.000Z' },
      { barId: 'c', rating: 'loved', ratedAt: '2026-05-01T00:00:00.000Z' },
      { barId: 'd', rating: 'liked', ratedAt: '2026-05-12T00:00:00.000Z' },
      { barId: 'e', rating: 'loved', ratedAt: '2026-05-08T00:00:00.000Z' },
      { barId: 'f', rating: 'pass', ratedAt: '2026-05-15T00:00:00.000Z' },
    ];

    const sorted = sortRatingsByTierThenRecency(items);
    const order = sorted.map((r) => r.barId);

    // Loved: e (May 8) before c (May 1)
    // Liked: d (May 12) before b (May 5)
    // Pass:  f (May 15) before a (May 10)
    expect(order).toEqual(['e', 'c', 'd', 'b', 'f', 'a']);
    assertNoRatingLogs();
  });

  it('sortRatingsByTierThenRecency returns a new array (does not mutate input)', () => {
    const items: BarRating[] = [
      { barId: 'a', rating: 'pass', ratedAt: '2026-05-10T00:00:00.000Z' },
      { barId: 'b', rating: 'loved', ratedAt: '2026-05-05T00:00:00.000Z' },
    ];
    const before = [...items];
    const sorted = sortRatingsByTierThenRecency(items);

    expect(items).toEqual(before);
    expect(sorted).not.toBe(items);
  });

  it('malformed JSON in localStorage returns [] and does not throw', () => {
    window.localStorage.setItem(KEY, '{not json');

    expect(() => loadRatings()).not.toThrow();
    expect(loadRatings()).toEqual([]);
    assertNoRatingLogs();
  });

  it('non-array JSON in localStorage returns []', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ foo: 'bar' }));
    expect(loadRatings()).toEqual([]);
  });

  it('array with malformed entries returns []', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([{ barId: 'a', rating: 'bogus', ratedAt: '2026-05-01' }]),
    );
    expect(loadRatings()).toEqual([]);
  });

  it('dispatches a storage event with our key after setRating', () => {
    const handler = vi.fn();
    window.addEventListener('storage', handler);

    setRating('bar-1', 'loved');

    expect(handler).toHaveBeenCalled();
    const matchingCalls = handler.mock.calls.filter((call) => {
      const event = call[0] as StorageEvent;
      return event.key === KEY;
    });
    expect(matchingCalls.length).toBeGreaterThanOrEqual(1);

    window.removeEventListener('storage', handler);
  });

  it('dispatches a storage event with our key after clearRating', () => {
    setRating('bar-1', 'loved');

    const handler = vi.fn();
    window.addEventListener('storage', handler);

    clearRating('bar-1');

    expect(handler).toHaveBeenCalled();
    const matchingCalls = handler.mock.calls.filter((call) => {
      const event = call[0] as StorageEvent;
      return event.key === KEY;
    });
    expect(matchingCalls.length).toBeGreaterThanOrEqual(1);

    window.removeEventListener('storage', handler);
  });

  it('clearRating on a non-existent barId is a no-op (no event dispatched)', () => {
    const handler = vi.fn();
    window.addEventListener('storage', handler);

    clearRating('does-not-exist');

    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener('storage', handler);
  });
});
