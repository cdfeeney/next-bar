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
const FRIEND = '22222222-2222-4222-8222-222222222222';

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
/** When true, the invite phase alone outlasts the planning-edit budget. */
let slowInvite = false;
vi.mock('@/lib/nightOuts.server', () => ({
  createNightOut: async () => PLAN_ID,
  getNightOut: async () => ({ id: PLAN_ID, shareToken: 'tok-1', status: 'open' }),
  inviteToNightOut: async () => {
    if (slowInvite) {
      await new Promise((resolve) => {
        setTimeout(resolve, 15_000);
      });
    }
    return true;
  },
}));
/** When true the plan RPCs never answer. Reset per test. */
let planRpcsHang = true;
// PARTIAL, so the real `remainingLabel` survives — see the note on the same
// mock in nightOutPlanFields.test.tsx.
vi.mock('@/lib/nightOutPlan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/nightOutPlan')>()),
  setNightOutStart: () =>
    planRpcsHang ? new Promise<boolean>(() => undefined) : Promise.resolve(true),
  setNightOutArea: () =>
    planRpcsHang ? new Promise<boolean>(() => undefined) : Promise.resolve(true),
  setNightOutVotingDeadline: () =>
    planRpcsHang ? new Promise<boolean>(() => undefined) : Promise.resolve(true),
}));

import StartNightOutButton from './StartNightOutButton';

beforeEach(() => {
  pushed.length = 0;
  planRpcsHang = true;
  slowInvite = false;
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

  /**
   * Round-10 round 6, BOTH lanes. `withBudget` raced but never cancelled the
   * loser, and `editsTimedOut` is not read until after the sequential invite
   * loop and the follow-up read. So edits that answered in a second were
   * reported as having taken too long the moment the INVITES pushed the total
   * past ten — the uncertainty sentence about work that was already done, and
   * navigation withheld on a create where everything landed.
   */
  test('a slow invite phase does not retroactively time out edits that already answered', async () => {
    planRpcsHang = false;
    slowInvite = true;

    render(<StartNightOutButton inviteeIds={[FRIEND]} />);
    fireEvent.change(screen.getByLabelText(/^Area/), {
      target: { value: 'East Village' },
    });
    screen.getByRole('button', { name: /Start the official Night Out/i }).click();

    // The edits answer immediately; the invite takes 15s all by itself.
    await vi.advanceTimersByTimeAsync(20_000);

    await waitFor(() => expect(pushed).toEqual(['/night-out/tok-1']));
    expect(
      screen.queryByTestId('plan-edits-uncertain'),
      'a completed edit was reported as having timed out because the invites were slow',
    ).toBeNull();
    expect(screen.queryByTestId('plan-fields-refused')).toBeNull();
  });
});
