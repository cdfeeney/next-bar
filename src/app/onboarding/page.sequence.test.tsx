import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * V8-R-ONB-001/003/004/005 — the sequence has to be REACHABLE.
 *
 * The defect this pins: all four onboarding screens existed and only one of
 * them could be opened. `/onboarding` went straight to the return destination
 * on submit and on skip, and nothing anywhere in `src/` linked to
 * `/onboarding/age`, so the age, location and quiz steps were dead routes that
 * only a typed URL could reach. Three owned requirements were unimplemented in
 * the only sense that matters to a user.
 *
 * `/onboarding` is visited TWICE — once as the door in, once as the last step —
 * so the two cases below are the whole contract: no marker means enter the
 * sequence, the marker means render the identity form. Getting that backwards
 * is an infinite redirect loop on the app's signup path, which is why it is
 * asserted rather than reasoned about.
 */

const replaced: string[] = [];
let handle: string | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: (href: string) => replaced.push(href),
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    status: 'signed-in' as const,
    user: { id: 'me' },
    signOut: async () => {},
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({}),
}));

vi.mock('@/lib/accountCache', () => ({ getCacheEpoch: () => 1 }));

vi.mock('@/hooks/useHandleAvailability', () => ({
  useHandleAvailability: () => 'idle',
}));

vi.mock('@/lib/profile.server', () => ({
  fetchOwnProfile: async () => ({ handle, displayName: null, isPrivate: false }),
  claimHandle: vi.fn(),
  setOwnDisplayName: vi.fn(),
  DISPLAY_NAME_MAX: 40,
  isValidDisplayName: () => true,
  isValidHandle: () => true,
}));

import OnboardingPage from './page';

beforeEach(() => {
  replaced.length = 0;
  handle = null;
  window.history.replaceState({}, '', '/onboarding');
});

describe('the onboarding sequence is reachable', () => {
  test('an account with no handle is sent into the age step first', async () => {
    render(<OnboardingPage />);

    await waitFor(() =>
      expect(replaced).toEqual([`/onboarding/age?next=${encodeURIComponent('/')}`]),
    );
  });

  test('it carries the interrupted route through as the destination', async () => {
    // OnboardingGate records what it interrupted; an invite-link signup has to
    // come back to THAT plan, so the sequence must not drop it on the way in.
    window.history.replaceState(
      {},
      '',
      `/onboarding?next=${encodeURIComponent('/plan/abc')}`,
    );
    render(<OnboardingPage />);

    await waitFor(() =>
      expect(replaced).toEqual([
        `/onboarding/age?next=${encodeURIComponent('/plan/abc')}`,
      ]),
    );
  });

  test('an unsafe ?next= degrades to the home rather than riding through', async () => {
    window.history.replaceState(
      {},
      '',
      `/onboarding?next=${encodeURIComponent('https://evil.example/x')}`,
    );
    render(<OnboardingPage />);

    await waitFor(() =>
      expect(replaced).toEqual([`/onboarding/age?next=${encodeURIComponent('/')}`]),
    );
  });

  test('the marked return visit renders the form instead of looping', async () => {
    // This is the loop guard. The quiz step ends on this URL; if the marker
    // were ignored, `/onboarding` would send it straight back to the age step
    // and the signup path would never terminate.
    window.history.replaceState(
      {},
      '',
      `/onboarding?next=${encodeURIComponent('/')}&seq=done`,
    );
    const { findByText } = render(<OnboardingPage />);

    await findByText(/Pick how friends see you/i);
    expect(replaced).toEqual([]);
  });

  test('an account that already has a handle still bounces to its destination', async () => {
    // The sequence must not capture someone who is already onboarded.
    handle = 'connor_f';
    window.history.replaceState(
      {},
      '',
      `/onboarding?next=${encodeURIComponent('/plan/abc')}`,
    );
    render(<OnboardingPage />);

    await waitFor(() => expect(replaced).toEqual(['/plan/abc']));
  });
});
