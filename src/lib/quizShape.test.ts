import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { quiz, type SinglePickQuestion } from '@/lib/quiz';

/**
 * Quiz answer-shape pins (goal g-65a31bdf, criteria 12–17, 19).
 *
 * The operator's rule: answers are pointed and as mutually exclusive as
 * practical; preference axes (energy, setting, music, crowd, company,
 * spending) must NEVER force a choice — each carries a neutral/null
 * answer; Music must offer both "No music" and quiet/background; neutral
 * answers must not emit contradictory tags; option counts stay variable;
 * marketing copy states the real question count.
 */

const single = (prompt: RegExp): SinglePickQuestion => {
  const q = quiz.find(
    (x): x is SinglePickQuestion => x.kind === 'single' && prompt.test(x.prompt),
  );
  if (!q) throw new Error(`no single-pick question matching ${prompt}`);
  return q;
};

const NEVER_FORCED = [
  /energy/i, // crowd energy
  /where do you wanna be/i, // setting
  /soundtrack/i, // music
  /who do you wanna be around/i, // crowd
  /who are you out with/i, // company
  /spending/i, // spending
];

describe('quiz shape (g-65a31bdf)', () => {
  it('every preference axis carries a pure neutral option (empty tags — no forced pick)', () => {
    for (const prompt of NEVER_FORCED) {
      const q = single(prompt);
      const neutrals = q.options.filter((o) => o.tags.length === 0);
      expect(neutrals.length, `${q.prompt} has no neutral option`).toBeGreaterThan(0);
    }
  });

  it('Music offers both "No music" and quiet/background music', () => {
    const music = single(/soundtrack/i);
    const labels = music.options.map((o) => o.label.toLowerCase());
    expect(labels.some((l) => l.includes('no music'))).toBe(true);
    expect(labels.some((l) => l.includes('quiet') || l.includes('background'))).toBe(
      true,
    );
  });

  it('quiet/background music emits only non-contradictory calm-venue tags', () => {
    const music = single(/soundtrack/i);
    const quiet = music.options.find(
      (o) => /quiet|background/i.test(o.label) && !/no music/i.test(o.label),
    );
    expect(quiet).toBeDefined();
    // Calm-venue tags only — never loud/dance/club/live which would
    // contradict the stated preference (criterion 17).
    for (const tag of quiet!.tags) {
      expect(['chill', 'lounge', 'wine', 'cocktail']).toContain(tag);
    }
  });

  it('neutral options never contradict: empty tags emit no signal at all', () => {
    for (const q of quiz) {
      if (q.kind !== 'single') continue;
      for (const o of q.options) {
        if (/no preference|depends|whatever|surprise me|either way/i.test(o.label)) {
          expect(o.tags, `"${o.label}" should be a pure null answer`).toEqual([]);
        }
      }
    }
  });

  it('option counts stay variable across questions', () => {
    const counts = quiz
      .filter((q): q is SinglePickQuestion => q.kind === 'single')
      .map((q) => q.options.length);
    expect(new Set(counts).size).toBeGreaterThan(1);
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(2);
  });

  it('marketing copy states the real question count (criterion 19)', () => {
    expect(quiz.length).toBe(8);
    const read = (p: string): string =>
      readFileSync(join(process.cwd(), 'src', 'components', p), 'utf8');
    const hero = read('Hero.tsx');
    const how = read('HowItWorks.tsx');
    for (const src of [hero, how]) {
      expect(src).not.toMatch(/six questions/i);
      expect(src).toMatch(/eight questions/i);
    }
  });
});
