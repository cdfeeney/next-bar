import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

/**
 * The audience step's THREE answers about the pinner's circle (round-6 panel,
 * Codex, MEDIUM).
 *
 * `useFollows` reports a failed circle read as `loading: false` with an empty
 * `mutuals` — indistinguishable, here, from a real empty circle. The dialog
 * took only those two values, so a failed `get_following` told the pinner they
 * have no mutual friends: a claim about their friends we have no evidence for,
 * and the same lie `CircleList` refuses to tell about the presence read one
 * component over (V8-R-OPS-005).
 *
 * `useModalDialog` is real here — the states are what is under test, not the
 * overlay contract it already owns.
 */

vi.mock('@/components/BarPicker', () => ({ default: () => null }));

import { PinAudienceDialog } from './PinDialogs';

const FRIEND = {
  id: 'u2',
  handle: 'mira',
  displayName: 'Mira',
  avatarUrl: null,
} as unknown as Parameters<typeof PinAudienceDialog>[0]['friends'][number];

function renderDialog(
  overrides: Partial<Parameters<typeof PinAudienceDialog>[0]> = {},
): void {
  render(
    <PinAudienceDialog
      friends={[]}
      friendsLoading={false}
      friendsFailed={false}
      initialSelection={[]}
      busy={false}
      onConfirm={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

describe('the audience step distinguishes an empty circle from an unread one', () => {
  test('a failed circle read says so and never claims the pinner has no friends', () => {
    renderDialog({ friendsFailed: true });

    expect(screen.getByTestId('pin-audience-error').textContent).toMatch(
      /couldn't load your friends/i,
    );
    expect(screen.queryByTestId('pin-audience-none')).toBeNull();
    expect(screen.queryByTestId('pin-audience-list')).toBeNull();
  });

  test('a genuinely empty circle still gets the empty state', () => {
    renderDialog();

    expect(screen.getByTestId('pin-audience-none').textContent).toMatch(
      /don't have any mutual friends/i,
    );
    expect(screen.queryByTestId('pin-audience-error')).toBeNull();
  });

  test('a read still in flight is neither empty nor failed', () => {
    renderDialog({ friendsLoading: true });

    expect(screen.queryByTestId('pin-audience-none')).toBeNull();
    expect(screen.queryByTestId('pin-audience-error')).toBeNull();
  });

  test('friends that did load are listed', () => {
    renderDialog({ friends: [FRIEND] });

    expect(screen.getByTestId('pin-audience-list')).toBeTruthy();
    expect(screen.queryByTestId('pin-audience-error')).toBeNull();
    expect(screen.queryByTestId('pin-audience-none')).toBeNull();
  });
});
