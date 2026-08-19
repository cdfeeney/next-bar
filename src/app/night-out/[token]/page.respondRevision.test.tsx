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
 * ROUND 2 HARDENING — read this before simplifying the fixture.
 *
 * The first version of this file asserted `revision: 7` against a mock that
 * returned the SAME plan object at render time and at click time. Both review
 * lanes caught that it therefore proved less than its own comment claimed: it
 * caught a fabricated default (`0`, `?? 0`) but NOT a click-time re-fetch, which
 * would have forwarded the freshly fetched 7 and passed. A re-fetch is one of
 * the two regressions the round-1 finding named, and it is the more insidious
 * one — it looks careful.
 *
 * So the backend value now MOVES between render and click (`bumpBackendTo`).
 * The rendered value and the current value are deliberately different, which is
 * the only way an assertion can tell "what was rendered" from "what is true
 * now". Keep them different. A fixture where they agree cannot test this.
 *
 * `PlanInvites.test.tsx` carries the same discriminator for the Social → Plans
 * surface. The acceptance criterion asks for one test per caller.
 *
 * Deliberately narrow: this is not a page test. It mocks everything the page
 * loads through and asserts one thing — the (status, revision) pair that reaches
 * respondNightOut is the pair the render was built from.
 */

const PLAN_ID = '123e4567-e89b-42d3-a456-426614174000';
const TOKEN = '223e4567-e89b-42d3-a456-426614174000';

type Call = { accept: boolean; status: unknown; revision: unknown };
/**
 * Reads observed AT THE MOMENT the send happened.
 *
 * Counting reads after the fact does not work: both surfaces deliberately
 * re-read once a response succeeds, to re-sync the screen. That is correct and
 * must not be mistaken for the regression, which is a read BEFORE the send.
 * Snapshotting inside the mock is what separates the two.
 */
let readsAtSend = -1;
const calls: Call[] = [];
let plan: Record<string, unknown>;
/** How many times the page has read the plan. A click-time re-fetch shows up here. */
let getNightOutCalls = 0;
/** What respondNightOut answers. A pending promise keeps the call in flight. */
let respondResult: boolean | Promise<boolean> = true;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'u1' } }),
}));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }));
vi.mock('@/lib/catalog', () => ({ getBarById: () => null }));
vi.mock('@/lib/pendingInvite', () => ({
  consumePendingInvite: () => null,
  peekPendingInvite: () => null,
  storePendingInvite: vi.fn(),
}));
vi.mock('@/lib/nightOuts.server', () => ({
  resolveNightOutByToken: async () => PLAN_ID,
  getNightOut: async () => {
    getNightOutCalls += 1;
    return plan;
  },
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
    readsAtSend = getNightOutCalls;
    calls.push({ accept, status: expectedStatus, revision: expectedRevision });
    // A promise here is what lets the double-tap test hold the first call open.
    return respondResult;
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
  getNightOutCalls = 0;
  readsAtSend = -1;
  respondResult = true;
  plan = makePlan();
});

/**
 * Move the BACKEND on, after the screen has already been drawn.
 *
 * This is the discriminator the round-2 review asked for. Once the rendered
 * value and the current value differ, an assertion on the rendered one fails if
 * the component consults the backend at click time — which is the regression a
 * same-value fixture cannot see.
 */
async function bumpBackendTo(revision: number, status = 'accepted'): Promise<void> {
  const settled = getNightOutCalls;
  plan = makePlan({ callerStatus: status, callerRevision: revision });
  // Guard the guard: if the page were still loading, the new value could be the
  // one that gets rendered and the test would silently stop discriminating.
  expect(settled, 'the page had not finished loading before the backend moved')
    .toBeGreaterThan(0);
}

describe('plan page — the response carries the rendered revision (0059)', () => {
  test('"I\'m in" sends the rendered pair even after the backend moves on', async () => {
    const user = userEvent.setup();
    render(<NightOutPage params={{ token: TOKEN }} />);
    const button = await screen.findByRole('button', { name: /I'm in/i });
    const afterRender = getNightOutCalls;

    await bumpBackendTo(99);           // someone else responded; screen is now stale
    await user.click(button);
    await waitFor(() => expect(calls).toHaveLength(1));

    // 7 is what was RENDERED. 99 would mean a click-time re-fetch; 0 would mean
    // a fabricated default. Both are regressions and both fail here.
    expect(calls[0]).toEqual({ accept: true, status: 'pending', revision: 7 });
    expect(readsAtSend, 'the page re-read the plan BEFORE sending').toBe(afterRender);
  });

  test('"Not tonight" sends the same rendered pair with accept=false', async () => {
    const user = userEvent.setup();
    render(<NightOutPage params={{ token: TOKEN }} />);
    const button = await screen.findByRole('button', { name: /Not tonight/i });
    const afterRender = getNightOutCalls;

    await bumpBackendTo(42);
    await user.click(button);
    await waitFor(() => expect(calls).toHaveLength(1));

    expect(calls[0]).toEqual({ accept: false, status: 'pending', revision: 7 });
    expect(readsAtSend, 'the page re-read the plan BEFORE sending').toBe(afterRender);
  });

  test('"Count me back in" carries the DECLINED pair the card was drawn from', async () => {
    // The rejoin path matters most for replay: the row has already moved once,
    // so the revision is non-zero and a stale request is exactly what the guard
    // has to reject.
    plan = makePlan({ callerStatus: 'declined', callerRevision: 3 });
    const user = userEvent.setup();
    render(<NightOutPage params={{ token: TOKEN }} />);
    const button = await screen.findByRole('button', { name: /Count me back in/i });
    const afterRender = getNightOutCalls;

    await bumpBackendTo(11, 'declined');
    await user.click(button);
    await waitFor(() => expect(calls).toHaveLength(1));

    expect(calls[0]).toEqual({ accept: true, status: 'declined', revision: 3 });
    expect(readsAtSend, 'the page re-read the plan BEFORE sending').toBe(afterRender);
  });

  /**
   * The OTHER half of withRefresh, and the half no test reached: what the page
   * does when the guard says no.
   *
   * A round-3 reviewer showed both branches were free — drop the loadMemberView
   * call on the `!ok` path, or drop the actionInFlight ref, and the whole suite
   * stayed green. Both are the doomed-retry bug this change exists to fix: the
   * refusal is DETERMINISTIC, so a retry from an unrefreshed screen re-sends the
   * same stale pair and fails identically, forever.
   */
  test('a refusal re-reads the plan, so the retry is not doomed to repeat it', async () => {
    respondResult = false;
    const user = userEvent.setup();
    render(<NightOutPage params={{ token: TOKEN }} />);
    const button = await screen.findByRole('button', { name: /I'm in/i });

    // Someone else moved the row while this screen sat. The send below carries
    // the rendered pair, the guard refuses it, and the screen must re-sync.
    await bumpBackendTo(11);
    await user.click(button);
    await waitFor(() => expect(screen.getByText(/didn't go through/i)).toBeTruthy());

    expect(calls[0], 'the refused send did not carry the rendered pair')
      .toEqual({ accept: true, status: 'pending', revision: 7 });
    expect(getNightOutCalls, 'the page did not re-read after the refusal')
      .toBeGreaterThan(readsAtSend);
    // Re-synced to accepted/11, so the button that would re-send the stale
    // 'pending'/7 pair is gone. That is what makes the next tap survivable.
    expect(
      screen.queryByRole('button', { name: /I'm in/i }),
      'the stale accept button survived the re-sync',
    ).toBeNull();
  });

  test('a second tap while the first is still in flight is swallowed', async () => {
    let release!: (ok: boolean) => void;
    respondResult = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const user = userEvent.setup();
    render(<NightOutPage params={{ token: TOKEN }} />);
    const button = await screen.findByRole('button', { name: /I'm in/i });

    await user.click(button);
    await waitFor(() => expect(calls).toHaveLength(1));
    // Nothing disables the button, so this is a real second tap, not a
    // hypothetical one. Without the ref both taps fire and the second carries
    // the pair the first just invalidated.
    await user.click(button);
    expect(calls, 'the in-flight guard let a second request through').toHaveLength(1);

    release(true);
    await waitFor(() => expect(getNightOutCalls).toBeGreaterThan(readsAtSend));
    expect(calls, 'a tap leaked through after the first settled').toHaveLength(1);
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
