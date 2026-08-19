import { describe, expect, it } from 'vitest';
import { deriveLearnedTaste, learnedTasteScore, EMPTY_TASTE } from '@/lib/tasteAffinity';
import type { Bar, VibeTag } from '@/types';
import type { BarRating } from '@/types/ratings';

const bar = (id: string, tags: VibeTag[]): Bar =>
  ({
    id,
    name: id,
    neighborhood: 'East Village',
    address: '1 Main St',
    lat: 40.7,
    lng: -73.9,
    priceTier: 2,
    tags,
    blurb: 'A bar.',
    lastVerified: '2026-07-20T00:00:00.000Z',
  }) as Bar;

const rated = (barId: string, score: number | null): BarRating => ({
  barId,
  rating: 'liked',
  ratedAt: '2026-08-01T00:00:00.000Z',
  score,
});

describe('deriveLearnedTaste — the approved V8 evidence model', () => {
  it('maps 5.5 to neutral, 10.0 to +1 and 1.0 to -1 before shrinkage', () => {
    // One observation each, so A(tag) = w / (1 + 5).
    const t = deriveLearnedTaste(
      [rated('hi', 10), rated('mid', 5.5), rated('lo', 1)],
      [bar('hi', ['club']), bar('mid', ['dive']), bar('lo', ['rooftop'])],
    );
    expect(t.affinity.get('club')).toBeCloseTo(1 / 6, 10);
    expect(t.affinity.get('dive')).toBeCloseTo(0, 10);
    expect(t.affinity.get('rooftop')).toBeCloseTo(-1 / 6, 10);
  });

  it('accumulates repeated observations of the same tag', () => {
    const one = deriveLearnedTaste([rated('a', 10)], [bar('a', ['dive'])]);
    const three = deriveLearnedTaste(
      [rated('a', 10), rated('b', 10), rated('c', 10)],
      [bar('a', ['dive']), bar('b', ['dive']), bar('c', ['dive'])],
    );
    // Σw/(n+5): 1/6 vs 3/8 — more evidence, more confident affinity.
    expect(one.affinity.get('dive')).toBeCloseTo(1 / 6, 10);
    expect(three.affinity.get('dive')).toBeCloseTo(3 / 8, 10);
    expect(three.affinity.get('dive')!).toBeGreaterThan(one.affinity.get('dive')!);
  });

  it('lets low scores cancel high ones — negative evidence is real evidence', () => {
    const t = deriveLearnedTaste(
      [rated('a', 10), rated('b', 1)],
      [bar('a', ['dive']), bar('b', ['dive'])],
    );
    expect(t.affinity.get('dive')).toBeCloseTo(0, 10);
  });

  it('is not fooled by rating COUNT — one loved bar is not two hundred', () => {
    // The bug in the replaced Set-based model: membership, not magnitude.
    const t = deriveLearnedTaste(
      [rated('a', 6), rated('b', 6)],
      [bar('a', ['dive']), bar('b', ['dive'])],
    );
    // Two mildly-positive bars stay mild; they do not saturate.
    expect(t.affinity.get('dive')!).toBeLessThan(0.3);
  });

  it('ignores unscored ratings rather than inventing a midpoint for them', () => {
    const t = deriveLearnedTaste(
      [rated('a', null), { ...rated('b', 0), score: undefined }],
      [bar('a', ['dive']), bar('b', ['dive'])],
    );
    expect(t.n).toBe(0);
    expect(t.affinity.size).toBe(0);
  });

  it('skips ratings for bars outside the supplied catalog', () => {
    const t = deriveLearnedTaste([rated('ghost', 9)], [bar('a', ['dive'])]);
    expect(t.n).toBe(0);
  });

  it('grows confidence as c = N/(N+10)', () => {
    const c = (n: number) =>
      deriveLearnedTaste(
        Array.from({ length: n }, (_, i) => rated(`b${i}`, 8)),
        Array.from({ length: n }, (_, i) => bar(`b${i}`, ['dive'])),
      ).confidence;
    expect(c(0)).toBe(0);
    expect(c(10)).toBeCloseTo(0.5, 10);
    expect(c(30)).toBeCloseTo(0.75, 10);
  });

  it('does not truncate evidence to the Settings top-five display cap', () => {
    const tags: VibeTag[] = ['dive', 'club', 'rooftop', 'cocktail', 'chill', 'cheap', 'dance'];
    const t = deriveLearnedTaste([rated('a', 9)], [bar('a', tags)]);
    expect(t.affinity.size).toBe(tags.length);
  });
});

describe('learnedTasteScore', () => {
  it('averages A(tag) rather than summing, so tag count is not a rank bonus', () => {
    const taste = deriveLearnedTaste([rated('seed', 10)], [bar('seed', ['dive'])]);
    const focused = learnedTasteScore(bar('x', ['dive']), taste);
    const diluted = learnedTasteScore(bar('y', ['dive', 'club', 'rooftop']), taste);
    expect(focused).toBeGreaterThan(diluted);
  });

  it('is 0 for an untagged bar and for empty taste', () => {
    expect(learnedTasteScore(bar('x', []), EMPTY_TASTE)).toBe(0);
    expect(learnedTasteScore(bar('x', ['dive']), EMPTY_TASTE)).toBe(0);
  });
});
