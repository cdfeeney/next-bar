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

  // Was: "vibe multi-select matches bars with ANY selected tag", asserting
  // jazz + rooftop returned BOTH bars. That encoded cross-axis OR, which the
  // operator explicitly asked to change (goal g-44007df6) because it made
  // adding a filter widen the results. `jazz` is Sound and `rooftop` is
  // Setting, so they now AND. Replaced with two assertions rather than one, so
  // both halves of the rule are pinned here as well as in the dedicated block.
  test('vibes on DIFFERENT axes intersect — no bar is both jazz and a rooftop', () => {
    const result = filterBars(ALL, { ...EMPTY_FILTERS, vibes: ['jazz', 'rooftop'] }, null);
    expect(result).toEqual([]);
  });

  test('vibes on the SAME axis still match either', () => {
    // Both Setting.
    const result = filterBars(ALL, { ...EMPTY_FILTERS, vibes: ['dive', 'rooftop'] }, null);
    expect(result.map((b) => b.id).sort()).toEqual(['les-dive', 'wburg-rooftop']);
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

/**
 * Acceptance criterion 1 (goal g-44007df6): OR within one axis, AND across axes.
 * The operator's words: "Club must reliably restrict results to clubs; Club +
 * Dancing + House must require those selected dimensions."
 *
 * Before this, every vibe was one flat OR — so asking for a club ALSO returned
 * anything merely tagged `dance` or `house`, which is the opposite of narrowing.
 */
describe('filterBars — OR within an axis, AND across axes', () => {
  const club = makeBar({ id: 'club', tags: ['club', 'dance', 'house', 'loud'] });
  const danceBar = makeBar({ id: 'dance-bar', tags: ['dive', 'dance'] });
  const houseLounge = makeBar({ id: 'house-lounge', tags: ['lounge', 'house'] });
  const quietClub = makeBar({ id: 'quiet-club', tags: ['club', 'chill'] });
  const SET = [club, danceBar, houseLounge, quietClub];

  const withVibes = (vibes: FindBarFilters['vibes']): string[] =>
    filterBars(SET, { ...EMPTY_FILTERS, vibes }, null).map((b) => b.id);

  test('"club" restricts to clubs — not to anything dance-adjacent', () => {
    expect(withVibes(['club']).sort()).toEqual(['club', 'quiet-club']);
  });

  test('club + dance + house requires ALL THREE dimensions', () => {
    // Three different axes (Setting, Energy, Sound) → AND.
    expect(withVibes(['club', 'dance', 'house'])).toEqual(['club']);
  });

  test('two tags from the SAME axis still mean either', () => {
    // Both Setting → OR. quiet-club and club are clubs; house-lounge is a lounge.
    expect(withVibes(['club', 'lounge']).sort()).toEqual(['club', 'house-lounge', 'quiet-club']);
  });

  test('no vibes selected returns everything', () => {
    expect(withVibes([])).toHaveLength(SET.length);
  });

  test('an unmatchable combination returns nothing rather than falling back', () => {
    // Setting + Sound, so these AND. No bar here is a club playing jazz.
    // (Deliberately NOT club + garden: both are Setting, so that pair ORs and
    // correctly returns the clubs — a mistake worth recording, since picking
    // two same-axis tags to test AND proves nothing.)
    expect(withVibes(['club', 'jazz'])).toEqual([]);
  });

  test('still ANDs against neighborhood and radius', () => {
    const out = filterBars(
      [...SET, makeBar({ id: 'harlem-club', neighborhood: 'Harlem', tags: ['club'] })],
      { ...EMPTY_FILTERS, vibes: ['club'], neighborhoods: ['Harlem'] },
      null,
    );
    expect(out.map((b) => b.id)).toEqual(['harlem-club']);
  });
});

describe('filterBars — exact filters are NEVER silently weakened (goal g-6cc99120)', () => {
  // Typed through the file's own factory (santa review: `as never` casts
  // silenced real structural mismatches — these fixtures must fail loudly
  // at compile time if Bar or FindBarFilters change shape).
  const threeAxisCombo: FindBarFilters = {
    neighborhoods: [],
    radius: null,
    vibes: ['chill', 'rooftop', 'old-nyc'],
  };

  test('a three-axis combo with only pairwise matches returns EMPTY — no padding, no fallback', () => {
    // Chill (Energy) + Rooftop (Setting) + Old New York (Scene): every bar
    // below matches exactly two of the three axes. The honest answer is [],
    // and the UI's job is to say so — not to quietly widen the request.
    const bars = [
      makeBar({ id: 'chill-rooftop', tags: ['chill', 'rooftop'] }),
      makeBar({ id: 'chill-oldnyc', tags: ['chill', 'old-nyc'] }),
      makeBar({ id: 'rooftop-oldnyc', tags: ['rooftop', 'old-nyc'] }),
      makeBar({ id: 'everything-else', tags: ['loud', 'club', 'trendy'] }),
    ];
    expect(filterBars(bars, threeAxisCombo, null)).toEqual([]);
  });

  test('the same combo DOES match a bar carrying all three (sanity: the AND is real, not vacuous)', () => {
    const bars = [
      makeBar({ id: 'the-unicorn', tags: ['chill', 'rooftop', 'old-nyc'] }),
      makeBar({ id: 'chill-rooftop', tags: ['chill', 'rooftop'] }),
    ];
    expect(filterBars(bars, threeAxisCombo, null).map((b) => b.id)).toEqual(['the-unicorn']);
  });
});
