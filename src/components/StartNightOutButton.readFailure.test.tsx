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
 */

const pushed: string[] = [];
let createResult: string | null = 'plan-1';
let readFails = false;
let createCalls = 0;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({}),
}));

vi.mock('@/lib/nightOuts.server', () => ({
  createNightOut: async () => {
    createCalls += 1;
    return createResult;
  },
  getNightOut: async () =>
    readFails ? null : { id: 'plan-1', shareToken: 'tok-1', status: 'open' },
}));

import StartNightOutButton from './StartNightOutButton';

beforeEach(() => {
  pushed.length = 0;
  createResult = 'plan-1';
  readFails = false;
  createCalls = 0;
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
});
