import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

/**
 * The Custom picker's THREE answers about the pinner's circle (round-6 panel,
 * Codex, MEDIUM).
 *
 * `useFollows` reports a failed circle read as `loading: false` with an empty
 * `mutuals` — indistinguishable, here, from a real empty circle. The picker
 * took only those two values, so a failed `get_following` told the pinner they
 * have no mutual friends: a claim about their friends we have no evidence for,
 * and the same lie `CircleList` refuses to tell about the presence read one
 * component over (V8-R-OPS-005).
 *
 * S-05b: the picker is the inline `FriendPicker` on the Pin your spot screen;
 * the states under test are unchanged.
 */

import { FriendPicker } from './PinDialogs';

const FRIEND = {
  id: 'u2',
  handle: 'mira',
  displayName: 'Mira',
  avatarUrl: null,
} as unknown as Parameters<typeof FriendPicker>[0]['friends'][number];

function renderPicker(
  overrides: Partial<Parameters<typeof FriendPicker>[0]> = {},
): void {
  render(
    <FriendPicker
      friends={[]}
      friendsLoading={false}
      friendsFailed={false}
      selected={[]}
      busy={false}
      onToggle={vi.fn()}
      {...overrides}
    />,
  );
}

describe('the Custom picker distinguishes an empty circle from an unread one', () => {
  test('a failed circle read says so and never claims the pinner has no friends', () => {
    renderPicker({ friendsFailed: true });

    expect(screen.getByTestId('pin-audience-error').textContent).toMatch(
      /couldn't load your friends/i,
    );
    expect(screen.queryByTestId('pin-audience-none')).toBeNull();
    expect(screen.queryByTestId('pin-audience-list')).toBeNull();
  });

  test('a genuinely empty circle still gets the empty state', () => {
    renderPicker();

    expect(screen.getByTestId('pin-audience-none').textContent).toMatch(
      /don't have any mutual friends/i,
    );
    expect(screen.queryByTestId('pin-audience-error')).toBeNull();
  });

  test('a read still in flight is neither empty nor failed', () => {
    renderPicker({ friendsLoading: true });

    expect(screen.queryByTestId('pin-audience-none')).toBeNull();
    expect(screen.queryByTestId('pin-audience-error')).toBeNull();
  });

  test('friends that did load are listed, and a pick is reported, not kept', () => {
    const onToggle = vi.fn();
    renderPicker({ friends: [FRIEND], onToggle });

    expect(screen.getByTestId('pin-audience-list')).toBeTruthy();
    expect(screen.queryByTestId('pin-audience-error')).toBeNull();
    expect(screen.queryByTestId('pin-audience-none')).toBeNull();
    screen.getByRole('checkbox').click();
    expect(onToggle).toHaveBeenCalledWith('u2');
  });
});
