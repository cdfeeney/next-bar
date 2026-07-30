import { describe, expect, it } from 'vitest';
import { deriveArchetype } from '@/lib/quiz';
import type { VibeTag } from '@/types';

/**
 * S2 — coverage for every branch of deriveArchetype.
 *
 * There was no branch coverage at all before this: the only assertion on any
 * archetype string lived in tasteProfile.test.ts, which exercised exactly one
 * of the twelve branches. A copy rewrite with eleven untested branches is how
 * you silently reorder or drop one, so the table below pins all of them.
 *
 * Each row is (label, minimal tag set). The tag sets are deliberately MINIMAL —
 * only the tags that branch's predicate reads — so a test failure points at one
 * predicate rather than at an overlap between several.
 */

type Case = { label: string; tags: VibeTag[] };

const BRANCHES: Case[] = [
  { label: 'Dive regular', tags: ['dive', 'locals'] },
  { label: 'Cocktail lover', tags: ['cocktail', 'polished'] },
  { label: 'Hidden-door romantic', tags: ['speakeasy', 'romantic'] },
  { label: 'Here for the dancing', tags: ['dance', 'house'] },
  { label: 'Slow night, live jazz', tags: ['jazz', 'lounge'] },
  { label: 'Cheap and cheerful', tags: ['rough', 'cheap'] },
  { label: 'Always somewhere new', tags: ['trendy', 'instagrammable'] },
  { label: 'Cocktails after hours', tags: ['industry', 'cocktail'] },
  { label: 'Up where the view is', tags: ['rooftop'] },
  { label: 'Garden seat, no rush', tags: ['garden', 'chill'] },
  { label: 'Wine and low light', tags: ['wine', 'romantic'] },
];

describe('deriveArchetype — every branch', () => {
  it.each(BRANCHES)('returns "$label" for $tags', ({ label, tags }) => {
    expect(deriveArchetype(tags)).toBe(label);
  });

  it('falls back for an empty tag set', () => {
    // WhereNextFlow and useSuggestions both call deriveArchetype([]) directly,
    // so the fallback is a real code path, not just a default.
    expect(deriveArchetype([])).toBe('Still exploring NYC');
  });

  it('falls back for tags that match no branch', () => {
    expect(deriveArchetype(['loud'])).toBe('Still exploring NYC');
  });

  it('covers all 12 distinct labels — no branch shares a string', () => {
    // A copy rewrite that accidentally gave two branches the same label would
    // make one of them unreachable in practice without failing any test above.
    const labels = new Set([
      ...BRANCHES.map((b) => b.label),
      deriveArchetype([]),
    ]);
    expect(labels.size).toBe(12);
  });
});

describe('deriveArchetype — branch ORDER is preserved', () => {
  /**
   * The ordering is load-bearing and easy to break in a rewrite. These pin the
   * cases where a tag set satisfies TWO predicates: the earlier branch must win.
   */
  it('cocktail+polished beats industry+cocktail', () => {
    expect(deriveArchetype(['cocktail', 'polished', 'industry'])).toBe(
      'Cocktail lover',
    );
  });

  it('speakeasy+romantic beats wine+romantic', () => {
    expect(deriveArchetype(['speakeasy', 'romantic', 'wine'])).toBe(
      'Hidden-door romantic',
    );
  });

  it('dive+locals beats rough+cheap', () => {
    expect(deriveArchetype(['dive', 'locals', 'rough', 'cheap'])).toBe(
      'Dive regular',
    );
  });

  it('an earlier two-tag branch beats the single-tag rooftop branch', () => {
    // rooftop is checked AFTER the paired branches, so a rooftop cocktail bar
    // reads as the cocktail branch. Pinning this stops a future "move the
    // cheap single-tag check first" refactor from silently reclassifying users.
    expect(deriveArchetype(['cocktail', 'polished', 'rooftop'])).toBe(
      'Cocktail lover',
    );
  });

  it('rooftop still wins when no earlier branch matches', () => {
    expect(deriveArchetype(['rooftop', 'loud'])).toBe('Up where the view is');
  });
});

describe('deriveArchetype — labels stay short enough for mobile', () => {
  it('no label exceeds the previous longest (24 chars)', () => {
    // "Jazz lounge sophisticate" was 24 and fitted the existing surfaces, so it
    // is the ceiling: anything at or under it cannot newly wrap.
    const all = [...BRANCHES.map((b) => b.label), deriveArchetype([])];
    for (const label of all) {
      expect(label.length).toBeLessThanOrEqual(24);
    }
  });

  it('no label uses in-crowd framing the operator flagged', () => {
    // "Industry-crowd insider" was the specific complaint; "connoisseur" and
    // "sophisticate" carried the same implication that the reader is either in
    // the club or outside it. "bartender" is here because the first rewrite
    // said "Knows the bartender", which a reviewer correctly read as the same
    // privileged-access framing wearing friendlier words.
    const all = [...BRANCHES.map((b) => b.label), deriveArchetype([])];
    for (const label of all) {
      expect(label).not.toMatch(/insider|connoisseur|sophisticate|bartender/i);
    }
  });

  it('no label asserts a drink its predicate never tests', () => {
    // A reviewer caught "Backyard and a beer" on the garden+chill branch: it
    // invents a beer preference, and for a user whose tags include `wine` the
    // label flatly contradicts their own profile. A label may only name a drink
    // when that drink is in the branch's predicate.
    const DRINKS = /beer|wine|cocktail|whisk|tequila|mezcal/i;
    for (const { label, tags } of BRANCHES) {
      const named = label.match(DRINKS)?.[0]?.toLowerCase();
      if (!named) continue;
      // e.g. "cocktail" in the label requires the `cocktail` tag in the branch.
      expect(tags.some((t) => t.toLowerCase().startsWith(named))).toBe(true);
    }
  });
});
