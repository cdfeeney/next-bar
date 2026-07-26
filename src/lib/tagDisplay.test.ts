import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { displayTag, PRICE_TAG_GLYPHS, TAG_DISPLAY } from '@/lib/tagDisplay';
import { TAG_VOCABULARY } from '@/lib/catalog';

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
