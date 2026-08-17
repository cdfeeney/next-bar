import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The plan page is the SECOND response surface, and 0059's guard only holds if
 * it sends the revision it RENDERED.
 *
 * This file exists because a round-1 reviewer proved its absence was load-
 * bearing: change `plan.callerRevision` to `0` in `respondAs`, or re-fetch it at
 * click time, and the entire static loop stayed green — tsc 0, vitest 1220/1220
 * — because nothing rendered this component under test. The replay window this
 * migration exists to close would have silently reopened on three buttons
 * (I'm in / Count me back in / Not tonight) with no regression signal.
 *
 * `PlanInvites.test.tsx` has the same assertion for the Social → Plans surface.
 * The acceptance criterion asks for one test per caller; this is the other one.
 *
 * Deliberately narrow: this is not a page test. It mocks everything the page
 * loads through and asserts one thing — the (status, revision) pair that reaches
 * respondNightOut is the pair the render was built from.
 */

const PLAN_ID = '123e4567-e89b-42d3-a456-426614174000';
const TOKEN = '223e4567-e89b-42d3-a456-426614174000';

type Call = { accept: boolean; status: unknown; revision: unknown };
const calls: Call[] = [];
let plan: Record<string, unknown>;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ status: 'signed-in', userId: 'u1' }) }));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }));
vi.mock('@/lib/catalog', () => ({ getBarById: () => null }));
vi.mock('@/lib/pendingInvite', () => ({
  consumePendingInvite: () => null,
  peekPendingInvite: () => null,
  storePendingInvite: vi.fn(),
}));
vi.mock('@/lib/nightOuts.server', () => ({
  resolveNightOutByToken: async () => PLAN_ID,
  getNightOut: async () => plan,
  getNightOutMembers: async () => [],
  getNightOutBoard: async () => [],
  isNightOutFullByToken: async () => false,
  // The whole point of the file: capture what the page actually sent.
  respondNightOut: async (
    _s: unknown,
    _id: string,
    accept: boolean,
    expectedStatus: unknown,
    expectedRevision: unknown,
  ) => {
    calls.push({ accept, status: expectedStatus, revision: expectedRevision });
    return true;
  },
  joinNightOutByToken: async () => PLAN_ID,
  declineNightOutByToken: async () => PLAN_ID,
  cancelNightOut: async () => true,
  decideNightOut: async () => true,
  suggestNightOutBar: async () => true,
  voteNightOutBar: async () => true,
  previewNightOut: async () => null,
}));

import NightOutPage from './page';

function makePlan(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PLAN_ID,
    night: '2026-08-20',
    title: 'Replay probe',
    status: 'open',
    decidedBarId: null,
    ownerHandle: 'dev',
    ownerDisplayName: 'Dev',
    shareToken: null,
    callerRole: 'member',
    callerStatus: 'pending',
    callerRevision: 7,
    ...over,
  };
}

beforeEach(() => {
  calls.length = 0;
  plan = makePlan();
});

describe('plan page — the response carries the rendered revision (0059)', () => {
  test('"I\'m in" sends the rendered status AND revision, not defaults', async () => {
    const user = userEvent.setup();
    render(<NightOutPage params={{ token: TOKEN }} />);
    await user.click(await screen.findByRole('button', { name: /I'm in/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    // 7, not 0: a fabricated default or a click-time re-fetch fails here.
    expect(calls[0]).toEqual({ accept: true, status: 'pending', revision: 7 });
  });

  test('"Not tonight" sends the same rendered pair with accept=false', async () => {
    const user = userEvent.setup();
    render(<NightOutPage params={{ token: TOKEN }} />);
    await user.click(await screen.findByRole('button', { name: /Not tonight/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ accept: false, status: 'pending', revision: 7 });
  });

  test('"Count me back in" carries the DECLINED pair the card was drawn from', async () => {
    // The rejoin path is the one that matters most for replay: the row has
    // already moved once, so the revision is non-zero and a stale request is
    // exactly what the guard has to reject.
    plan = makePlan({ callerStatus: 'declined', callerRevision: 3 });
    const user = userEvent.setup();
    render(<NightOutPage params={{ token: TOKEN }} />);
    await user.click(await screen.findByRole('button', { name: /Count me back in/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ accept: true, status: 'declined', revision: 3 });
  });

  test('a null revision refuses rather than substituting one', async () => {
    // getNightOut returns a plan only when the caller has a membership row, so
    // this is unreachable in practice. It is asserted anyway because the
    // tempting repair — `?? 0` — would send a version the user never saw, which
    // is the fabricated-default pattern this whole change exists to reject.
    plan = makePlan({ callerRevision: null });
    const user = userEvent.setup();
    render(<NightOutPage params={{ token: TOKEN }} />);
    await user.click(await screen.findByRole('button', { name: /I'm in/i }));
    await waitFor(() => expect(screen.getByText(/didn't go through/i)).toBeTruthy());
    expect(calls, 'a null revision was substituted instead of refused').toHaveLength(0);
  });
});
