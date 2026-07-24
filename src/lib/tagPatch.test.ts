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
