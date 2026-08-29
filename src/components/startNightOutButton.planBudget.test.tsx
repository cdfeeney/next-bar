import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * THE PLANNING-EDIT BUDGET, AND WHAT IT IS ALLOWED TO CLAIM.
 *
 * Its own file because it needs `@/lib/nightOutPlan` mocked to hang, and
 * `StartNightOutButton.readFailure.test.tsx` deliberately leaves those wrappers
 * REAL so that a value reaching `apply` is refused and named. The two setups
 * cannot share a module registry.
 *
 * Round-10 round 5, BOTH lanes: the timeout rendered "we couldn't save the
 * planning details" for writes that were dispatched before the abort and could
 * still commit. The plan may well carry the time the owner typed while the
 * screen says it does not. A timeout is uncertainty, not a refusal, and the two
 * now have separate sentences.
 */

const pushed: string[] = [];
const PLAN_ID = '99999999-9999-4999-8999-999999999999';
const USER = '11111111-1111-4111-8111-111111111111';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: USER } }),
}));
vi.mock('@/lib/nightKey', () => ({ nycNightKey: () => '2026-08-17' }));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }));
vi.mock('@/app/friends/_components/usePinnedHandles', () => ({
  useMyPresence: () => null,
}));
vi.mock('@/lib/nightOuts.server', () => ({
  createNightOut: async () => PLAN_ID,
  getNightOut: async () => ({ id: PLAN_ID, shareToken: 'tok-1', status: 'open' }),
  inviteToNightOut: async () => true,
}));
// The write that never answers. This is the whole point of the file.
vi.mock('@/lib/nightOutPlan', () => ({
  setNightOutStart: () => new Promise<boolean>(() => undefined),
  setNightOutArea: () => new Promise<boolean>(() => undefined),
  setNightOutVotingDeadline: () => new Promise<boolean>(() => undefined),
}));

import StartNightOutButton from './StartNightOutButton';

beforeEach(() => {
  pushed.length = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a planning edit that never answers', () => {
  test('is reported as UNCERTAIN, not as a confirmed failure, and the plan is one tap away', async () => {
    render(<StartNightOutButton />);
    fireEvent.change(screen.getByLabelText(/^Area/), {
      target: { value: 'East Village' },
    });
    screen.getByRole('button', { name: /Start the official Night Out/i }).click();

    // Past the 10s budget.
    await vi.advanceTimersByTimeAsync(11_000);

    const notice = await screen.findByTestId('plan-edits-uncertain');
    expect(notice.textContent).toMatch(/took too long to answer/i);
    // The claim it must NOT make: the write may still have landed.
    expect(notice.textContent).not.toMatch(/couldn.t save/i);
    expect(screen.queryByTestId('plan-fields-refused')).toBeNull();

    // It holds the screen, like every other "something did not land" state...
    expect(pushed).toEqual([]);
    // ...and still offers the real plan.
    screen.getByRole('button', { name: /open it/i }).click();
    await waitFor(() => expect(pushed).toEqual(['/night-out/tok-1']));
  });
});
