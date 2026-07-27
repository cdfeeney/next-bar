import { describe, expect, test } from 'vitest';
import type { Bar, Coords, Radius } from '@/types';
import { RADIUS_CAB, RADIUS_WALK } from '@/lib/constants';
import {
  EMPTY_FILTERS,
  countActiveFilters,
  filterBars,
  toggleSelection,
  type FindBarFilters,
} from '@/lib/findBarFilters';

const makeBar = (overrides: Partial<Bar> & Pick<Bar, 'id'>): Bar => ({
  name: overrides.id,
  neighborhood: 'LES',
  address: '1 Test St',
  lat: 40.717,
  lng: -73.987,
  priceTier: 2,
  tags: ['dive'],
  blurb: 'test bar',
  lastVerified: '2026-07-01',
  ...overrides,
});

// LES centroid-ish; Harlem bar is ~6.5mi away, LES bar is right here.
const USER_AT_LES: Coords = { lat: 40.717, lng: -73.987 };

const lesDive = makeBar({ id: 'les-dive', neighborhood: 'LES', tags: ['dive', 'cheap'] });
const lesWine = makeBar({ id: 'les-wine', neighborhood: 'LES', tags: ['wine', 'chill'] });
const harlemJazz = makeBar({
  id: 'harlem-jazz',
  neighborhood: 'Harlem',
  lat: 40.811,
  lng: -73.945,
  tags: ['jazz', 'live'],
});
const wburgRooftop = makeBar({
  id: 'wburg-rooftop',
  neighborhood: 'Williamsburg',
  lat: 40.714,
  lng: -73.957,
  tags: ['rooftop', 'trendy'],
});

const ALL = [lesDive, lesWine, harlemJazz, wburgRooftop];

const walkable: Radius = { kind: 'walking', maxMiles: RADIUS_WALK };
const cab: Radius = { kind: 'cab', maxMiles: RADIUS_CAB };
const anywhere: Radius = { kind: 'anywhere', maxMiles: null };

describe('filterBars', () => {
  test('empty filters return every bar unchanged', () => {
    expect(filterBars(ALL, EMPTY_FILTERS, null)).toEqual(ALL);
  });

  test('single neighborhood keeps only that neighborhood', () => {
    const result = filterBars(ALL, { ...EMPTY_FILTERS, neighborhoods: ['LES'] }, null);
    expect(result.map((b) => b.id)).toEqual(['les-dive', 'les-wine']);
  });

  test('neighborhood multi-select is OR within the category', () => {
    const result = filterBars(
      ALL,
      { ...EMPTY_FILTERS, neighborhoods: ['Harlem', 'Williamsburg'] },
      null,
    );
    expect(result.map((b) => b.id)).toEqual(['harlem-jazz', 'wburg-rooftop']);
  });

  test('vibe multi-select matches bars with ANY selected tag', () => {
    const result = filterBars(
      ALL,
      { ...EMPTY_FILTERS, vibes: ['jazz', 'rooftop'] },
      null,
    );
    expect(result.map((b) => b.id)).toEqual(['harlem-jazz', 'wburg-rooftop']);
  });

  test('categories combine with AND', () => {
    const filters: FindBarFilters = {
      neighborhoods: ['LES'],
      radius: null,
      vibes: ['wine'],
    };
    expect(filterBars(ALL, filters, null).map((b) => b.id)).toEqual(['les-wine']);
  });

  test('walkable radius with coords drops far bars', () => {
    const result = filterBars(ALL, { ...EMPTY_FILTERS, radius: walkable }, USER_AT_LES);
    // Harlem (~6.5mi) is out; Williamsburg across the river is ~1.6mi — also out.
    expect(result.map((b) => b.id)).toEqual(['les-dive', 'les-wine']);
  });

  test('cab radius is wider than walkable', () => {
    const result = filterBars(ALL, { ...EMPTY_FILTERS, radius: cab }, USER_AT_LES);
    expect(result.map((b) => b.id)).toEqual(['les-dive', 'les-wine', 'wburg-rooftop']);
  });

  test('anywhere radius filters nothing', () => {
    expect(filterBars(ALL, { ...EMPTY_FILTERS, radius: anywhere }, USER_AT_LES)).toEqual(ALL);
  });

  test('radius without user coords is a no-op (defensive backstop)', () => {
    expect(filterBars(ALL, { ...EMPTY_FILTERS, radius: walkable }, null)).toEqual(ALL);
  });

  test('never mutates the input array', () => {
    const input = [...ALL];
    filterBars(input, { ...EMPTY_FILTERS, neighborhoods: ['LES'] }, USER_AT_LES);
    expect(input).toEqual(ALL);
  });
});

describe('countActiveFilters', () => {
  test('empty filters count 0', () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
  });

  test('counts each selected neighborhood and vibe, radius as 1', () => {
    const filters: FindBarFilters = {
      neighborhoods: ['LES', 'Harlem'],
      radius: walkable,
      vibes: ['dive'],
    };
    expect(countActiveFilters(filters)).toBe(4);
  });

  test('anywhere radius does not count as an active filter', () => {
    expect(countActiveFilters({ ...EMPTY_FILTERS, radius: anywhere })).toBe(0);
  });
});

describe('toggleSelection', () => {
  test('adds a missing value without mutating the original', () => {
    const original = ['LES'];
    const next = toggleSelection(original, 'Harlem');
    expect(next).toEqual(['LES', 'Harlem']);
    expect(original).toEqual(['LES']);
  });

  test('removes a present value', () => {
    expect(toggleSelection(['LES', 'Harlem'], 'LES')).toEqual(['Harlem']);
  });
});
