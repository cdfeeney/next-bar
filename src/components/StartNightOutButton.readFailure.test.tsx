import { readFileSync } from 'node:fs';
import path from 'node:path';
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
/** When set, createNightOut hands back this promise instead of resolving. */
let heldCreate: Promise<unknown> | null = null;
let nightKey = '2026-08-17';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));

const STARTED_KEY = 'next-bar:started-night-out:v1';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
let currentUser = USER_A;

let authStatus: 'signed-in' | 'signed-out' = 'signed-in';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () =>
    authStatus === 'signed-in'
      ? { status: 'signed-in', user: { id: currentUser } }
      : { status: 'signed-out', user: null },
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
    if (heldCreate !== null) return heldCreate;
    return createResult;
  },
  getNightOut: async () => {
    if (heldRead !== null) return heldRead;
    return readFails ? null : { id: PLAN_ID, shareToken: 'tok-1', status: 'open' };
  },
}));

import StartNightOutButton, { forgetStartedNightOut } from './StartNightOutButton';

beforeEach(() => {
  pushed.length = 0;
  createResult = PLAN_ID;
  readFails = false;
  createCalls = 0;
  heldRead = null;
  heldCreate = null;
  currentUser = USER_A;
  authStatus = 'signed-in';
  nightKey = '2026-08-17';
  window.localStorage.clear();
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
    // The PLAN PAGE spends the record now, not the push (round 9, Codex): a
    // fire-and-forget navigation that never commits must not drop it. This line
    // is what that page does on settling as a member, and the requirement below
    // is unchanged — an opened plan is not re-offered as unfinished.
    forgetStartedNightOut(USER_A);
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
    // Round 2, filed by BOTH lanes. The store is per tab or per origin, never
    // per account, and this key is in no wipe set — so without user scoping the
    // next person to sign in here got A's recovery UI, a disabled Start,
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

  test("another account CREATING a plan does not destroy the owner's parked one", async () => {
    // Both lanes, new cycle round 1. The previous fix ignored a foreign record
    // rather than deleting it, which protected A only while B LOOKED. The
    // moment B created successfully, the single slot was overwritten and then
    // cleared on open — A came back to an armed Start and the next tap made the
    // duplicate plan criterion 4 exists to prevent.
    readFails = true;
    const user = userEvent.setup();
    const a = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(createCalls).toBe(1));
    a.unmount();

    // B signs in and successfully creates and opens their own plan.
    currentUser = USER_B;
    readFails = false;
    const b = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button', { name: /Start the official Night Out/i }));
    await waitFor(() => expect(pushed).toEqual(['/night-out/tok-1']));
    b.unmount();

    // A returns the same night.
    currentUser = USER_A;
    render(<StartNightOutButton />);
    expect(
      await screen.findByRole('button', { name: /open it/i }),
      "B creating a plan destroyed A's only route back to their unopened plan",
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /Start the official Night Out/i }) as HTMLButtonElement)
        .disabled,
      'Start was re-armed for A, which is how the duplicate plan gets created',
    ).toBe(true);
  });

  test('opening a plan clears only that account’s record', async () => {
    readFails = true;
    const user = userEvent.setup();
    const a = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(createCalls).toBe(1));
    a.unmount();

    currentUser = USER_B;
    readFails = false;
    const b = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button', { name: /Start the official Night Out/i }));
    await waitFor(() => expect(pushed.length).toBe(1));
    // B reaches the plan page, which is what spends a record now.
    forgetStartedNightOut(USER_B);
    b.unmount();

    // B's own record is gone (they opened it) — B is not stuck.
    currentUser = USER_B;
    const b2 = render(<StartNightOutButton />);
    expect(screen.queryByRole('button', { name: /open it/i })).toBeNull();
    b2.unmount();

    // ...and A's survived that whole sequence.
    currentUser = USER_A;
    render(<StartNightOutButton />);
    expect(await screen.findByRole('button', { name: /open it/i })).toBeTruthy();
  });

  test('an in-place account switch (no unmount) does not hand B the previous account’s recovery', async () => {
    // Round 2 (Claude, HIGH). useAuth subscribes to onAuthStateChange and
    // updates IN PLACE, so a sign-out and a different sign-in propagating from
    // ANOTHER TAB reach this component without unmounting it. Every other
    // multi-account test here unmounts between switches, which is exactly why
    // they all passed while this was broken: the storage map was per-user but
    // the React state above it was not.
    readFails = true;
    const user = userEvent.setup();
    const view = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(createCalls).toBe(1));
    expect(await screen.findByText(/created/i)).toBeTruthy();

    // A signs out and B signs in, both without this component unmounting.
    currentUser = USER_B;
    view.rerender(<StartNightOutButton />);

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /open it/i }),
        "B inherited A's recovery panel across an in-place account switch",
      ).toBeNull(),
    );
    const start = screen.getByRole('button', { name: /Start the official Night Out/i });
    expect(
      (start as HTMLButtonElement).disabled,
      'B was locked out of creating a plan by state left behind by A',
    ).toBe(false);

    // ...and A's own record is still intact underneath.
    currentUser = USER_A;
    view.rerender(<StartNightOutButton />);
    expect(
      await screen.findByRole('button', { name: /open it/i }),
      "A's parked plan was destroyed by B's visit",
    ).toBeTruthy();
  });

  test('a sign-out/sign-in round trip DURING a create does not re-arm Start', async () => {
    // The root cause both lanes converged on, and the one the goal named on day
    // one: "an async result applied to state that has since moved on — fix them
    // as one shape." Every earlier test here switches accounts only between
    // SETTLED states, which is why five versions of this component passed while
    // this window stayed open.
    let releaseCreate: (value: unknown) => void = () => {};
    heldCreate = new Promise((resolve) => {
      releaseCreate = resolve;
    });

    const user = userEvent.setup();
    const view = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(createCalls).toBe(1));

    // A's session blips out and back — same account, create still in flight.
    authStatus = 'signed-out';
    view.rerender(<StartNightOutButton />);
    authStatus = 'signed-in';
    view.rerender(<StartNightOutButton />);

    // While a create is in flight the control reads "Starting…", so select the
    // control itself rather than the idle label.
    const start = screen.getByRole('button') as HTMLButtonElement;
    expect(
      start.disabled,
      'Start was re-armed while the account’s own create was still in flight',
    ).toBe(true);
    expect(start.textContent).toMatch(/Starting/);
    await user.click(start).catch(() => undefined);
    expect(
      createCalls,
      'a second plan was created for the same night while the first was in flight',
    ).toBe(1);

    // And A's own answer still applies, because A is who is looking.
    readFails = true;
    releaseCreate(PLAN_ID);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /open it/i })).toBeTruthy(),
    );
  });

  test('a create that lands after a switch to B is parked for A, and never painted for B', async () => {
    let releaseCreate: (value: unknown) => void = () => {};
    heldCreate = new Promise((resolve) => {
      releaseCreate = resolve;
    });

    const user = userEvent.setup();
    const view = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(createCalls).toBe(1));

    // A different account takes over the tab mid-create.
    currentUser = USER_B;
    view.rerender(<StartNightOutButton />);

    releaseCreate(PLAN_ID);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(
      screen.queryByRole('button', { name: /open it/i }),
      "A's in-flight create painted its recovery panel into B's view",
    ).toBeNull();
    expect(
      (screen.getByRole('button', { name: /Start the official Night Out/i }) as HTMLButtonElement)
        .disabled,
      'B was left disabled by an operation belonging to another account',
    ).toBe(false);

    // A returns: the plan A actually created is still recoverable.
    currentUser = USER_A;
    view.rerender(<StartNightOutButton />);
    expect(
      await screen.findByRole('button', { name: /open it/i }),
      "A's plan was lost because the create resolved while B was on screen",
    ).toBeTruthy();
  });

  test('unmount DURING the create does not re-arm Start on remount', async () => {
    // Cycle 3 (both lanes). Nothing is parked until the create RESOLVES, and the
    // in-flight marker used to die with the component — so tap Start, navigate
    // away before the RPC answers, come back, and Start was armed. 0044 has no
    // per-(owner, night) uniqueness, so the second tap really did make a second
    // plan. Every other unmount test in this file holds the READ, never the
    // CREATE, which is why this window stayed open.
    let releaseCreate: (value: unknown) => void = () => {};
    heldCreate = new Promise((resolve) => {
      releaseCreate = resolve;
    });

    const user = userEvent.setup();
    const view = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(createCalls).toBe(1));

    // Navigate away while create_night_out is still in flight, then come back.
    view.unmount();
    render(<StartNightOutButton />);

    const start = screen.getByRole('button') as HTMLButtonElement;
    expect(
      start.disabled,
      'Start was armed while this account already had a create in flight',
    ).toBe(true);
    await user.click(start).catch(() => undefined);
    expect(
      createCalls,
      'a second plan was created for the same night while the first RPC was in flight',
    ).toBe(1);

    // ...and when the create finally settles inside the DEAD instance's
    // closure, the LIVE one must hear about it. Cycle 3 round 2 (both lanes):
    // it never did — the screen sat on a disabled "Starting…" forever while
    // module state said the plan was parked and ready. The previous version of
    // this test released the promise and asserted nothing afterwards, pinning
    // the safety half and silently tolerating the liveness half.
    readFails = true;
    releaseCreate(PLAN_ID);

    expect(
      await screen.findByRole('button', { name: /open it/i }),
      'the remounted screen never learned the create had settled',
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /Start the official Night Out/i }) as HTMLButtonElement)
        .disabled,
      'Start should stay disabled while an unopened plan is recoverable',
    ).toBe(true);
  });

  test('a remounted screen recovers even while the dead instance’s read hangs', async () => {
    // Cycle 3 round 3 (Codex, medium). The previous fix told live instances the
    // create had settled from `finally` — which is reached only AFTER the
    // follow-up read. So the DEAD instance parked the plan and then sat on a
    // read that may never answer, while the remounted screen stayed on a
    // disabled "Starting…" with no "Open it" for exactly as long as that read
    // took. The round-2 test missed it because its read returned immediately.
    let releaseCreate: (value: unknown) => void = () => {};
    heldCreate = new Promise((resolve) => {
      releaseCreate = resolve;
    });
    // The read never settles.
    heldRead = new Promise(() => {});

    const user = userEvent.setup();
    const view = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(createCalls).toBe(1));

    view.unmount();
    render(<StartNightOutButton />);

    releaseCreate(PLAN_ID);

    expect(
      await screen.findByRole('button', { name: /open it/i }),
      'the live screen waited on a read belonging to a component that is gone',
    ).toBeTruthy();
    const start = screen.getByRole('button', {
      name: /Start the official Night Out/i,
    }) as HTMLButtonElement;
    expect(start.disabled, 'Start must stay disabled while a plan is unopened').toBe(true);
    expect(createCalls).toBe(1);
  });

  test('a slow read does NOT flash the recovery panel before it settles', async () => {
    // The other half of settling the create at park time: the instance doing the
    // read must not be told by its own notification that the read failed.
    let releaseRead: (value: unknown) => void = () => {};
    heldRead = new Promise((resolve) => {
      releaseRead = resolve;
    });

    const user = userEvent.setup();
    render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(createCalls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      screen.queryByRole('button', { name: /open it/i }),
      'a read still in flight was reported to the user as a failure',
    ).toBeNull();

    releaseRead({ id: PLAN_ID, shareToken: 'tok-1', status: 'open' });
    await waitFor(() => expect(pushed).toEqual(['/night-out/tok-1']));
  });

  test('a failed create for A is not shown as B’s failure after an in-place switch', async () => {
    // Cycle 3 (Claude). The reset effect cleared everything except `error`.
    createResult = null;
    const user = userEvent.setup();
    const view = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    expect(await screen.findByText(/Couldn't start it/i)).toBeTruthy();

    currentUser = USER_B;
    view.rerender(<StartNightOutButton />);

    await waitFor(() =>
      expect(
        screen.queryByText(/Couldn't start it/i),
        "B was shown A's create failure",
      ).toBeNull(),
    );
  });

  test('a parked plan survives the tab closing, so tomorrow-morning Start is not a second plan', async () => {
    // Cold-panel round 2 (Codex). The record lived in sessionStorage, which the
    // browser discards when the TAB closes — so a create whose follow-up read
    // failed was forgotten the moment the user closed the tab, and the next
    // Start on the same night made a SECOND plan. `create_night_out` has no
    // per-(owner, night) uniqueness, so nothing downstream catches it.
    //
    // Closing a tab IS clearing sessionStorage: that is the whole definition of
    // the store, so clearing it here is the faithful expression of the trigger.
    readFails = true;
    const user = userEvent.setup();
    const first = render(<StartNightOutButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(createCalls).toBe(1));
    await screen.findByRole('button', { name: /open it/i });
    first.unmount();

    // The tab closes and a new one opens on the same night, same account.
    window.sessionStorage.clear();
    render(<StartNightOutButton />);

    expect(
      await screen.findByRole('button', { name: /open it/i }),
      'the created plan was forgotten when the tab closed',
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', {
        name: /start the official night out/i,
      }) as HTMLButtonElement).disabled,
      'Start re-armed after a tab close, so the next tap creates a second plan',
    ).toBe(true);
    expect(createCalls, 'a second create was issued for the same night').toBe(1);
  });

  test('a plan parked by ANOTHER TAB disarms an already-mounted Start', async () => {
    // Round-2 panel (Codex, medium). Moving the record to localStorage made it
    // visible to every tab, but a tab that was already mounted re-derived its
    // parked state only from module-scoped state, which is per-realm. Tab A
    // parks a plan; tab B sits on an armed Start and its next tap makes the
    // second plan criterion 4 exists to prevent.
    //
    // A real second tab cannot be spawned in jsdom, so this writes the record
    // the way another realm would — straight to the shared store — and then
    // dispatches the `storage` event the browser fires in every OTHER tab.
    render(<StartNightOutButton />);
    expect(
      (screen.getByRole('button') as HTMLButtonElement).disabled,
      'Start began disabled with nothing parked',
    ).toBe(false);

    const OTHER_TAB_PLAN = '99999999-9999-4999-8999-999999999999';
    const value = JSON.stringify({
      [USER_A]: { planId: OTHER_TAB_PLAN, nightKey },
    });
    window.localStorage.setItem(STARTED_KEY, value);
    window.dispatchEvent(
      new StorageEvent('storage', { key: STARTED_KEY, newValue: value }),
    );

    expect(
      await screen.findByRole('button', { name: /open it/i }),
      "another tab's parked plan never reached this one",
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', {
        name: /start the official night out/i,
      }) as HTMLButtonElement).disabled,
      'Start stayed armed after another tab parked a plan, so the next tap duplicates it',
    ).toBe(true);
    expect(createCalls, 'this tab created a plan of its own').toBe(0);
  });

  test('Start re-reads the store before creating, so a just-parked plan wins the race', async () => {
    // Round-4 panel (Codex). The cross-tab `storage` event keeps the UI honest,
    // but it is delivered asynchronously and the React state it drives commits
    // later still. Between another tab parking its plan and this tab's effect
    // running, Start is enabled and `busy` is false — a click in that window
    // issued a second create_night_out.
    //
    // This is that exact window: the record is written the way another realm
    // would write it, and Start is clicked with NO storage event dispatched at
    // all, which is strictly harder than the real race.
    const OTHER_TAB_PLAN = '99999999-9999-4999-8999-999999999999';
    render(<StartNightOutButton />);
    window.localStorage.setItem(
      STARTED_KEY,
      JSON.stringify({ [USER_A]: { planId: OTHER_TAB_PLAN, nightKey } }),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /start the official night out/i }));

    expect(createCalls, 'a second plan was created for a night that already has one').toBe(0);
    expect(
      await screen.findByRole('button', { name: /open it/i }),
      'the already-parked plan was not offered for recovery',
    ).toBeTruthy();
  });

  test('a record removed by another tab mid-create is not written back', async () => {
    // Round-5 panel (Codex). A record disappearing elsewhere while our create is
    // in flight means our answer is stale — the owner opened that plan there, or
    // their account was erased. Writing it back re-offers a finished recovery or
    // resurrects identifiers a wipe just removed.
    let release: (value: unknown) => void = () => {};
    heldCreate = new Promise((resolve) => {
      release = resolve;
    });

    const user = userEvent.setup();
    render(<StartNightOutButton />);
    await user.click(screen.getByRole('button', { name: /start the official night out/i }));
    await waitFor(() => expect(createCalls).toBe(1));

    // Another realm had a record for us and has just removed it.
    const before = JSON.stringify({ [USER_A]: { planId: PLAN_ID, nightKey } });
    window.localStorage.removeItem(STARTED_KEY);
    window.dispatchEvent(
      new StorageEvent('storage', { key: STARTED_KEY, oldValue: before, newValue: null }),
    );

    // Only now does our create answer.
    release(PLAN_ID);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(
      window.localStorage.getItem(STARTED_KEY),
      'a create that another tab had already settled wrote its record back',
    ).toBeNull();
  });

  test("another account parking does NOT discard our own in-flight create", async () => {
    // The false positive that a naive "absent now" rule would introduce, which
    // would be worse than the bug it fixes: our create has parked nothing yet,
    // so somebody else's park must not look like our abandonment.
    let release: (value: unknown) => void = () => {};
    heldCreate = new Promise((resolve) => {
      release = resolve;
    });
    readFails = true;

    const user = userEvent.setup();
    render(<StartNightOutButton />);
    await user.click(screen.getByRole('button', { name: /start the official night out/i }));
    await waitFor(() => expect(createCalls).toBe(1));

    // A DIFFERENT account parks a plan in another tab.
    const after = JSON.stringify({ [USER_B]: { planId: PLAN_ID, nightKey } });
    window.localStorage.setItem(STARTED_KEY, after);
    window.dispatchEvent(
      new StorageEvent('storage', { key: STARTED_KEY, oldValue: null, newValue: after }),
    );

    release(PLAN_ID);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const stored = JSON.parse(window.localStorage.getItem(STARTED_KEY) as string);
    expect(
      stored[USER_A],
      "our own recovery record was discarded because another account parked one",
    ).toBeTruthy();
  });

  test('opening a plan sweeps every expired record, not only our own', async () => {
    // Round-5 panel (Codex). Pruning ran only inside rememberStarted, so a user
    // opening their plan preserved another account's expired entry forever — and
    // the registry doc claims the record is night-bound.
    window.localStorage.setItem(
      STARTED_KEY,
      JSON.stringify({
        [USER_B]: { planId: PLAN_ID, nightKey: '2026-01-01' },
        [USER_A]: { planId: PLAN_ID, nightKey: '2026-01-01' },
      }),
    );
    render(<StartNightOutButton />);

    await waitFor(() => {
      const raw = window.localStorage.getItem(STARTED_KEY);
      const left = raw === null ? {} : JSON.parse(raw);
      expect(
        left[USER_B],
        "another account's expired entry outlived the night it was stamped with",
      ).toBeUndefined();
    });
  });

  test('a FAILED create clears the abandonment flag, so the next one still parks', async () => {
    // Round-8 panel (Claude). The flag was cleared only inside rememberStarted,
    // which runs only when a create SUCCEEDS. A create that failed left it set,
    // and the owner's next successful create silently refused to park — which
    // reopens the criterion-4 duplicate-plan hole the flag exists to protect.
    let release: (value: unknown) => void = () => {};
    heldCreate = new Promise((resolve) => {
      release = resolve;
    });

    const user = userEvent.setup();
    render(<StartNightOutButton />);
    await user.click(screen.getByRole('button', { name: /start the official night out/i }));
    await waitFor(() => expect(createCalls).toBe(1));

    // Another realm removes our record while the create is in flight.
    const before = JSON.stringify({ [USER_A]: { planId: PLAN_ID, nightKey } });
    window.localStorage.removeItem(STARTED_KEY);
    window.dispatchEvent(
      new StorageEvent('storage', { key: STARTED_KEY, oldValue: before, newValue: null }),
    );

    // ...and THIS create then fails outright.
    release(null);
    await waitFor(() => expect(screen.getByText(/Couldn't start it/i)).toBeTruthy());

    // A second attempt succeeds, and its follow-up read fails. It must park.
    heldCreate = null;
    createResult = PLAN_ID;
    readFails = true;
    await user.click(screen.getByRole('button', { name: /start the official night out/i }));
    await waitFor(() => expect(createCalls).toBe(2));

    expect(
      await screen.findByRole('button', { name: /open it/i }),
      'a stale abandonment flag from a FAILED create discarded the next real plan',
    ).toBeTruthy();
    const stored = JSON.parse(window.localStorage.getItem(STARTED_KEY) as string);
    expect(stored[USER_A]?.planId, 'the new plan was never parked').toBe(PLAN_ID);
  });

  test('navigating to the plan does NOT spend the record — the plan page does', async () => {
    // Round-9 panel (Codex). `router.push` is fire-and-forget: clearing the
    // record beside it meant a navigation that failed or was superseded before
    // the route committed dropped the record anyway, and a later remount armed
    // Start into a duplicate plan. Keeping it one moment too long is safe; the
    // night stamp sweeps it. Dropping it early is the duplicate.
    const user = userEvent.setup();
    render(<StartNightOutButton />);
    await user.click(screen.getByRole('button', { name: /start the official night out/i }));
    await waitFor(() => expect(pushed.length).toBe(1));

    const raw = window.localStorage.getItem(STARTED_KEY);
    expect(raw, 'the record was spent at push time, before any route committed').not.toBeNull();
    expect(JSON.parse(raw as string)[USER_A]?.planId).toBe(PLAN_ID);
  });

  test('an account wiped in another tab abandons an in-flight create', async () => {
    // Round-9 panel (Codex), re-filing a gap this goal had recorded as
    // unclosable. Nothing is parked yet when a create is in flight, so there is
    // no PRESENT->ABSENT transition on the parked key to read — but account
    // deletion also removes the account-owner marker, which crosses realms
    // through the same storage event and names nobody.
    let release: (value: unknown) => void = () => {};
    heldCreate = new Promise((resolve) => {
      release = resolve;
    });

    const user = userEvent.setup();
    render(<StartNightOutButton />);
    await user.click(screen.getByRole('button', { name: /start the official night out/i }));
    await waitFor(() => expect(createCalls).toBe(1));

    // Another tab deletes the account: clearAccountCache removes the owner key.
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'next-bar:account:owner:v1',
        oldValue: USER_A,
        newValue: null,
      }),
    );

    release(PLAN_ID);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(
      window.localStorage.getItem(STARTED_KEY),
      "an in-flight create restored a deleted account's identifiers after the wipe",
    ).toBeNull();
  });

  test('a plan parked on an earlier night does not disable Start today', async () => {
    // Codex, round 2: the record outlives the tab, so an unopened plan from
    // last night would otherwise keep Start disabled the next day.
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

/**
 * STATIC guards, and the honest reason they are static.
 *
 * `act()` flushes passive effects and runs effect cleanup synchronously, so the
 * window a real browser leaves open between a commit and the passive flush does
 * not exist in this suite. Both assertions below were added only after reverting
 * the fix left every behavioral test in this file green — a guard that cannot
 * fail is worse than no guard, because it is advertised.
 *
 * The region is SLICED rather than searched from an offset: an earlier guard in
 * this repo passed against a deliberately broken file because `indexOf(needle,
 * start)` matched an identical call further down.
 */
describe('identity refs are committed, not flushed after paint', () => {
  test('the mounted ref is set in a layout effect', () => {
    const source = readFileSync(path.join(__dirname, 'StartNightOutButton.tsx'), 'utf8');
    const at = source.indexOf('mounted.current = true;');
    expect(at, 'the mounted ref moved or was renamed').toBeGreaterThan(-1);
    const opener = source.lastIndexOf('useLayoutEffect(() => {', at);
    const passive = source.lastIndexOf('useEffect(() => {', at);
    expect(opener, 'the mounted ref is not inside a useLayoutEffect').toBeGreaterThan(-1);
    expect(
      opener,
      'a passive effect now sits between useLayoutEffect and the mounted ref',
    ).toBeGreaterThan(passive);
  });

  test('the abandonment flag is cleared where the create ends, not where it parks', () => {
    const source = readFileSync(path.join(__dirname, 'StartNightOutButton.tsx'), 'utf8');
    const from = source.indexOf('const settleCreate = (): void => {');
    const to = source.indexOf('};', from);
    expect(from, 'settleCreate moved or was renamed').toBeGreaterThan(-1);
    expect(
      source.slice(from, to).includes('abandonedCreates.delete(owner);'),
      'settleCreate does not clear the flag, so a FAILED create strands it',
    ).toBe(true);
  });
});

