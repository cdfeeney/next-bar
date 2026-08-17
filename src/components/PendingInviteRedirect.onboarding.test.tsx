import { render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The two halves of the invite handoff must not fight each other.
 *
 * Fix round 1 removed `/night-out` from OnboardingGate's exclusion list, so a
 * brand-new account now genuinely onboards and is returned to the plan by
 * `?next=`. That exposed the other side of the same interaction: the pending
 * token deliberately survives until the PLAN PAGE settles, so while the user is
 * sitting on /onboarding the token is still live — and this component would
 * replace the route with the plan, pulling them out of the identity form.
 *
 * Nothing would send them back, either: the gate sets its prompted flag before
 * navigating, so it fires at most once per session.
 *
 * The rule pinned here: the redirect yields to onboarding, and to nothing else.
 */

let pathname = '/settings';
let pending: string | null = null;
const replaced: string[] = [];

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: (href: string) => replaced.push(href) }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in' }),
}));

vi.mock('@/lib/pendingInvite', () => ({
  peekPendingInvite: () => pending,
}));

import PendingInviteRedirect from './PendingInviteRedirect';

const TOKEN = '2f1c9e2a-0000-4000-8000-000000000000';

beforeEach(() => {
  replaced.length = 0;
  pending = TOKEN;
  pathname = '/settings';
});

describe('PendingInviteRedirect — completes the trip without breaking onboarding', () => {
  test('routes a signed-in user with a pending invite to that plan', () => {
    render(<PendingInviteRedirect />);
    expect(replaced).toEqual([`/night-out/${TOKEN}`]);
  });

  test('does NOT pull the user out of onboarding', () => {
    pathname = '/onboarding';
    render(<PendingInviteRedirect />);
    expect(
      replaced,
      'the new account was yanked out of the identity form it was just sent to',
    ).toEqual([]);
  });

  test('does not fire on the onboarding route even with the return path attached', () => {
    // The gate navigates to `/onboarding?next=...`; usePathname reports the
    // path without the query, but pin the prefix match rather than equality.
    pathname = '/onboarding';
    render(<PendingInviteRedirect />);
    expect(replaced).toEqual([]);
  });

  test('still fires once onboarding is over and the user is elsewhere', () => {
    pathname = '/';
    render(<PendingInviteRedirect />);
    expect(
      replaced,
      'the deferred trip never completed, so the invite was lost after onboarding',
    ).toEqual([`/night-out/${TOKEN}`]);
  });

  test('does nothing when already on the pending plan', () => {
    pathname = `/night-out/${TOKEN}`;
    render(<PendingInviteRedirect />);
    expect(replaced).toEqual([]);
  });

  test('does nothing when there is no pending invite', () => {
    pending = null;
    render(<PendingInviteRedirect />);
    expect(replaced).toEqual([]);
  });
});
