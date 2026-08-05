import { describe, expect, test } from 'vitest';
import type { Bar } from '@/types';
import { MAX_RESULTS, MIN_QUERY_LENGTH, searchCatalog } from '@/lib/searchBars';

function makeBar(overrides: Partial<Bar> & { id: string; name: string }): Bar {
  return {
    neighborhood: 'LES',
    address: '1 Test St',
    lat: 40.72,
    lng: -73.98,
    priceTier: 2,
    tags: ['cocktail'],
    blurb: 'test',
    lastVerified: '2026-01-01',
    ...overrides,
  } as Bar;
}

const BARS: Bar[] = [
  makeBar({ id: 'attaboy', name: 'Attaboy', neighborhood: 'LES', tags: ['cocktail', 'speakeasy'] }),
  makeBar({ id: 'attagirl', name: 'Attagirl', neighborhood: 'UWS', tags: ['wine'] }),
  makeBar({ id: 'manhatta', name: 'Manhatta', neighborhood: 'FiDi', tags: ['cocktail', 'polished'] }),
  makeBar({ id: 'jimmys', name: "Jimmy's Corner", neighborhood: 'Midtown', tags: ['dive', 'cheap'] }),
  makeBar({ id: 'houseofyes', name: 'House of Yes', neighborhood: 'Bushwick', tags: ['club', 'dance'] }),
];

describe('searchCatalog', () => {
  test('returns nothing below the minimum query length', () => {
    expect(searchCatalog(BARS, '')).toEqual({ results: [], total: 0 });
    expect(searchCatalog(BARS, 'a')).toEqual({ results: [], total: 0 });
    expect(MIN_QUERY_LENGTH).toBe(2);
  });

  test('finds a bar by exact name, case-insensitively', () => {
    const { results } = searchCatalog(BARS, 'ATTABOY');
    expect(results.map((b) => b.id)).toEqual(['attaboy']);
  });

  test('finds bars by partial name, prefix matches ranked first', () => {
    const { results } = searchCatalog(BARS, 'atta');
    // Prefix matches first (alphabetical), then the substring match
    // (Manh-ATTA) — ranking, not exclusion.
    expect(results.map((b) => b.id)).toEqual(['attaboy', 'attagirl', 'manhatta']);
  });

  test('name substring beats neighborhood/tag matches in ordering', () => {
    // 'house': name-substring for House of Yes, tag ('house') would also
    // match, but the name bucket wins; nothing else matches.
    const { results } = searchCatalog(BARS, 'house');
    expect(results[0].id).toBe('houseofyes');
  });

  test('finds bars by raw neighborhood value', () => {
    const { results } = searchCatalog(BARS, 'midtown');
    expect(results.map((b) => b.id)).toContain('jimmys');
  });

  test('finds bars by spelled-out neighborhood display name', () => {
    // displayHood('LES') === 'Lower East Side'
    const { results } = searchCatalog(BARS, 'lower east');
    expect(results.map((b) => b.id)).toEqual(['attaboy']);
  });

  test('finds bars by human-readable tag label', () => {
    // TAG_DISPLAY.dance === 'Dancing'
    const { results } = searchCatalog(BARS, 'dancing');
    expect(results.map((b) => b.id)).toEqual(['houseofyes']);
  });

  test('finds bars by raw tag token', () => {
    const { results } = searchCatalog(BARS, 'speakeasy');
    expect(results.map((b) => b.id)).toEqual(['attaboy']);
  });

  test('returns empty results (not a throw) when nothing matches', () => {
    expect(searchCatalog(BARS, 'zzzz-not-a-bar')).toEqual({ results: [], total: 0 });
  });

  test('caps rendered results at MAX_RESULTS but reports the true total', () => {
    const many = Array.from({ length: MAX_RESULTS + 10 }, (_, i) =>
      makeBar({ id: `bar-${String(i).padStart(3, '0')}`, name: `Common Bar ${String(i).padStart(3, '0')}` }),
    );
    const { results, total } = searchCatalog(many, 'common');
    expect(results).toHaveLength(MAX_RESULTS);
    expect(total).toBe(MAX_RESULTS + 10);
  });

  test('ordering is fully deterministic (name then id tiebreak)', () => {
    const twin = [
      makeBar({ id: 'b-twin', name: 'Twin Bar' }),
      makeBar({ id: 'a-twin', name: 'Twin Bar' }),
    ];
    const { results } = searchCatalog(twin, 'twin');
    expect(results.map((b) => b.id)).toEqual(['a-twin', 'b-twin']);
  });
});
