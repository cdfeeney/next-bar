import { describe, expect, it } from 'vitest';
import { quiz } from '@/lib/quiz';
import { bars, applyPlaces } from '@/lib/bars';

/**
 * Tag-audit F1 regression guard (2026-07-25): a quiz option must never
 * emit a tag that zero OPEN bars carry — an emittable dead tag silently
 * dilutes every profile's Jaccard scores (the 'hiphop' lesson). If this
 * fails after a catalog change, either re-tag bars or retire the option.
 */
describe('quiz tag coverage', () => {
  it('every quiz-emittable tag matches at least one open bar', () => {
    const open = applyPlaces(bars).filter(
      (b) => b.businessStatus !== 'CLOSED_PERMANENTLY',
    );
    const coverage = new Map<string, number>();
    for (const bar of open) {
      for (const tag of bar.tags) {
        coverage.set(tag, (coverage.get(tag) ?? 0) + 1);
      }
    }
    const deadEmittable: string[] = [];
    for (const q of quiz) {
      if (q.kind !== 'single') continue;
      for (const opt of q.options) {
        for (const tag of opt.tags) {
          if (!coverage.get(tag)) deadEmittable.push(`${tag} (via "${opt.label}")`);
        }
      }
    }
    expect(deadEmittable).toEqual([]);
  });

  it('the audit gap tags are now expressible: date, beer, pub, wine, live, post-work, romantic', () => {
    const emittable = new Set(
      quiz.flatMap((q) => (q.kind === 'single' ? q.options.flatMap((o) => o.tags) : [])),
    );
    for (const tag of ['date', 'beer', 'pub', 'wine', 'live', 'post-work', 'romantic']) {
      expect(emittable.has(tag as never), `${tag} should be quiz-expressible`).toBe(true);
    }
    // The dead tag stays un-emittable until bars actually carry it.
    expect(emittable.has('hiphop' as never)).toBe(false);
  });
});
