import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Cold whole-artifact panel (Codex + Claude, medium): a successful
 * create_night_out followed by a FAILED get_night_out was reported to the user
 * as "couldn't start it — try again", and the button was re-enabled. The plan
 * existed. The next tap created a SECOND plan for the same night, so invitees
 * sat on plan 1 while the owner shared plan 2, with nothing in the app able to
 * tell them apart or reach the first one.
 *
 * The rule this pins: a create that succeeded is never reported as a create
 * failure, and never re-armed for retry.
 *
 * Fix round 1 (Codex, medium) added the second half. The original fix kept the
 * plan id in component state ONLY, so the protection lasted exactly as long as
 * the component did — and a tab tap, a back gesture or any client-side
 * navigation unmounts it. The user came back to an armed button with no memory
 * of the plan, and the duplicate the fix existed to prevent happened one route
 * change later. These tests unmount, which is what the earlier ones never did.
 */

const pushed: string[] = [];
const PLAN_ID = '99999999-9999-4999-8999-999999999999';
let createResult: string | null = PLAN_ID;
let readFails = false;
let createCalls = 0;
/** When set, getNightOut hands back this promise instead of resolving. */
let heldRead: Promise<unknown> | null = null;
let nightKey = '2026-08-17';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
let currentUser = USER_A;

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: currentUser } }),
}));

vi.mock('@/lib/nightKey', () => ({
  nycNightKey: () => nightKey,
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({}),
}));

vi.mock('@/lib/nightOuts.server', () => ({
  createNightOut: async () => {
    createCalls += 1;
    return createResult;
  },
  getNightOut: async () => {
    if (heldRead !== null) return heldRead;
    return readFails ? null : { id: PLAN_ID, shareToken: 'tok-1', status: 'open' };
  },
}));

import StartNightOutButton from './StartNightOutButton';

beforeEach(() => {
  pushed.length = 0;
  createResult = PLAN_ID;
  readFails = false;
  createCalls = 0;
  heldRead = null;
  currentUser = USER_A;
  nightKey = '2026-08-17';
  window.sessionStorage.clear();
});

describe('StartNightOutButton — a created plan is never lost', () => {
  test('a failed follow-up read does NOT re-arm the button for a second create', async () => {
    readFails = true;
    const user = userEvent.setup();
    render(<StartNightOutButton />);
    const button = screen.getByRole('button');

    await user.click(button);
    await waitFor(() => expect(createCalls).toBe(1));

    // The plan exists, so the message must say so rather than blaming creation.
    expect(await screen.findByText(/created/i)).toBeTruthy();
    expect(screen.queryByText(/Couldn't start it/i)).toBeNull();

    // And the control must not invite a duplicate.
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button).catch(() => undefined);
    expect(createCalls, 'a second plan was created after a read failure').toBe(1);
    expect(pushed, 'navigated somewhere on a failed read').toEqual([]);
  });

  test('a genuine create failure still reports failure and allows a retry', async () => {
    createResult = null;
    const user = userEvent.setup();
    render(<StartNightOutButton />);
    const button = screen.getByRole('button') as HTMLButtonElement;

    await user.click(button);
    await waitFor(() => expect(createCalls).toBe(1));
    expect(await screen.findByText(/Couldn't start it/i)).toBeTruthy();
    expect(button.disabled, 'a real create failure must be retryable').toBe(false);
  });

  test('the happy path routes to the new plan', async () => {
    const user = userEvent.setup();
    render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(pushed).toEqual(['/night-out/tok-1']));
  });

  test('a created-but-unopened plan SURVIVES an unmount, and Start stays disabled', async () => {
    readFails = true;
    const user = userEvent.setup();
    const first = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(createCalls).toBe(1));
    expect(await screen.findByText(/created/i)).toBeTruthy();

    // The route change that used to lose the plan.
    first.unmount();

    render(<StartNightOutButton />);
    const button = await screen.findByRole('button', { name: /open it/i });
    expect(button, 'the recovery affordance did not survive the route change').toBeTruthy();

    const start = screen.getByRole('button', { name: /Start the official Night Out/i });
    expect(
      (start as HTMLButtonElement).disabled,
      'Start was re-armed after a route change, which is how the second plan gets made',
    ).toBe(true);

    await user.click(start).catch(() => undefined);
    expect(createCalls, 'a second plan was created after a route change').toBe(1);
  });

  test('a plan that was opened successfully does NOT come back as unfinished', async () => {
    const user = userEvent.setup();
    const first = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(pushed).toEqual(['/night-out/tok-1']));
    first.unmount();

    render(<StartNightOutButton />);
    expect(
      screen.queryByRole('button', { name: /open it/i }),
      'an opened plan was re-offered as unfinished',
    ).toBeNull();
    expect(
      (screen.getByRole('button') as HTMLButtonElement).disabled,
      'Start stayed disabled after the plan was successfully opened',
    ).toBe(false);
  });

  test('another account NEVER inherits the parked plan, and is not locked out', async () => {
    // Round 2, filed by BOTH lanes. sessionStorage is per tab, not per account,
    // and accountCache wipes localStorage only — so without user scoping the
    // next person to sign in on this tab got A's recovery UI, a disabled Start,
    // and an "Open it" that silently no-ops under their own RLS. They could not
    // create a night out for the rest of the session.
    readFails = true;
    const user = userEvent.setup();
    const first = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(createCalls).toBe(1));
    expect(await screen.findByText(/created/i)).toBeTruthy();
    first.unmount();

    currentUser = USER_B;
    render(<StartNightOutButton />);

    expect(
      screen.queryByRole('button', { name: /open it/i }),
      "user B inherited user A's parked plan",
    ).toBeNull();
    const start = screen.getByRole('button', { name: /Start the official Night Out/i });
    expect(
      (start as HTMLButtonElement).disabled,
      'user B was locked out of creating their own night out',
    ).toBe(false);

    readFails = false;
    await user.click(start);
    await waitFor(() =>
      expect(createCalls, 'user B could not create a plan at all').toBe(2),
    );
  });

  test('the original owner still has their recovery after another account visits', async () => {
    // Round 3 (Codex): round 2 fixed B's lockout by DELETING A's parked record,
    // which destroys A's only route back to a plan they created and never
    // opened — no surface lists plans you own. Ignoring is strictly better.
    readFails = true;
    const user = userEvent.setup();
    const first = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(createCalls).toBe(1));
    first.unmount();

    // B signs in on the same tab, sees nothing of A's, and leaves.
    currentUser = USER_B;
    const second = render(<StartNightOutButton />);
    expect(screen.queryByRole('button', { name: /open it/i })).toBeNull();
    second.unmount();

    // A comes back.
    currentUser = USER_A;
    render(<StartNightOutButton />);
    expect(
      await screen.findByRole('button', { name: /open it/i }),
      "another account's visit destroyed the owner's only way back to their plan",
    ).toBeTruthy();
  });

  test('a plan parked on an earlier night does not disable Start today', async () => {
    // Codex, round 2: mobile browsers restore sessionStorage, so an unopened
    // plan from last night would otherwise keep Start disabled the next day.
    readFails = true;
    const user = userEvent.setup();
    const first = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(createCalls).toBe(1));
    first.unmount();

    nightKey = '2026-08-18'; // the tab is restored the next day
    render(<StartNightOutButton />);

    expect(
      screen.queryByRole('button', { name: /open it/i }),
      "yesterday's unopened plan was re-offered as today's",
    ).toBeNull();
    expect(
      (screen.getByRole('button') as HTMLButtonElement).disabled,
      'Start stayed disabled for a plan from a previous night',
    ).toBe(false);
  });

  test('a failed retry SAYS so instead of being a dead button', async () => {
    readFails = true;
    const user = userEvent.setup();
    render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(createCalls).toBe(1));

    // The plan is genuinely gone, so the retry cannot succeed.
    await user.click(await screen.findByRole('button', { name: /open it/i }));
    expect(
      await screen.findByText(/Still couldn't open it/i),
      'a failing retry gave the user no feedback at all',
    ).toBeTruthy();
    expect(pushed).toEqual([]);
  });

  test('navigation does not fire from a component that is already gone', async () => {
    let release: (value: unknown) => void = () => {};
    heldRead = new Promise((resolve) => {
      release = resolve;
    });

    const user = userEvent.setup();
    const view = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(createCalls).toBe(1));

    // The user navigates away while the follow-up read is still in flight.
    view.unmount();
    release({ id: PLAN_ID, shareToken: 'tok-1', status: 'open' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      pushed,
      'a late read yanked the user off the page they had deliberately opened',
    ).toEqual([]);
  });
});
