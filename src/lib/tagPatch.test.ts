import { describe, expect, it } from 'vitest';
import { applyTagChange } from '@/lib/tagPatch';

/**
 * B5c-3 apply-tool core: textual tag edits against the hand-authored
 * bars.*.ts source files. The transform must be surgical — one tags line
 * changes, every other byte survives — because it rewrites curated
 * catalog files in place.
 */

const SOURCE = `export const bars = [
  {
    id: 'ace-bar',
    name: 'Ace Bar',
    priceTier: 1,
    tags: ['dive', 'pub', 'cheap', 'locals', 'buzzy'],
    blurb: 'Pool tables, skee-ball, pinball, beer. No pretense.',
  },
  {
    id: 'space-bar',
    name: 'Space Bar',
    priceTier: 2,
    tags: ['dance', 'loud'],
    blurb: 'Lasers.',
  },
];
`;

describe('applyTagChange', () => {
  it('appends an added tag to the right bar, leaving everything else untouched', () => {
    const out = applyTagChange(SOURCE, 'ace-bar', 'add', 'beer');
    expect(out).toContain(
      "tags: ['dive', 'pub', 'cheap', 'locals', 'buzzy', 'beer'],",
    );
    // The other bar's tags line and the blurbs are byte-identical.
    expect(out).toContain("tags: ['dance', 'loud'],");
    expect(out).toContain("blurb: 'Pool tables, skee-ball, pinball, beer. No pretense.',");
    // Exactly one line differs.
    const diff = out
      .split('\n')
      .filter((line, i) => line !== SOURCE.split('\n')[i]);
    expect(diff).toHaveLength(1);
  });

  it('removes a tag from the right bar', () => {
    const out = applyTagChange(SOURCE, 'space-bar', 'remove', 'loud');
    expect(out).toContain("tags: ['dance'],");
    expect(out).toContain("tags: ['dive', 'pub', 'cheap', 'locals', 'buzzy'],");
  });

  it('matches bar ids exactly — a suffix id never edits its superstring cousin', () => {
    // 'space-bar' contains 'ace-bar' as a substring of its name but the
    // id match must be exact: editing ace-bar touches only ace-bar.
    const out = applyTagChange(SOURCE, 'ace-bar', 'add', 'indie');
    expect(out).toContain("tags: ['dance', 'loud'],");
  });

  it("an `id: 'x',` substring inside a blurb never matches (line-anchored needle)", () => {
    // DeepSeek review scenario: without anchoring, this blurb would be
    // the "match" for lost-bar and the transform would edit whatever
    // tags line follows it — a different bar's.
    const trap = SOURCE.replace(
      "blurb: 'Lasers.',",
      "blurb: \"mentions id: 'lost-bar', in passing\",",
    );
    expect(() => applyTagChange(trap, 'lost-bar', 'add', 'beer')).toThrow(
      /lost-bar/,
    );
    // And the real bars in the same source still resolve correctly.
    const out = applyTagChange(trap, 'space-bar', 'add', 'beer');
    expect(out).toContain("tags: ['dance', 'loud', 'beer'],");
  });

  it('throws on an unknown bar id', () => {
    expect(() => applyTagChange(SOURCE, 'nope', 'add', 'beer')).toThrow(/nope/);
  });

  it('throws when adding a tag the bar already has', () => {
    expect(() => applyTagChange(SOURCE, 'ace-bar', 'add', 'dive')).toThrow(
      /already/,
    );
  });

  it('throws when removing a tag the bar does not have', () => {
    expect(() => applyTagChange(SOURCE, 'ace-bar', 'remove', 'jazz')).toThrow(
      /not present/,
    );
  });

  it('round-trips: add then remove restores the original source', () => {
    const added = applyTagChange(SOURCE, 'ace-bar', 'add', 'beer');
    const restored = applyTagChange(added, 'ace-bar', 'remove', 'beer');
    expect(restored).toBe(SOURCE);
  });
});

// The bars.expansion*.ts files put each whole bar on ONE line — the
// format 24 of the 28 first-batch edits actually hit (Opus review: this
// path exercises the block-boundary logic hardest, so it gets its own
// fixture).
const SINGLE_LINE_SOURCE = `export const expansionBars = [
  { id: 'alpha-bar', name: 'Alpha Bar', priceTier: 1, tags: ['dive', 'cheap'], blurb: 'First.', lastVerified: '2026-04-01' },
  { id: 'beta-bar', name: 'Beta Bar', priceTier: 2, tags: ['cocktail'], blurb: 'Second.', lastVerified: '2026-04-01' },
];
`;

describe('applyTagChange — single-line entry format (bars.expansion*.ts)', () => {
  it('adds to the right bar without touching its same-line neighbours', () => {
    const out = applyTagChange(SINGLE_LINE_SOURCE, 'alpha-bar', 'add', 'locals');
    expect(out).toContain("tags: ['dive', 'cheap', 'locals'],");
    expect(out).toContain("tags: ['cocktail'],");
    expect(out).toContain("blurb: 'First.',");
  });

  it('removes without reaching into the next bar', () => {
    const out = applyTagChange(SINGLE_LINE_SOURCE, 'alpha-bar', 'remove', 'cheap');
    expect(out).toContain("tags: ['dive'],");
    expect(out).toContain("tags: ['cocktail'],");
  });

  it('edits the LAST entry (EOF block boundary)', () => {
    const out = applyTagChange(SINGLE_LINE_SOURCE, 'beta-bar', 'add', 'date');
    expect(out).toContain("tags: ['cocktail', 'date'],");
  });

  it('round-trips on the single-line format too', () => {
    const added = applyTagChange(SINGLE_LINE_SOURCE, 'beta-bar', 'add', 'wine');
    expect(applyTagChange(added, 'beta-bar', 'remove', 'wine')).toBe(
      SINGLE_LINE_SOURCE,
    );
  });

  it('throws when a bar id appears twice', () => {
    const dup = SINGLE_LINE_SOURCE.replace("id: 'beta-bar'", "id: 'alpha-bar'");
    expect(() => applyTagChange(dup, 'alpha-bar', 'add', 'wine')).toThrow(
      /more than once/,
    );
  });
});
