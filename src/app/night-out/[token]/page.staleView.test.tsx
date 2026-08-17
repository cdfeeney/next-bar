import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Criterion 2: "no authenticated response can populate member state after
 * sign-out" — and its sibling, no response for plan A may populate the view of
 * plan B.
 *
 * Both panels filed the absence of this file, not a defect in the guard: the
 * epoch guard is four lines of subtle code protecting PRIVATE member data, and
 * it was verified only by prose. A guard nothing exercises is a guard nobody
 * knows is still connected — the next refactor of `loadMemberView` silently
 * removes it and every other test stays green.
 *
 * The mocks are deliberately DEFERRED (`Deferred` below) rather than resolved.
 * The whole defect lives in the window between issuing an authenticated read
 * and painting its answer, so a test that cannot hold a response open cannot
 * express it — which is how this stayed untested through three rounds.
 */

class Deferred<T> {
  readonly promise: Promise<T>;
  private settle!: (value: T) => void;
  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.settle = resolve;
    });
  }
  resolve(value: T): void {
    this.settle(value);
  }
}

const OWNER_PRIVATE_NAME = 'Private Member Name';

type Auth = { status: 'loading' | 'signed-in' | 'signed-out'; user?: { id: string } };
let auth: Auth = { status: 'signed-in', user: { id: 'u1' } };

const resolveByToken = vi.fn();
const getNightOut = vi.fn();
const getNightOutMembers = vi.fn();
const getNightOutBoard = vi.fn();
const previewNightOut = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => auth,
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({}),
}));

vi.mock('@/lib/catalog', () => ({
  getBarById: () => null,
}));

vi.mock('@/lib/pendingInvite', () => ({
  consumePendingInvite: vi.fn(),
  peekPendingInvite: () => null,
  storePendingInvite: vi.fn(),
}));

vi.mock('@/lib/nightOuts.server', () => ({
  resolveNightOutByToken: (...a: unknown[]) => resolveByToken(...a),
  getNightOut: (...a: unknown[]) => getNightOut(...a),
  getNightOutMembers: (...a: unknown[]) => getNightOutMembers(...a),
  getNightOutBoard: (...a: unknown[]) => getNightOutBoard(...a),
  previewNightOut: (...a: unknown[]) => previewNightOut(...a),
  cancelNightOut: vi.fn(),
  decideNightOut: vi.fn(),
  declineNightOutByToken: vi.fn(),
  isNightOutFullByToken: vi.fn(),
  joinNightOutByToken: vi.fn(),
  respondNightOut: vi.fn(),
  suggestNightOutBar: vi.fn(),
  voteNightOutBar: vi.fn(),
}));

import NightOutPage from './page';

const TOKEN_A = '11111111-1111-4111-8111-111111111111';
const TOKEN_B = '22222222-2222-4222-8222-222222222222';

function planFor(title: string) {
  return {
    id: `plan-${title}`,
    night: '2026-08-20',
    title,
    status: 'open' as const,
    decidedBarId: null,
    ownerHandle: 'host',
    ownerDisplayName: 'Host',
    shareToken: TOKEN_A,
    callerRole: 'member' as const,
    callerStatus: 'accepted' as const,
  };
}

const PRIVATE_MEMBERS = [
  {
    userId: 'u9',
    handle: 'private',
    displayName: OWNER_PRIVATE_NAME,
    role: 'member' as const,
    inviteStatus: 'accepted' as const,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  auth = { status: 'signed-in', user: { id: 'u1' } };
});

describe('the plan page never paints an answer the view has moved on from', () => {
  test('an authenticated load settling AFTER sign-out shows no private member data', async () => {
    const heldPlan = new Deferred<ReturnType<typeof planFor>>();
    const heldMembers = new Deferred<typeof PRIVATE_MEMBERS>();
    const heldBoard = new Deferred<never[]>();

    resolveByToken.mockResolvedValue('plan-A');
    getNightOut.mockReturnValue(heldPlan.promise);
    getNightOutMembers.mockReturnValue(heldMembers.promise);
    getNightOutBoard.mockReturnValue(heldBoard.promise);
    previewNightOut.mockResolvedValue({
      night: '2026-08-20',
      title: 'A night out',
      ownerHandle: 'host',
      ownerDisplayName: 'Host',
      acceptedCount: 2,
    });

    const view = render(<NightOutPage params={{ token: TOKEN_A }} />);
    await waitFor(() => expect(getNightOut).toHaveBeenCalled());

    // The user signs out while the authenticated read is still in flight.
    auth = { status: 'signed-out' };
    view.rerender(<NightOutPage params={{ token: TOKEN_A }} />);

    // ...and only now does the authenticated answer arrive.
    heldPlan.resolve(planFor('A night out'));
    heldMembers.resolve(PRIVATE_MEMBERS);
    heldBoard.resolve([]);

    // The signed-out view settles into the bearer preview.
    await waitFor(() => expect(screen.getByText("You're invited")).toBeTruthy());

    expect(
      screen.queryByText(OWNER_PRIVATE_NAME),
      'a stale authenticated load put private member data in front of a signed-out viewer',
    ).toBeNull();
    expect(
      screen.queryByText(/Who's in/),
      'the member board rendered for a signed-out viewer',
    ).toBeNull();
  });

  test('a load for plan A cannot paint under plan B when the token changes', async () => {
    const heldPlanA = new Deferred<ReturnType<typeof planFor>>();
    const heldMembersA = new Deferred<typeof PRIVATE_MEMBERS>();
    const heldBoardA = new Deferred<never[]>();

    resolveByToken.mockResolvedValue('plan-A');
    getNightOut.mockReturnValueOnce(heldPlanA.promise);
    getNightOutMembers.mockReturnValueOnce(heldMembersA.promise);
    getNightOutBoard.mockReturnValueOnce(heldBoardA.promise);

    const view = render(<NightOutPage params={{ token: TOKEN_A }} />);
    await waitFor(() => expect(getNightOut).toHaveBeenCalled());

    // Client-side navigation to a DIFFERENT plan. Next reuses this component —
    // no remount, no sign-out, so nothing about auth changes.
    resolveByToken.mockResolvedValue('plan-B');
    getNightOut.mockResolvedValue(planFor("B's night out"));
    getNightOutMembers.mockResolvedValue([]);
    getNightOutBoard.mockResolvedValue([]);
    auth = { status: 'signed-in', user: { id: 'u1' } };
    view.rerender(<NightOutPage params={{ token: TOKEN_B }} />);

    await waitFor(() => expect(screen.getByText("B's night out")).toBeTruthy());

    // Plan A's answer arrives late, addressed to a screen that has moved on.
    heldPlanA.resolve(planFor("A's night out"));
    heldMembersA.resolve(PRIVATE_MEMBERS);
    heldBoardA.resolve([]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      screen.queryByText("A's night out"),
      "plan A's member state painted under plan B's URL",
    ).toBeNull();
    expect(
      screen.queryByText(OWNER_PRIVATE_NAME),
      "plan A's member list leaked into plan B's view",
    ).toBeNull();
    expect(screen.getByText("B's night out")).toBeTruthy();
  });
});
