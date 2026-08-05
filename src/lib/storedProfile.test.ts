import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearProfile,
  loadProfile,
  parseVibeProfile,
  readProfileOwner,
  saveProfile,
  writeProfile,
  writeProfileOwner,
  PROFILE_MERGED_KEY,
  type StoredProfile,
} from './storedProfile';

/**
 * storedProfile had no direct unit test before G1. It now carries the shared
 * validator that BOTH the localStorage read and the Supabase row go through,
 * so a hole here is a hole in the server path too.
 */

const VALID: StoredProfile = {
  tags: ['dive', 'locals'],
  preferredNeighborhoods: ['East Village'],
  archetype: 'Dive devotee',
  savedAt: '2026-07-20T00:00:00.000Z',
};

beforeEach(() => window.localStorage.clear());

describe('parseVibeProfile', () => {
  it('accepts a complete profile', () => {
    expect(parseVibeProfile(VALID)).toEqual(VALID);
  });

  it('rejects non-objects', () => {
    expect(parseVibeProfile(null)).toBeNull();
    expect(parseVibeProfile('a string')).toBeNull();
    expect(parseVibeProfile(42)).toBeNull();
    expect(parseVibeProfile(undefined)).toBeNull();
  });

  it.each([
    ['tags missing', { ...VALID, tags: undefined }],
    ['tags not an array', { ...VALID, tags: 'dive' }],
    ['tags containing a non-string', { ...VALID, tags: ['dive', 7] }],
    ['neighborhoods not an array', { ...VALID, preferredNeighborhoods: 'East Village' }],
    ['archetype missing', { ...VALID, archetype: undefined }],
    ['archetype not a string', { ...VALID, archetype: 12 }],
    ['savedAt missing', { ...VALID, savedAt: undefined }],
    ['savedAt not a string', { ...VALID, savedAt: 1234 }],
  ])('rejects %s', (_label, input) => {
    expect(parseVibeProfile(input)).toBeNull();
  });

  it('rejects an unparseable savedAt', () => {
    // savedAt is the conflict-resolution key. A NaN date would make every
    // strictly-newer comparison in vibeProfileSync false in BOTH directions,
    // silently resolving every conflict to "tie" and never syncing.
    expect(parseVibeProfile({ ...VALID, savedAt: 'not a date' })).toBeNull();
  });

  it('drops unknown extra fields rather than passing them through', () => {
    const parsed = parseVibeProfile({ ...VALID, injected: 'nope' });
    expect(parsed).toEqual(VALID);
    expect(parsed).not.toHaveProperty('injected');
  });
});

describe('loadProfile', () => {
  it('returns null for absent and for malformed json', () => {
    expect(loadProfile()).toBeNull();
    window.localStorage.setItem('next-bar:profile:v1', '{not json');
    expect(loadProfile()).toBeNull();
  });

  it('round-trips a written profile', () => {
    writeProfile(VALID);
    expect(loadProfile()).toEqual(VALID);
  });

  it('rejects a stored profile that fails validation', () => {
    window.localStorage.setItem('next-bar:profile:v1', JSON.stringify({ tags: [] }));
    expect(loadProfile()).toBeNull();
  });
});

describe('saveProfile', () => {
  it('stamps savedAt and returns the stored shape', () => {
    const { tags, preferredNeighborhoods, archetype } = VALID;
    const stored = saveProfile({ tags, preferredNeighborhoods, archetype });
    expect(stored.savedAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(stored.savedAt))).toBe(false);
    // The RETURNED savedAt must be the one that landed in storage — the quiz
    // page pushes this exact object to the server, and a different timestamp
    // on each side would corrupt the conflict comparison.
    expect(loadProfile()?.savedAt).toBe(stored.savedAt);
  });

  it('writeProfile preserves savedAt verbatim, unlike saveProfile', () => {
    writeProfile(VALID);
    expect(loadProfile()?.savedAt).toBe(VALID.savedAt);
  });
});

describe('clearProfile', () => {
  it('removes the profile AND its ownership marker', () => {
    writeProfile(VALID);
    writeProfileOwner('user-a');
    clearProfile();
    expect(loadProfile()).toBeNull();
    // A marker left behind would name an account with no data here, and the
    // cross-account guard would then wipe ratings/pairwise for no reason.
    expect(readProfileOwner()).toBeNull();
    expect(window.localStorage.getItem(PROFILE_MERGED_KEY)).toBeNull();
  });
});
