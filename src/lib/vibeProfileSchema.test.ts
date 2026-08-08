import { describe, expect, it } from 'vitest';
import {
  NEIGHBORHOODS,
  VIBE_TAGS,
  parseWaitlistVibeProfile,
} from '@/lib/vibeProfileSchema';

// Local alias keeps the assertions readable; the export is deliberately NOT
// called `parseVibeProfile` because `@/lib/storedProfile` already owns that
// name with much laxer rules.
const parseVibeProfile = parseWaitlistVibeProfile;

const valid = {
  tags: ['dive', 'cheap'],
  archetype: 'Dive Regular',
  preferredNeighborhoods: ['Bushwick'],
};

describe('parseVibeProfile', () => {
  it('accepts a well-formed profile', () => {
    expect(parseVibeProfile(valid)).toEqual(valid);
  });

  it('REBUILDS the value instead of passing the caller object through', () => {
    // This is the property that makes the schema a boundary rather than a
    // check: nothing the caller sent can survive by reference.
    const input = { ...valid };
    const parsed = parseVibeProfile(input);
    expect(parsed).not.toBe(input);
    expect(parsed?.tags).not.toBe(input.tags);
  });

  it('rejects unknown keys even when the payload is small', () => {
    expect(parseVibeProfile({ ...valid, injected: 'x' })).toBeNull();
  });

  it('tolerates and STRIPS savedAt — the app\'s own StoredProfile shape', () => {
    // Regression guard for a silent-data-loss trap: StoredProfile is
    // `VibeProfile & { savedAt }`, and it is what loadProfile() returns. If
    // this rejected, wiring the quiz result into the signup form would drop
    // every quiz-taker's profile to null with no error anywhere.
    const parsed = parseVibeProfile({ ...valid, savedAt: '2026-08-08T00:00:00Z' });
    expect(parsed).toEqual(valid);
    expect(parsed).not.toHaveProperty('savedAt');
  });

  it('rejects a deeply nested payload hidden under a known key', () => {
    expect(
      parseVibeProfile({ ...valid, archetype: { deep: { deeper: 1 } } }),
    ).toBeNull();
  });

  it('rejects tags outside the allowlist', () => {
    expect(parseVibeProfile({ ...valid, tags: ['dive', 'nope'] })).toBeNull();
  });

  it('rejects neighborhoods outside the allowlist', () => {
    expect(
      parseVibeProfile({ ...valid, preferredNeighborhoods: ['Atlantis'] }),
    ).toBeNull();
  });

  it('rejects type confusion on every field', () => {
    expect(parseVibeProfile({ ...valid, tags: 'dive' })).toBeNull();
    expect(parseVibeProfile({ ...valid, archetype: 42 })).toBeNull();
    expect(parseVibeProfile({ ...valid, preferredNeighborhoods: {} })).toBeNull();
    expect(parseVibeProfile({ ...valid, tags: [1, 2] })).toBeNull();
  });

  it('rejects non-objects, arrays, and nullish input', () => {
    expect(parseVibeProfile(null)).toBeNull();
    expect(parseVibeProfile(undefined)).toBeNull();
    expect(parseVibeProfile('a-string')).toBeNull();
    expect(parseVibeProfile(7)).toBeNull();
    expect(parseVibeProfile([valid])).toBeNull();
  });

  it('rejects a missing required field', () => {
    expect(parseVibeProfile({ tags: [], archetype: 'x' })).toBeNull();
  });

  it('rejects an empty or oversize archetype', () => {
    expect(parseVibeProfile({ ...valid, archetype: '   ' })).toBeNull();
    expect(parseVibeProfile({ ...valid, archetype: 'x'.repeat(81) })).toBeNull();
  });

  it('trims the archetype it stores', () => {
    expect(parseVibeProfile({ ...valid, archetype: '  Dive Regular  ' })).toEqual(
      valid,
    );
  });

  it('bounds array length so the column cannot be used as a dump', () => {
    const tooMany = Array.from({ length: VIBE_TAGS.length + 1 }, () => 'dive');
    expect(parseVibeProfile({ ...valid, tags: tooMany })).toBeNull();
  });

  it('accepts empty arrays — a user with no picks is not an error', () => {
    expect(
      parseVibeProfile({ tags: [], archetype: 'Undecided', preferredNeighborhoods: [] }),
    ).toEqual({ tags: [], archetype: 'Undecided', preferredNeighborhoods: [] });
  });

  it('does not treat inherited/prototype keys as members of the allowlist', () => {
    // `'toString' in {}` is true; a naive membership test using `in` would
    // accept it as a valid tag.
    expect(parseVibeProfile({ ...valid, tags: ['toString'] })).toBeNull();
    expect(
      parseVibeProfile({ ...valid, preferredNeighborhoods: ['constructor'] }),
    ).toBeNull();
  });

  it('exposes non-empty allowlists derived from the type unions', () => {
    expect(VIBE_TAGS.length).toBeGreaterThan(30);
    expect(NEIGHBORHOODS.length).toBeGreaterThan(30);
    expect(VIBE_TAGS).toContain('dive');
    expect(NEIGHBORHOODS).toContain("Hell's Kitchen");
  });
});
