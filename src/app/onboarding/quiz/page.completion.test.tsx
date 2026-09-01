import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * V8-R-ONB-005, on the branch e2e cannot reach.
 *
 * Every browser spec in this repo runs SIGNED OUT — nothing establishes a real
 * Supabase session — so the signed-in completion path had no coverage at all,
 * which is why "the sequence does not land a new account on the approved home"
 * survived two review rounds as an argument rather than a measurement.
 *
 * Both destinations are asserted here through the component, on both of the
 * step's exits (Skip and a completed quiz).
 */

const pushed: string[] = [];
let authStatus: 'signed-in' | 'signed-out' = 'signed-out';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: authStatus, user: null, signOut: async () => {} }),
}));

vi.mock('@/lib/storedProfile', () => ({
  loadProfile: () => null,
  saveProfile: vi.fn(),
}));

// The real quiz is walked in e2e; here it only has to reach its callback.
vi.mock('@/components/VibeQuiz', () => ({
  default: ({ onComplete }: { onComplete: (p: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onComplete({ tags: [], archetype: 'explorer', preferredNeighborhoods: [] })
      }
    >
      finish the quiz
    </button>
  ),
}));

import OnboardingQuizPage from './page';

beforeEach(() => {
  pushed.length = 0;
  authStatus = 'signed-out';
  window.history.replaceState({}, '', '/onboarding/quiz');
});

describe('the end of the onboarding sequence', () => {
  test('a signed-out visitor lands straight on the approved home', async () => {
    render(<OnboardingQuizPage />);
    await userEvent.click(screen.getByRole('button', { name: /show me bars/i }));
    expect(pushed).toEqual(['/']);
  });

  test('a signed-in account is handed to the identity step NAMING the home as its destination', async () => {
    // The identity step is required of every account and is not part of this
    // canvas; what the requirement needs is that the sequence ends on `/`
    // rather than wherever that step happens to default to.
    //
    // `seq=done` is the marker that stops `/onboarding` sending this visit
    // back to the age step — the door and the last step are the same route.
    authStatus = 'signed-in';
    render(<OnboardingQuizPage />);
    await userEvent.click(screen.getByRole('button', { name: /show me bars/i }));
    expect(pushed).toEqual([
      `/onboarding?next=${encodeURIComponent('/')}&seq=done`,
    ]);
  });

  test('COMPLETING the quiz ends in the same place as skipping it', async () => {
    authStatus = 'signed-in';
    render(<OnboardingQuizPage />);
    await userEvent.click(screen.getByRole('button', { name: /^Start/ }));
    await userEvent.click(
      await screen.findByRole('button', { name: /finish the quiz/i }),
    );
    await waitFor(() =>
      expect(pushed).toEqual([
        `/onboarding?next=${encodeURIComponent('/')}&seq=done`,
      ]),
    );
  });

  /**
   * The destination an invite-link signup entered on has to survive all four
   * screens. OnboardingGate records it as `?next=`; if the sequence dropped it,
   * a brand-new account would land on the home instead of the plan it was
   * invited to — the regression this carry-through exists to prevent.
   */
  test('carries an invite destination through to the identity step', async () => {
    authStatus = 'signed-in';
    window.history.replaceState(
      {},
      '',
      `/onboarding/quiz?next=${encodeURIComponent('/plan/abc')}`,
    );
    render(<OnboardingQuizPage />);
    await userEvent.click(screen.getByRole('button', { name: /show me bars/i }));
    expect(pushed).toEqual([
      `/onboarding?next=${encodeURIComponent('/plan/abc')}&seq=done`,
    ]);
  });

  test('a signed-out visitor goes to that destination directly', async () => {
    window.history.replaceState(
      {},
      '',
      `/onboarding/quiz?next=${encodeURIComponent('/plan/abc')}`,
    );
    render(<OnboardingQuizPage />);
    await userEvent.click(screen.getByRole('button', { name: /show me bars/i }));
    expect(pushed).toEqual(['/plan/abc']);
  });

  test('starting the quiz moves focus off the button it unmounted', async () => {
    render(<OnboardingQuizPage />);
    await userEvent.click(screen.getByRole('button', { name: /^Start/ }));
    await waitFor(() =>
      expect(document.activeElement, 'focus fell through to <body>').not.toBe(
        document.body,
      ),
    );
  });
});
