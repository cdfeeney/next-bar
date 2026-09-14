import { describe, expect, test } from 'vitest';
import { filterFriends, isAudienceHeld } from './PinDialogs';

/**
 * S-05 (Social redesign, README §5): the two rules the mutuals picker and the
 * pin confirmation share, tested once at the pure boundary.
 */
const friends = [
  { id: '1', handle: 'sam_j', displayName: 'Sam J.' },
  { id: '2', handle: 'claire', displayName: 'Claire R.' },
  { id: '3', handle: 'dev_p', displayName: null },
];

describe('filterFriends', () => {
  test('an empty or blank query is the whole list', () => {
    expect(filterFriends(friends, '')).toEqual(friends);
    expect(filterFriends(friends, '   ')).toEqual(friends);
  });

  test('matches display name or @handle, case-insensitively, ignoring a leading @', () => {
    expect(filterFriends(friends, 'SAM').map((f) => f.id)).toEqual(['1']);
    expect(filterFriends(friends, '@cla').map((f) => f.id)).toEqual(['2']);
    expect(filterFriends(friends, 'dev').map((f) => f.id)).toEqual(['3']);
    expect(filterFriends(friends, 'r.').map((f) => f.id)).toEqual(['2']);
  });

  test('no match is an empty list, never a throw on a null display name', () => {
    expect(filterFriends(friends, 'zzz')).toEqual([]);
  });
});

describe('isAudienceHeld', () => {
  test('Only some people with nobody picked holds the confirm; anything else does not', () => {
    expect(isAudienceHeld('people', 0)).toBe(true);
    expect(isAudienceHeld('people', 1)).toBe(false);
    expect(isAudienceHeld('friends', 0)).toBe(false);
    expect(isAudienceHeld('close', 0)).toBe(false);
  });
});
