import { render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Who wins when more than one thing wants to choose the route (round-6 panel,
 * Codex).
 *
 * This component is mounted in the root layout and fires on the FIRST signed-in
 * render anywhere, which makes it the last word on where an authenticated user
 * lands. Two flows legitimately disagree with it: a confirmation callback that
 * already carried a plan, and password recovery, which has to reach the page
 * that sets the password.
 */

const TOKEN_A = '11111111-1111-4111-8111-111111111111';
const TOKEN_B = '22222222-2222-4222-8222-222222222222';

let pending: string | null = null;
let pathname = '/';
const replace = vi.fn();
const consumePendingInvite = vi.fn(() => {
  pending = null;
  return null;
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => pathname,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'u1' } }),
}));

vi.mock('@/lib/pendingInvite', () => ({
  peekPendingInvite: () => pending,
  consumePendingInvite: () => consumePendingInvite(),
}));

import PendingInviteRedirect from './PendingInviteRedirect';

function setSearch(search: string): void {
  window.history.replaceState({}, '', `/x${search}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  pending = null;
  pathname = '/';
  setSearch('');
});

describe('the pending invite is not the last word on every route', () => {
  test('a plan already on screen beats a newer pending invite, and spends it', () => {
    // Start signup from invite A, open invite B in another tab, then confirm A:
    // A's own callback lands the new account on A, and this component used to
    // replace it with B.
    pending = TOKEN_B;
    pathname = `/night-out/${TOKEN_A}`;
    render(<PendingInviteRedirect />);

    expect(replace, "a newer stored invite overrode the plan the callback carried").not.toHaveBeenCalled();
    expect(
      consumePendingInvite,
      'the superseded token was left live to fire a surprise redirect later',
    ).toHaveBeenCalled();
  });

  test('password recovery reaches Settings without being pulled to the plan', () => {
    pending = TOKEN_A;
    pathname = '/settings';
    setSearch('?from=recovery');
    render(<PendingInviteRedirect />);

    expect(
      replace,
      'recovery was redirected to the plan, so the password could never be set',
    ).not.toHaveBeenCalled();
    expect(
      consumePendingInvite,
      'recovery spent the invite instead of leaving it to complete afterwards',
    ).not.toHaveBeenCalled();
  });

  test('an ordinary sign-in landing on Settings still completes the handoff', () => {
    // The mechanism itself must survive both exceptions above.
    pending = TOKEN_A;
    pathname = '/settings';
    render(<PendingInviteRedirect />);

    expect(replace).toHaveBeenCalledWith(`/night-out/${TOKEN_A}`);
  });

  test('the pending plan itself is left to consume its own token', () => {
    pending = TOKEN_A;
    pathname = `/night-out/${TOKEN_A}`;
    render(<PendingInviteRedirect />);

    expect(replace).not.toHaveBeenCalled();
    expect(
      consumePendingInvite,
      'the destination page performs the single consume, not this component',
    ).not.toHaveBeenCalled();
  });
});
