import { describe, it, expect } from 'vitest';
import { arrangeWidenedHand } from '@/lib/freshHand';
import type { Bar, Coords } from '@/types';

/**
 * Fixture geometry: origin at Union Square; bars placed by latitude offset
 * (1 degree lat ≈ 69 miles, so +0.01 ≈ 0.69 mi, +0.03 ≈ 2.07 mi, +0.06 ≈
 * 4.14 mi). "Walkable" prev radius = 1.5 mi, so NEAR bars (~0.69 mi) were
 * already eligible and MID bars (~2.07 mi) are newly eligible at cab (4 mi).
 */
const ORIGIN: Coords = { lat: 40.7359, lng: -73.9911 };

const bar = (id: string, latOffset: number): Bar =>
  ({
    id,
    name: id,
    neighborhood: 'Midtown',
    address: '1 Main St',
    lat: ORIGIN.lat + latOffset,
    lng: ORIGIN.lng,
    priceTier: 2,
    tags: [],
    blurb: 'A bar.',
    lastVerified: '2026-04-01',
  }) as Bar;

const NEAR_A = bar('near-a', 0.005); // ~0.35 mi — inside prev radius
const NEAR_B = bar('near-b', 0.008);
const NEAR_C = bar('near-c', 0.01);
const MID_A = bar('mid-a', 0.03); // ~2.1 mi — newly eligible at cab
const MID_B = bar('mid-b', 0.035);
const PREV_RADIUS = 1.5;

describe('arrangeWidenedHand', () => {
  it('puts newly eligible bars first, then unseen near bars, preserving rank order within buckets', () => {
    const { hand } = arrangeWidenedHand({
      ranked: [NEAR_A, NEAR_B, MID_A, NEAR_C, MID_B], // score order
      coords: ORIGIN,
      prevMaxMiles: PREV_RADIUS,
      seenIds: ['near-a'],
      count: 5,
    });
    expect(hand.map((b) => b.id)).toEqual([
      'mid-a', // newly eligible, best-ranked first
      'mid-b',
      'near-b', // unseen within old radius, rank order preserved
      'near-c',
      'near-a', // seen — fallback only
    ]);
  });

  it('fills the hand without reuse when unseen bars suffice', () => {
    const { hand, usedFallback } = arrangeWidenedHand({
      ranked: [NEAR_A, NEAR_B, MID_A, MID_B, NEAR_C],
      coords: ORIGIN,
      prevMaxMiles: PREV_RADIUS,
      seenIds: ['near-a', 'near-b'],
      count: 3,
    });
    expect(hand.map((b) => b.id)).toEqual(['mid-a', 'mid-b', 'near-c']);
    expect(usedFallback).toBe(false);
  });

  it('reuses seen bars only when the unseen pool cannot fill the count', () => {
    const { hand, usedFallback } = arrangeWidenedHand({
      ranked: [NEAR_A, NEAR_B, MID_A],
      coords: ORIGIN,
      prevMaxMiles: PREV_RADIUS,
      seenIds: ['near-a', 'near-b'],
      count: 3,
    });
    expect(hand.map((b) => b.id)).toEqual(['mid-a', 'near-a', 'near-b']);
    expect(usedFallback).toBe(true);
  });

  it('returns a short hand when the whole pool is smaller than the count', () => {
    const { hand } = arrangeWidenedHand({
      ranked: [NEAR_A, MID_A],
      coords: ORIGIN,
      prevMaxMiles: PREV_RADIUS,
      seenIds: [],
      count: 5,
    });
    expect(hand.map((b) => b.id)).toEqual(['mid-a', 'near-a']);
  });

  it('a bar exactly at the previous radius is NOT newly eligible', () => {
    // 1.5 mi ≈ 0.021739 degrees of latitude; use a distance just UNDER the
    // boundary so float noise cannot flip it over.
    const atBoundary = bar('at-boundary', 0.0217);
    const { hand } = arrangeWidenedHand({
      ranked: [atBoundary, MID_A],
      coords: ORIGIN,
      prevMaxMiles: PREV_RADIUS,
      seenIds: [],
      count: 2,
    });
    // mid-a (genuinely beyond 1.5mi) outranks the boundary bar despite
    // arriving later in score order, because only it is newly eligible.
    expect(hand.map((b) => b.id)).toEqual(['mid-a', 'at-boundary']);
  });

  it('degrades to unseen-first when coords are unavailable', () => {
    const { hand } = arrangeWidenedHand({
      ranked: [NEAR_A, MID_A, NEAR_B],
      coords: null,
      prevMaxMiles: PREV_RADIUS,
      seenIds: ['near-a'],
      count: 3,
    });
    // No distance knowledge → no newly-eligible bucket → pure rank order
    // among unseen, seen last.
    expect(hand.map((b) => b.id)).toEqual(['mid-a', 'near-b', 'near-a']);
  });

  it('degrades to unseen-first when the previous radius is unknown', () => {
    const { hand } = arrangeWidenedHand({
      ranked: [NEAR_A, MID_A, NEAR_B],
      coords: ORIGIN,
      prevMaxMiles: null,
      seenIds: ['near-a'],
      count: 3,
    });
    expect(hand.map((b) => b.id)).toEqual(['mid-a', 'near-b', 'near-a']);
  });

  it('is deterministic: identical inputs give identical hands', () => {
    const args = {
      ranked: [NEAR_A, NEAR_B, MID_A, NEAR_C, MID_B],
      coords: ORIGIN,
      prevMaxMiles: PREV_RADIUS,
      seenIds: ['near-b'],
      count: 4,
    };
    const first = arrangeWidenedHand(args).hand.map((b) => b.id);
    const second = arrangeWidenedHand(args).hand.map((b) => b.id);
    expect(second).toEqual(first);
  });

  it('a duplicated id in the ranking occupies only one hand slot', () => {
    const { hand } = arrangeWidenedHand({
      ranked: [NEAR_A, MID_A, NEAR_A, NEAR_B],
      coords: ORIGIN,
      prevMaxMiles: PREV_RADIUS,
      seenIds: [],
      count: 4,
    });
    expect(hand.map((b) => b.id)).toEqual(['mid-a', 'near-a', 'near-b']);
  });

  it('does not mutate the input ranking', () => {
    const ranked = [NEAR_A, MID_A, NEAR_B];
    const before = ranked.map((b) => b.id);
    arrangeWidenedHand({
      ranked,
      coords: ORIGIN,
      prevMaxMiles: PREV_RADIUS,
      seenIds: ['near-a'],
      count: 3,
    });
    expect(ranked.map((b) => b.id)).toEqual(before);
  });
});
