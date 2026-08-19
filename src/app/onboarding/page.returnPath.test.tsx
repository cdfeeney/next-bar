import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The RETURN half of criterion 1, filed by both lanes in round 2.
 *
 * Round 2 pinned that OnboardingGate EMITS `?next=`, and nothing at all pinned
 * that this page READS it. Reverting `returnDestination()` to a hardcoded `'/'`
 * — which is exactly the round-1 failure this whole line of work exists to
 * close — left the entire suite green while a brand-new account arriving on an
 * invite link silently stopped landing on its plan.
 *
 * So these tests assert the destination, through the component, on all three
 * paths that end onboarding: submit, skip, and the already-onboarded bounce.
 */

const PLAN_PATH = '/night-out/2f1c9e2a-0000-4000-8000-000000000000';

const replaced: string[] = [];
const assigned: string[] = [];
let search = '';
let profileHandle: string | null = null;
let claimResult: string | null = 'chosen';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (href: string) => replaced.push(href) }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'u1' } }),
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({}),
}));

vi.mock('@/lib/accountCache', () => ({
  getCacheEpoch: () => 1,
}));

vi.mock('@/hooks/useHandleAvailability', () => ({
  useHandleAvailability: () => 'available',
}));

vi.mock('@/lib/profile.server', () => ({
  fetchOwnProfile: async () => ({ handle: profileHandle, displayName: null }),
  claimHandle: async () => claimResult,
  setOwnDisplayName: async () => true,
  isValidDisplayName: (v: string) => v.length <= 40,
  isValidHandle: (v: string) => /^[a-z0-9_]{3,20}$/i.test(v),
  DISPLAY_NAME_MAX: 40,
}));

vi.mock('@/components/OnboardingGate', async () => {
  // The real isSafeReturnPath is the security boundary under test here — mock
  // only the flag writer, never the validator.
  const actual = await vi.importActual<typeof import('@/components/OnboardingGate')>(
    '@/components/OnboardingGate',
  );
  return { ...actual, setPromptedFlag: vi.fn(), default: () => null };
});

import OnboardingPage from './page';

beforeEach(() => {
  replaced.length = 0;
  assigned.length = 0;
  profileHandle = null;
  claimResult = 'chosen';
  search = `?next=${encodeURIComponent(PLAN_PATH)}`;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      get search() {
        return search;
      },
      origin: 'https://app.example',
      assign: (href: string) => assigned.push(href),
    },
  });
});

describe('onboarding returns the user to where the gate interrupted them', () => {
  test('completing onboarding lands on the plan, not on /', async () => {
    const user = userEvent.setup();
    render(<OnboardingPage />);

    await screen.findByPlaceholderText('username');
    await user.type(screen.getByPlaceholderText('Your name'), 'Ada');
    await user.type(screen.getByPlaceholderText('username'), 'ada');
    await user.click(screen.getByRole('button', { name: /let's go/i }));

    await waitFor(() =>
      expect(
        assigned,
        'criterion 1: a brand-new account must land on THAT plan after onboarding',
      ).toEqual([PLAN_PATH]),
    );
  });

  test('"Skip for now" also returns to the plan', async () => {
    const user = userEvent.setup();
    render(<OnboardingPage />);
    await screen.findByPlaceholderText('username');

    await user.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(replaced).toEqual([PLAN_PATH]);
  });

  test('an already-onboarded visitor is bounced to the carried route', async () => {
    profileHandle = 'taken';
    render(<OnboardingPage />);
    await waitFor(() => expect(replaced).toEqual([PLAN_PATH]));
  });

  test('with no ?next= the destination is home', async () => {
    search = '';
    const user = userEvent.setup();
    render(<OnboardingPage />);
    await screen.findByPlaceholderText('username');

    await user.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(replaced).toEqual(['/']);
  });

  test('a hostile ?next= is refused and falls back to home', async () => {
    // The control-character bypass round 2 filed as HIGH: URLSearchParams
    // decodes %09 to a tab, and the WHATWG parser strips it before resolving,
    // turning this into //evil.example.
    search = '?next=%2F%09%2Fevil.example';
    const user = userEvent.setup();
    render(<OnboardingPage />);
    await screen.findByPlaceholderText('username');

    await user.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(
      replaced,
      'onboarding navigated to an off-origin destination from the URL bar',
    ).toEqual(['/']);
  });
});
