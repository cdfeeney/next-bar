import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import CatalogRefresh, { CATALOG_SNAPSHOT_KEY, CATALOG_SNAPSHOT_MAX_AGE_MS } from './CatalogRefresh';

/**
 * Regression: PostgREST caps EVERY response at 1,000 rows — silently,
 * with a 200 and no error. The catalog crossed 1,000 venues on
 * 2026-07-27, at which point an unpaginated select would have dropped
 * every bar past the thousandth while the app looked perfectly healthy.
 * These tests pin the paging, not the happy path — and since T-01c, that
 * the remaining pages are fetched TOGETHER and that a stored snapshot
 * paints before any request resolves.
 */

const ranges: Array<[number, number]> = [];
let totalRows = 0;
let pageError = false;
/** When set, every page resolves only when the test says so (in order). */
let deferPages = false;
const pending: Array<() => void> = [];
const selectedColumns: string[] = [];

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
    place_id: `place-${i}`,
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
      select: (columns: string, opts?: { count?: string }) => {
        selectedColumns.push(columns);
        return {
          order: () => ({
            range: (from: number, to: number) => {
              ranges.push([from, to]);
              const answer = () => {
                if (pageError) return { data: null, error: { message: 'boom' } };
                const page = [];
                for (let i = from; i <= to && i < totalRows; i++) page.push(makeRow(i));
                return { data: page, error: null, count: opts?.count ? totalRows : null };
              };
              if (!deferPages) return Promise.resolve(answer());
              return new Promise((resolve) => pending.push(() => resolve(answer())));
            },
          }),
        };
      },
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

const seedSnapshot = (rows: number, savedAt = Date.now()) =>
  window.localStorage.setItem(
    CATALOG_SNAPSHOT_KEY,
    JSON.stringify({ savedAt, rows: Array.from({ length: rows }, (_, i) => makeRow(i)) }),
  );

describe('CatalogRefresh paging (PostgREST 1,000-row cap)', () => {
  beforeEach(() => {
    ranges.length = 0;
    replaced.length = 0;
    selectedColumns.length = 0;
    pending.length = 0;
    pageError = false;
    deferPages = false;
    window.localStorage.clear();
  });

  test('fetches EVERY row when the catalog exceeds 1,000', async () => {
    totalRows = 1265;
    render(<CatalogRefresh />);
    await waitFor(() => expect(replaced.length).toBe(1));
    // 1,265 rows = the counted first page, then exactly one more.
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(replaced[0]).toHaveLength(1265);
    expect(replaced[0][0]).toMatchObject({ googlePlaceId: 'place-0' });
    expect(selectedColumns[0]).toBe(
      'id,name,lat,lng,tags,neighborhood,price_tier,hours,place_id,business_status,last_verified',
    );
  });

  test('stops after one request when the catalog is under a page', async () => {
    totalRows = 300;
    render(<CatalogRefresh />);
    await waitFor(() => expect(replaced.length).toBe(1));
    expect(ranges).toEqual([[0, 999]]);
    expect(replaced[0]).toHaveLength(300);
  });

  test('an exactly-full catalog needs no probing third request (the count says so)', async () => {
    totalRows = 2000;
    render(<CatalogRefresh />);
    await waitFor(() => expect(replaced.length).toBe(1));
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(replaced[0]).toHaveLength(2000);
  });

  test('the remaining pages are requested together, not one after another (T-01c)', async () => {
    totalRows = 2107;
    deferPages = true;
    render(<CatalogRefresh />);
    await waitFor(() => expect(pending.length).toBe(1));
    expect(ranges).toEqual([[0, 999]]);
    await act(async () => { pending.shift()!(); });
    // Both tail pages are in flight before either has answered.
    await waitFor(() => expect(pending.length).toBe(2));
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    await act(async () => { pending.splice(0).forEach((resolve) => resolve()); });
    await waitFor(() => expect(replaced.length).toBe(1));
    expect(replaced[0]).toHaveLength(2107);
    // ...and the good set is kept for the next visit.
    const stored = JSON.parse(window.localStorage.getItem(CATALOG_SNAPSHOT_KEY) ?? 'null');
    expect(stored.rows).toHaveLength(2107);
  });

  test('a stored snapshot paints the full catalog before any request answers (T-01c)', async () => {
    totalRows = 2107;
    deferPages = true;
    seedSnapshot(1500);
    render(<CatalogRefresh />);
    // Swapped in synchronously from storage; nothing has resolved yet.
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toHaveLength(1500);
    expect(screen.queryByRole('status')).toBeNull();
    await waitFor(() => expect(pending.length).toBe(1));
    await act(async () => { pending.shift()!(); });
    await waitFor(() => expect(pending.length).toBe(2));
    await act(async () => { pending.splice(0).forEach((resolve) => resolve()); });
    await waitFor(() => expect(replaced.length).toBe(2));
    expect(replaced[1]).toHaveLength(2107);
  });

  test('a stale or unparseable snapshot is the cold path', async () => {
    totalRows = 300;
    seedSnapshot(1500, Date.now() - CATALOG_SNAPSHOT_MAX_AGE_MS - 1);
    render(<CatalogRefresh />);
    expect(replaced).toHaveLength(0);
    await waitFor(() => expect(replaced.length).toBe(1));
    expect(replaced[0]).toHaveLength(300);

    replaced.length = 0;
    window.localStorage.setItem(CATALOG_SNAPSHOT_KEY, '{not json');
    render(<CatalogRefresh />);
    expect(replaced).toHaveLength(0);
    await waitFor(() => expect(replaced.length).toBe(1));
  });

  test('reports a failed refresh and keeps the emergency catalog', async () => {
    pageError = true;
    render(<CatalogRefresh />);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Catalog refresh unavailable',
    );
    expect(replaced).toHaveLength(0);
  });

  test('a failed refresh over a good snapshot keeps the snapshot and shows no pill', async () => {
    pageError = true;
    seedSnapshot(1500);
    render(<CatalogRefresh />);
    expect(replaced).toHaveLength(1);
    await waitFor(() => expect(ranges.length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('status')).toBeNull();
    expect(replaced).toHaveLength(1);
  });
});
