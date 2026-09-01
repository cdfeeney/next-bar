import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * V8-R-ONB-003 — the under-21 exit has to be REACHABLE.
 *
 * The defect this pins was a boundary, not a missing screen. `/onboarding/age`
 * implemented the whole exit; the global `AgeGate` overlay renders from the
 * root layout on top of every route and offered exactly one button, "I'm 21 or
 * older". So on a fresh device the one screen that owns the "no" branch was
 * covered by a dialog that had none, and an under-21 visitor could only affirm
 * falsely or sit there. The requirement was implemented and unreachable, which
 * is indistinguishable from unimplemented to the person holding the phone.
 *
 * WHY THIS FILE LIVES UNDER THE ONBOARDING ROUTE. What it tests is the
 * HAND-OFF: that the overlay routes an under-21 answer to the step that owns
 * the exit, and stands down so that step can be read. Both halves belong to
 * the age step's contract, and `AGE_STEP_PATH` is exported from `../_ageAck`
 * precisely so the two sides cannot drift apart.
 */

const pushed: string[] = [];
let pathname = '/';
/**
 * THE STORED ANSWER, three-valued. It was a boolean `acked` until the operator
 * ruling of 2026-09-01 moved the age check ahead of account creation: a
 * cleared key and a recorded "no" are different states, and collapsing them is
 * exactly the defect — a withdrawn ack reads as "never asked", so the overlay
 * asked again and offered one-tap admission to the visitor who had just said
 * they were under 21.
 */
let answer: 'yes' | 'no' | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
  usePathname: () => pathname,
}));

vi.mock('@/app/onboarding/_ageAck', async () => {
  const actual = await vi.importActual<typeof import('../_ageAck')>(
    '../_ageAck',
  );
  return {
    ...actual,
    readAgeAnswer: () => answer,
    readAgeAck: () => answer === 'yes',
    writeAgeAck: vi.fn(),
    clearAgeAck: vi.fn(),
  };
});

import AgeGate from '@/components/AgeGate';
import { AGE_STEP_PATH } from '../_ageAck';

const gate = () => screen.queryByRole('dialog', { name: /are you 21 or older/i });

beforeEach(() => {
  pushed.length = 0;
  pathname = '/';
  answer = null;
});

describe('the global age gate', () => {
  test('offers an under-21 answer, not only an affirmation', async () => {
    render(<AgeGate />);

    expect(gate()).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /i.m under 21/i }),
    ).toBeTruthy();
  });

  test('hands an under-21 answer to the step that owns the exit', async () => {
    render(<AgeGate />);

    await userEvent.click(screen.getByRole('button', { name: /i.m under 21/i }));

    // The flag the age step already honours — no second copy of the exit, its
    // sign-out, or its ack withdrawal lives in the overlay.
    expect(pushed).toEqual(['/onboarding/age?under21=1']);
  });

  test('writes nothing about the ack when handing over', async () => {
    // The step it hands to WITHDRAWS the ack. An overlay that also wrote or
    // cleared the key would be a second writer of the one value, which is how
    // the two answers drift apart.
    const { writeAgeAck } = await import('../_ageAck');
    render(<AgeGate />);

    await userEvent.click(screen.getByRole('button', { name: /i.m under 21/i }));

    expect(writeAgeAck).not.toHaveBeenCalled();
  });

  test('stands down on the age step, so the exit it hands to is readable', () => {
    // Rendering over /onboarding/age asks the same question twice AND covers
    // the exit screen. This is the half that made the button above useless.
    pathname = '/onboarding/age';
    render(<AgeGate />);

    expect(gate()).toBeNull();
  });

  test('stands down where the exit lands, so Close is terminal and not a loop', () => {
    // The exit WITHDRAWS the ack and then pushes here, so the device arrives
    // unacknowledged by construction. An overlay that covered this route asked
    // the 21+ question again on the marketing page, and its "I'm under 21"
    // pushed straight back to the exit — Close never left.
    pathname = '/install';
    render(<AgeGate />);

    expect(gate()).toBeNull();
  });

  test('still covers the rest of the app while the device is unacknowledged', () => {
    // Standing down is scoped to the one route that owns the question — it is
    // not a general dismissal, and the App-Store blocking contract elsewhere
    // stays exactly as it was.
    pathname = '/map';
    render(<AgeGate />);

    expect(gate()).toBeTruthy();
  });

  test('stays down for a device that already acknowledged', () => {
    answer = 'yes';
    render(<AgeGate />);

    expect(gate()).toBeNull();
  });

  test('notices an ack written by the age step and does not re-ask on the next route', () => {
    // The overlay is mounted by the ROOT LAYOUT, so it survives every
    // client-side navigation while the ack it reads is written by a different
    // screen. A mount-once read went stale the instant /onboarding/age wrote
    // the ack and pushed onward, and the overlay then covered the next step
    // with the question the device had just answered.
    pathname = AGE_STEP_PATH;
    const { rerender } = render(<AgeGate />);
    expect(gate()).toBeNull(); // stands down on the step itself

    answer = 'yes'; // the step confirms 21+ …
    pathname = '/onboarding/location'; // … and pushes on
    rerender(<AgeGate />);

    expect(gate()).toBeNull();
  });
});

/**
 * V8-R-ONB-003 under the operator ruling of 2026-09-01, verbatim: "we should
 * just have it be where they can't make an account if they are under 21."
 *
 * The age check gates account creation, so the "no" has to be REMEMBERED. The
 * exit used to `clearAgeAck()`, which leaves the device in the state a
 * brand-new one is in — so the overlay re-asked on the very next route and
 * offered "I'm 21 or older" as a one-tap way to `/auth`. Every sentence was
 * true and the gate blocked nothing.
 */
describe('a recorded under-21 answer', () => {
  const closed = () =>
    screen.queryByRole('dialog', { name: /next bar is for ages 21\+/i });

  test('closes the app instead of re-asking the question', () => {
    answer = 'no';
    pathname = '/map';
    render(<AgeGate />);

    expect(closed()).toBeTruthy();
    // The whole point: no route back into sign-up from the refusal.
    expect(gate()).toBeNull();
    expect(screen.queryByRole('button', { name: /i.m 21 or older/i })).toBeNull();
  });

  test('blocks the sign-up route itself, not just the app shell', () => {
    // `/auth` is where the account is created. If the overlay came down here,
    // "they can't make an account if they are under 21" would be false.
    answer = 'no';
    pathname = '/auth';
    render(<AgeGate />);

    expect(closed()).toBeTruthy();
  });

  test('leaves the marketing page and the exit screen readable', () => {
    // The exit pushes to /install and the age step owns the question. Covering
    // either with the closed state would hide the screen that explains it.
    answer = 'no';
    for (const route of ['/install', AGE_STEP_PATH]) {
      pathname = route;
      const { unmount } = render(<AgeGate />);
      expect(closed()).toBeNull();
      expect(gate()).toBeNull();
      unmount();
    }
  });

  test('a mistap has a remedy, and the remedy is to be ASKED again', async () => {
    // Not "admitted again". A control on the refusal that let the device
    // straight in would be the refusal undoing itself; this one returns the
    // device to unanswered and the question comes back.
    const { clearAgeAck } = await import('../_ageAck');
    answer = 'no';
    pathname = '/map';
    render(<AgeGate />);

    await userEvent.click(
      screen.getByRole('button', { name: /answered that by mistake/i }),
    );

    expect(clearAgeAck).toHaveBeenCalled();
    expect(gate()).toBeTruthy();
    expect(closed()).toBeNull();
  });
});
