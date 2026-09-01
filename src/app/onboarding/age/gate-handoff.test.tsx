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
let acked = false;

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
    readAgeAck: () => acked,
    writeAgeAck: vi.fn(),
  };
});

import AgeGate from '@/components/AgeGate';

const gate = () => screen.queryByRole('dialog', { name: /are you 21 or older/i });

beforeEach(() => {
  pushed.length = 0;
  pathname = '/';
  acked = false;
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
    acked = true;
    render(<AgeGate />);

    expect(gate()).toBeNull();
  });
});
