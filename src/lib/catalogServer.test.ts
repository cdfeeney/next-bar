import { describe, expect, test } from 'vitest';
import { rowToBar, rowsToCatalog, type BarsTableRow } from './catalogServer';

const goodRow = (over: Partial<BarsTableRow> = {}): BarsTableRow => ({
  id: 'attaboy',
  name: 'Attaboy',
  lat: 40.7189,
  lng: -73.9914,
  tags: ['cocktail', 'speakeasy'],
  neighborhood: 'LES',
  price_tier: 3,
  hours: null,
  blurb: 'x',
  address: '134 Eldridge St',
  place_id: null,
  business_status: null,
  photo_count: 0,
  photo_attributions: null,
  reviews: null,
  last_verified: '2026-07-01',
  ...over,
});

describe('rowToBar boundary validation (0019 swap)', () => {
  test('a clean row maps with tags intact', () => {
    const bar = rowToBar(goodRow());
    expect(bar?.id).toBe('attaboy');
    expect(bar?.tags).toEqual(['cocktail', 'speakeasy']);
    expect(bar?.priceTier).toBe(3);
  });

  test('unknown tags are dropped, not fatal (vocabulary is app-side)', () => {
    const bar = rowToBar(goodRow({ tags: ['cocktail', 'not-a-tag'] }));
    expect(bar?.tags).toEqual(['cocktail']);
  });

  test.each([
    ['out-of-bbox coords', { lat: 34.05, lng: -118.24 }],
    ['unknown neighborhood', { neighborhood: 'Hoboken' }],
    ['price tier out of range', { price_tier: 9 }],
    ['malformed id', { id: 'DROP TABLE;' }],
    ['missing freshness', { last_verified: '' }],
    ['empty name', { name: '' }],
  ] as const)('rejects: %s', (_label, over) => {
    expect(rowToBar(goodRow(over as Partial<BarsTableRow>))).toBeNull();
  });
});

describe('rowsToCatalog batch guard', () => {
  const many = (n: number): BarsTableRow[] =>
    Array.from({ length: n }, (_, i) => goodRow({ id: `bar-${i}` }));

  test('a plausible batch maps', () => {
    expect(rowsToCatalog(many(150), 400)?.length).toBe(150);
  });

  test('an implausibly small batch is rejected wholesale (truncated fetch must not shrink the catalog)', () => {
    expect(rowsToCatalog(many(5), 400)).toBeNull();
  });

  test('duplicate ids reject the batch (corrupt import)', () => {
    const rows = many(150);
    rows[1] = goodRow({ id: 'bar-0' });
    expect(rowsToCatalog(rows, 400)).toBeNull();
  });
});
