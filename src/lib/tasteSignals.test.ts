import { describe, expect, test } from 'vitest';
import type { Bar, VibeTag } from '@/types';
import {
  MIN_PASSED_BARS_FOR_AVOID,
  buildAvoidTagWeights,
  buildLovedTagWeights,
  weightedTagCoverage,
} from '@/lib/tasteSignals';

function bar(id: string, tags: VibeTag[]): Bar {
  return {
    id,
    name: id,
    neighborhood: 'East Village',
    address: '1 Test St',
    lat: 40.727,
    lng: -73.984,
    priceTier: 2,
    tags,
    blurb: '',
    lastVerified: '2026-07-01',
  } as Bar;
}

const BARS: Bar[] = [
  bar('a', ['dive', 'chill']),
  bar('b', ['dive', 'locals']),
  bar('c', ['dive', 'beer']),
  bar('d', ['cocktail', 'polished']),
  bar('e', ['loud', 'club']),
  bar('f', ['loud', 'trendy']),
  bar('g', ['loud', 'dive']),
];

describe('buildLovedTagWeights', () => {
  test('weights are frequency shares, not a flattened union', () => {
    const w = buildLovedTagWeights(['a', 'b', 'c'], BARS);
    // 'dive' in 3/3 loved bars; 'chill'/'locals'/'beer' in 1/3 each.
    expect(w.get('dive')).toBeCloseTo(1);
    expect(w.get('chill')).toBeCloseTo(1 / 3);
    expect(w.get('locals')).toBeCloseTo(1 / 3);
    expect(w.get('beer')).toBeCloseTo(1 / 3);
    expect(w.has('cocktail')).toBe(false);
  });

  test('empty history → empty map (matcher falls back to flat/no affinity)', () => {
    expect(buildLovedTagWeights([], BARS).size).toBe(0);
    expect(buildLovedTagWeights(['nope'], BARS).size).toBe(0);
  });

  test('a SINGLE Loved bar stays below the caution floor — no echo chamber (eval-confirmed)', () => {
    // One loved bar would give every one of its tags weight 1.0 and
    // concentrate the hand around one venue; the corpus measured a real
    // entropy drop. Below MIN_LOVED_BARS_FOR_WEIGHTS the builder
    // returns empty and scoreBar falls back to the flat union.
    expect(buildLovedTagWeights(['a'], BARS).size).toBe(0);
    expect(buildLovedTagWeights(['a', 'b'], BARS).size).toBeGreaterThan(0);
  });
});

describe('buildAvoidTagWeights — the caution rules', () => {
  test(`a tag needs ≥${MIN_PASSED_BARS_FOR_AVOID} passed bars to become a signal`, () => {
    // 'loud' in 2 passed bars → signal; 'club'/'trendy' in 1 each → not.
    const w = buildAvoidTagWeights(['e', 'f'], [], BARS);
    expect(w.has('loud')).toBe(true);
    expect(w.has('club')).toBe(false);
    expect(w.has('trendy')).toBe(false);
  });

  test('a tag the user has EVER Loved is never penalized', () => {
    // 'dive' appears in 2 passed bars (c? no — e,f,g: g has dive)…
    const w = buildAvoidTagWeights(['e', 'f', 'g'], ['a'], BARS);
    // 'loud' in 3 passed → signal. 'dive' in 1 passed AND loved via 'a' →
    // excluded by BOTH rules; assert the loved rule alone with 2 passes:
    const w2 = buildAvoidTagWeights(['g', 'c'], ['a'], BARS);
    expect(w2.has('dive')).toBe(false); // 2 passed bars carry it, but it is loved
    expect(w.has('loud')).toBe(true);
  });

  test('empty pass history → empty map', () => {
    expect(buildAvoidTagWeights([], ['a'], BARS).size).toBe(0);
  });
});

describe('weightedTagCoverage', () => {
  test('is matched-weight share in [0,1]; extra bar tags are not penalized', () => {
    const w = buildLovedTagWeights(['a', 'b', 'c'], BARS);
    // Bar with just 'dive' covers 1 / (1 + 1/3 + 1/3 + 1/3) = 0.5.
    expect(weightedTagCoverage(['dive'], w)).toBeCloseTo(0.5);
    // Adding unrelated tags does NOT reduce coverage (breadth is the
    // vibe term's job).
    expect(weightedTagCoverage(['dive', 'rooftop', 'garden'], w)).toBeCloseTo(0.5);
    // Full coverage → 1.
    expect(
      weightedTagCoverage(['dive', 'chill', 'locals', 'beer'], w),
    ).toBeCloseTo(1);
    // Empty weights → 0 (no signal, no effect).
    expect(weightedTagCoverage(['dive'], new Map())).toBe(0);
  });
});
