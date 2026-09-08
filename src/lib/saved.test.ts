import { beforeEach, describe, expect, it } from 'vitest';
import { loadSaved } from '@/lib/saved';

const KEY = 'next-bar:saved:v1';

/**
 * `next-bar:saved:v1` is the frozen V7 saved-bar store. No V8 surface mounts
 * it, but docs/V8-DATA-CONTINUITY-2026-08-14.md requires its read path to
 * survive until a deliberate migration into the named-list owner. This test is
 * that requirement, not a file-existence check: it seeds a real V7 record,
 * reads it back through the shipped reader, and asserts the reader neither
 * loses the record nor rewrites the bytes a V7 device already holds.
 */
describe('legacy saved-bar continuity', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reads a V7 saved record without rewriting the stored bytes', () => {
    // Verbatim shape a V7 install carries — see e2e/v7-continuity.spec.ts.
    const raw = JSON.stringify([
      { barId: 'attaboy', savedAt: '2026-08-12T20:30:00-04:00' },
    ]);
    window.localStorage.setItem(KEY, raw);

    expect(loadSaved()).toEqual([
      { barId: 'attaboy', savedAt: '2026-08-12T20:30:00-04:00' },
    ]);
    expect(window.localStorage.getItem(KEY)).toBe(raw);
  });

  it('leaves an unreadable legacy value in place instead of clearing it', () => {
    // A shape the reader rejects must still be preserved for a later
    // migration — dropping to [] must never become a silent delete.
    const raw = '{"barId":"attaboy"}';
    window.localStorage.setItem(KEY, raw);

    expect(loadSaved()).toEqual([]);
    expect(window.localStorage.getItem(KEY)).toBe(raw);
  });
});
