import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  displayTag,
  MAX_VENUE_TAGS,
  PRICE_TAG_GLYPHS,
  TAG_DISPLAY,
  TAG_PRIORITY,
  topVenueTags,
} from '@/lib/tagDisplay';
import { TAG_VOCABULARY } from '@/lib/catalog';
import type { VibeTag } from '@/types';

describe('tagDisplay', () => {
  it('covers every tag in the vocabulary with a non-empty display string', () => {
    for (const tag of TAG_VOCABULARY) {
      expect(TAG_DISPLAY[tag], tag).toBeTruthy();
      expect(displayTag(tag)).toBe(TAG_DISPLAY[tag]);
    }
  });

  it('renders price tags as the glyph ladder — the WORD pricey never displays', () => {
    expect(displayTag('cheap')).toBe('$');
    expect(displayTag('mid')).toBe('$$');
    expect(displayTag('pricey')).toBe('$$$');
    expect(displayTag('splurge')).toBe('$$$$');
    // No display string may leak a raw price-tag word (locked decision 2).
    for (const word of Object.keys(PRICE_TAG_GLYPHS)) {
      for (const label of Object.values(TAG_DISPLAY)) {
        expect(label.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('display strings are chip-sized (≤14 chars) and human-cased', () => {
    for (const tag of TAG_VOCABULARY) {
      const label = TAG_DISPLAY[tag];
      expect(label.length, `${tag} → ${label}`).toBeLessThanOrEqual(14);
      // No raw kebab-case enums as labels.
      expect(label).not.toMatch(/^[a-z0-9]+(-[a-z0-9]+)+$/);
    }
  });
});

describe('topVenueTags — deterministic five-tag priority (V8-5)', () => {
  // Seeded so a failure is reproducible; Math.random() would make the
  // counterexample vanish on the next run.
  function shuffle(tags: readonly VibeTag[], seed: number): VibeTag[] {
    const out = [...tags];
    let state = seed;
    for (let i = out.length - 1; i > 0; i -= 1) {
      state = (state * 1103515245 + 12345) % 2147483648;
      const j = state % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  const SEVEN_TAGS: VibeTag[] = [
    'speakeasy',
    'cocktail',
    'jazz',
    'date',
    'pricey',
    'lounge',
    'romantic',
  ];

  it('ranks every tag in the vocabulary exactly once', () => {
    expect(Object.keys(TAG_PRIORITY).sort()).toEqual([...TAG_VOCABULARY].sort());
    expect(new Set(Object.values(TAG_PRIORITY)).size).toBe(TAG_VOCABULARY.length);
  });

  it('renders at most five tags per venue', () => {
    expect(topVenueTags(SEVEN_TAGS).length).toBeLessThanOrEqual(MAX_VENUE_TAGS);
    expect(topVenueTags([...TAG_VOCABULARY])).toHaveLength(MAX_VENUE_TAGS);
  });

  it('caps at five even when a caller tries to ask for more', () => {
    // The cap is the rule, not a per-call-site option: topVenueTags takes no
    // limit argument, so an extra argument cannot widen it (Codex review).
    const askForMore = topVenueTags as (
      tags: readonly VibeTag[],
      limit?: number,
    ) => VibeTag[];
    expect(askForMore([...TAG_VOCABULARY], 6)).toHaveLength(MAX_VENUE_TAGS);
    expect(askForMore([...TAG_VOCABULARY], -1)).toHaveLength(MAX_VENUE_TAGS);
    expect(topVenueTags.length, 'topVenueTags grew a second parameter').toBe(1);
  });

  it('is invariant under input order — the same set always yields the same five', () => {
    const expected = topVenueTags(SEVEN_TAGS);
    for (let seed = 1; seed <= 50; seed += 1) {
      expect(topVenueTags(shuffle(SEVEN_TAGS, seed)), `seed ${seed}`).toEqual(expected);
    }
    // Reversal is the permutation a naive "take the first five" would fail on.
    expect(topVenueTags([...SEVEN_TAGS].reverse())).toEqual(expected);
    // …and it holds for the whole vocabulary, not just one venue's set.
    const all = topVenueTags([...TAG_VOCABULARY]);
    for (let seed = 1; seed <= 50; seed += 1) {
      expect(topVenueTags(shuffle(TAG_VOCABULARY, seed)), `seed ${seed}`).toEqual(all);
    }
  });

  it('leads with the PRD-named venue types when a venue carries them', () => {
    expect(topVenueTags(SEVEN_TAGS)).toEqual([
      'cocktail',
      'lounge',
      'speakeasy',
      'jazz',
      'romantic',
    ]);
  });

  it('drops price tags — the lightbox already shows priceTier', () => {
    for (const price of Object.keys(PRICE_TAG_GLYPHS) as VibeTag[]) {
      expect(topVenueTags([price, 'cocktail'])).toEqual(['cocktail']);
    }
    // A venue whose only tags are price tags shows no chips rather than "$$".
    expect(topVenueTags(Object.keys(PRICE_TAG_GLYPHS) as VibeTag[])).toEqual([]);
  });

  it('collapses duplicates and ignores tags outside the vocabulary', () => {
    expect(topVenueTags(['pub', 'pub', 'pub'])).toEqual(['pub']);
    // The catalog is server-backed, so an unknown tag is reachable at runtime.
    expect(topVenueTags(['pub', 'karaoke' as VibeTag])).toEqual(['pub']);
  });

  it('drops inherited Object keys instead of ranking them (DeepSeek review)', () => {
    // `in` would report these as ranked tags via the prototype chain; an
    // unranked tag reaching the comparator yields NaN and an engine-defined
    // order, which would break the determinism criterion.
    for (const inherited of ['toString', 'constructor', 'hasOwnProperty', 'valueOf']) {
      expect(topVenueTags(['pub', inherited as VibeTag]), inherited).toEqual(['pub']);
    }
  });

  it('renders through displayTag, so no chip can leak a raw enum', () => {
    expect(topVenueTags(SEVEN_TAGS).map(displayTag)).toEqual([
      'Cocktails',
      'Lounge',
      'Speakeasy',
      'Jazz',
      'Romantic',
    ]);
  });
});

describe('raw-tag render enforcement (E0.1 acceptance 3)', () => {
  // Trip-wire source grep: a JSX child rendering a bare tag variable
  // ({tag} / {t.tag} on its own line, or inline >{tag}<) means a
  // component bypassed displayTag(). key={tag} and other attribute
  // usage is fine and does not match.
  const RENDER_PATTERNS = [
    /^\s*\{tag\}$/m,
    /^\s*\{t\.tag\}$/m,
    />\{tag\}</,
    />\{t\.tag\}</,
  ];

  function tsxFilesUnder(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) out.push(...tsxFilesUnder(p));
      else if (p.endsWith('.tsx')) out.push(p);
    }
    return out;
  }

  it('no component renders a raw tag variable as JSX text', () => {
    const roots = [
      path.join(__dirname, '..', 'components'),
      path.join(__dirname, '..', 'app'),
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of tsxFilesUnder(root)) {
        const src = readFileSync(file, 'utf8');
        if (RENDER_PATTERNS.some((re) => re.test(src))) {
          offenders.push(path.relative(path.join(__dirname, '..'), file));
        }
      }
    }
    expect(offenders, 'render tags via displayTag() from @/lib/tagDisplay').toEqual([]);
  });
});
