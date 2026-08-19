import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Cold whole-artifact panel, HIGH: this gate could fire on the invite landing
 * page and replace the route with /onboarding — AFTER that page had already
 * reached a terminal state and spent the pending-invite token. Nothing then
 * brought the user back to the plan.
 *
 * A brand-new account is the COMMON case for an invite link, so that is the
 * feature's primary flow breaking, and acceptance criterion 7 ("invite context
 * survives the sign-in handoff") was not satisfied for it — even though an
 * earlier panel cleared the criterion by tracing the returning-user path.
 *
 * The rule pinned here: the gate never redirects away from the invite landing.
 * It still redirects everywhere else, so onboarding is deferred, not lost.
 */

let pathname = '/rankings';
const replaced: string[] = [];
let handle: string | null = null;

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: (href: string) => replaced.push(href) }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({}),
}));

vi.mock('@/lib/profile.server', () => ({
  fetchOwnProfile: async () => ({ handle }),
}));

vi.mock('@/lib/accountCache', () => ({
  getCacheEpoch: () => 1,
}));

import OnboardingGate from './OnboardingGate';

beforeEach(() => {
  replaced.length = 0;
  handle = null; // a brand-new account: signed in, no handle yet
  window.sessionStorage.clear();
});

describe('OnboardingGate — never interrupt the invite handoff', () => {
  test('redirects a handle-less account to onboarding on an ordinary route', async () => {
    pathname = '/rankings';
    render(<OnboardingGate />);
    await waitFor(() => expect(replaced).toEqual(['/onboarding']));
  });

  test('does NOT redirect away from the invite landing page', async () => {
    pathname = '/night-out/2f1c9e2a-0000-4000-8000-000000000000';
    render(<OnboardingGate />);
    // Give the profile fetch every chance to resolve and fire.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(replaced, 'the gate yanked a new account out of its invite link').toEqual([]);
  });

  test('still leaves the session unflagged there, so onboarding happens later', async () => {
    pathname = '/night-out/2f1c9e2a-0000-4000-8000-000000000000';
    render(<OnboardingGate />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(replaced).toEqual([]);

    // Next navigation off the invite flow: the nudge is still owed.
    pathname = '/rankings';
    render(<OnboardingGate />);
    await waitFor(() => expect(replaced).toEqual(['/onboarding']));
  });
});
