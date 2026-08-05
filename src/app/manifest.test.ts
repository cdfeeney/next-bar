import { describe, it, expect } from 'vitest';
import manifest from './manifest';

/**
 * Declaration-level pins for goal g-fb7b9f28. The behavioral proof that
 * each src really serves its declared dimensions lives in
 * e2e/manifest-icons.spec.ts (decoded-PNG assertions); this layer pins the
 * declarations themselves so a drive-by edit cannot reintroduce the
 * one-src-many-sizes shape that shipped a 512 image under a 192 entry.
 */
describe('manifest icon declarations', () => {
  const icons = manifest().icons ?? [];

  it('declares both PWA sizes plus the apple touch icon', () => {
    expect(icons.map((i) => i.sizes).sort()).toEqual([
      '180x180',
      '192x192',
      '512x512',
    ]);
  });

  it('every /icon src names the exact size it declares (no shared src)', () => {
    const pwaIcons = icons.filter((i) => i.src?.startsWith('/icon/'));
    expect(pwaIcons).toHaveLength(2);
    for (const icon of pwaIcons) {
      const match = /^(\d+)x\1$/.exec(icon.sizes ?? '');
      expect(match, `sizes "${icon.sizes}" must be a square WxW`).not.toBeNull();
      expect(icon.src).toBe(`/icon/${match![1]}`);
      expect(icon.type).toBe('image/png');
    }
    // The regression this goal fixes: two size declarations sharing one
    // src can only ever serve one real dimension.
    const srcs = icons.map((i) => i.src);
    expect(new Set(srcs).size).toBe(srcs.length);
  });
});
