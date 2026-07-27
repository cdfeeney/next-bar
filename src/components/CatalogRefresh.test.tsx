import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import CatalogRefresh from './CatalogRefresh';

/**
 * Regression: PostgREST caps EVERY response at 1,000 rows — silently,
 * with a 200 and no error. The catalog crossed 1,000 venues on
 * 2026-07-27, at which point an unpaginated select would have dropped
 * every bar past the thousandth while the app looked perfectly healthy.
 * These tests pin the paging loop, not the happy path.
 */

const ranges: Array<[number, number]> = [];
let totalRows = 0;

function makeRow(i: number) {
  return {
    id: `bar-${String(i).padStart(5, '0')}`,
    name: `Bar ${i}`,
    lat: 40.72,
    lng: -73.99,
    tags: ['dive'],
    neighborhood: 'East Village',
    price_tier: 2,
    hours: null,
    blurb: 'A bar.',
    address: '1 Main St',
    place_id: null,
    business_status: null,
    photo_count: 0,
    photo_attributions: null,
    reviews: null,
    last_verified: '2026-07-27',
  };
}

const replaced: unknown[][] = [];

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({
    from: () => ({
      select: () => ({
        order: () => ({
          range: (from: number, to: number) => {
            ranges.push([from, to]);
            const page = [];
            for (let i = from; i <= to && i < totalRows; i++) page.push(makeRow(i));
            return Promise.resolve({ data: page, error: null });
          },
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/catalog')>();
  return {
    ...actual,
    getBarsSnapshot: () => new Array(50).fill(null),
    replaceCatalog: (bars: unknown[]) => replaced.push(bars),
  };
});

describe('CatalogRefresh paging (PostgREST 1,000-row cap)', () => {
  beforeEach(() => {
    ranges.length = 0;
    replaced.length = 0;
  });

  test('fetches EVERY row when the catalog exceeds 1,000', async () => {
    totalRows = 1265;
    render(<CatalogRefresh />);
    await waitFor(() => expect(replaced.length).toBe(1));
    // 1,265 rows = a full page, then a short page that ends the loop.
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(replaced[0]).toHaveLength(1265);
  });

  test('stops after one request when the catalog is under a page', async () => {
    totalRows = 300;
    render(<CatalogRefresh />);
    await waitFor(() => expect(replaced.length).toBe(1));
    expect(ranges).toEqual([[0, 999]]);
    expect(replaced[0]).toHaveLength(300);
  });

  test('an exactly-full final page still terminates', async () => {
    totalRows = 2000;
    render(<CatalogRefresh />);
    await waitFor(() => expect(replaced.length).toBe(1));
    // Third request returns empty, which is what breaks the loop.
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(replaced[0]).toHaveLength(2000);
  });
});
