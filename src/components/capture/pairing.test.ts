import { describe, expect, it } from 'vitest';
import { keepOnly, pairKind, replaceSide, swapMain, type Pair } from './pairing';

const pair: Pair = { main: 'rear', inset: 'front' };

describe('dual-shot pairing', () => {
  it('swaps which shot fills the frame without losing either', () => {
    expect(swapMain(pair)).toEqual({ main: 'front', inset: 'rear' });
  });

  it('returns a new object rather than mutating the pair', () => {
    const before = { ...pair };
    swapMain(pair);
    keepOnly(pair, 'inset');
    expect(pair).toEqual(before);
  });

  it('keeps only the outward shot', () => {
    expect(keepOnly(pair, 'main')).toEqual({ main: 'rear', inset: null });
  });

  it('promotes the inset when only the selfie is kept, never leaving an empty frame', () => {
    expect(keepOnly(pair, 'inset')).toEqual({ main: 'front', inset: null });
  });

  it('leaves a single photo untouched under swap and keep-inset', () => {
    const single: Pair = { main: 'rear', inset: null };
    expect(swapMain(single)).toBe(single);
    expect(keepOnly(single, 'inset')).toBe(single);
  });

  it('replaces one side with a rotated copy and leaves the other alone', () => {
    expect(replaceSide(pair, 'main', 'rear-rotated')).toEqual({
      main: 'rear-rotated',
      inset: 'front',
    });
    expect(replaceSide(pair, 'inset', 'front-rotated')).toEqual({
      main: 'rear',
      inset: 'front-rotated',
    });
  });

  it('reports dual only while both halves survive', () => {
    expect(pairKind(pair)).toBe('dual');
    expect(pairKind(keepOnly(pair, 'main'))).toBe('single');
  });
});
