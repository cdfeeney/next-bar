import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * V8-R-ONB-003 — the 21+ step and its under-21 exit.
 *
 * The exit must say only what is TRUE. Two sentences on it are easy to get
 * wrong and both have been wrong before: "no information you entered is
 * stored", while a confirmed Supabase account sat behind it, and "we've signed
 * you out", painted before the session had actually ended.
 *
 * THE SIGN-OUT CLAIM IS DRIVEN BY THE SESSION, NOT THE PROMISE.
 * `supabase.auth.signOut()` resolves with `{ error }` rather than throwing and
 * `useAuth().signOut()` returns `Promise<void>`, so a resolved call is not
 * evidence the session ended. These tests hold the auth status still and check
 * that the screen refuses to claim a sign-out it cannot see.
 *
 * e2e covers the signed-out shape of this screen. The states below need a
 * controllable auth status, so they live here.
 */

const replaced: string[] = [];
const pushed: string[] = [];
let authStatus: 'signed-in' | 'signed-out' | 'unavailable' | 'loading' =
  'signed-in';
let signOut: () => Promise<void> = async () => {};
let acked = false;
let ackCleared = 0;

// One STABLE router object, the way next/navigation's really behaves: the
// page's mount effect depends on it, so handing back a fresh object per render
// re-runs that effect forever and resets the view the exit just set.
const router = {
  push: (href: string) => pushed.push(href),
  replace: (href: string) => replaced.push(href),
};

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    status: authStatus,
    user: null,
    signOut: () => signOut(),
  }),
}));

vi.mock('../_ageAck', () => ({
  AGE_ACK_KEY: 'next-bar:age-ack:v1',
  readAgeAck: () => acked,
  writeAgeAck: vi.fn(),
  clearAgeAck: () => {
    ackCleared += 1;
  },
}));

import OnboardingAgePage from './page';

type Rendered = ReturnType<typeof render>;

async function takeTheExit(): Promise<Rendered> {
  const view = render(<OnboardingAgePage />);
  await userEvent.click(
    await screen.findByRole('button', { name: /under 21/i }),
  );
  await screen.findByRole('heading', { name: /next bar is for ages 21\+/i });
  return view;
}

beforeEach(() => {
  replaced.length = 0;
  pushed.length = 0;
  authStatus = 'signed-in';
  signOut = async () => {};
  acked = false;
  ackCleared = 0;
  window.history.replaceState({}, '', '/onboarding/age');
});

describe('the 21+ confirmation', () => {
  test('asks once, and asks a device that already answered nothing at all', async () => {
    // The global AgeGate overlay writes the same device key. A device that met
    // it first must not be asked the same question a second time here — it
    // gets a single Continue instead. This is also the drift guard on the two
    // copies of the key: point `../_ageAck` at a different one and the real
    // module stops seeing the overlay's ack.
    acked = true;
    render(<OnboardingAgePage />);
    expect(
      await screen.findByRole('button', { name: /^Continue$/i }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /21 or older/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /under 21/i })).toBeNull();
  });

  test('collects no birthdate — one tap confirms', async () => {
    render(<OnboardingAgePage />);
    await screen.findByRole('button', { name: /21 or older/i });
    expect(screen.queryByLabelText(/birth/i)).toBeNull();
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });
});

describe('the under-21 exit', () => {
  test('claims the sign-out only once the session is actually gone', async () => {
    const view = await takeTheExit();
    // The call has resolved, but the session is still there: a resolved
    // `signOut()` is not evidence, so nothing may claim success yet.
    expect(screen.queryByText(/we.ve signed you out/i)).toBeNull();
    expect(screen.getByText(/signing you out/i)).toBeTruthy();

    authStatus = 'signed-out';
    view.rerender(<OnboardingAgePage />);
    await waitFor(() =>
      expect(
        screen.getByText(/we.ve signed you out of this device/i),
      ).toBeTruthy(),
    );
  });

  test('a THROWN sign-out is reported as a failure, not as a success', async () => {
    signOut = async () => {
      throw new Error('network');
    };
    await takeTheExit();
    await waitFor(() =>
      expect(screen.getByText(/still signed in on this device/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/we.ve signed you out/i)).toBeNull();
  });

  test('a visitor who was never signed in is told nothing about a sign-out', async () => {
    authStatus = 'signed-out';
    const spy = vi.fn(async () => {});
    signOut = spy;

    await takeTheExit();
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByText(/sign(ing|ed) you out/i)).toBeNull();
  });

  test('claims nothing while the session status is still unknown', async () => {
    // The tap can land before auth settles. Signing out a session that is not
    // there resolves happily, so say nothing rather than something false.
    authStatus = 'loading';
    await takeTheExit();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /ages 21\+/i })).toBeTruthy(),
    );
    expect(screen.queryByText(/we.ve signed you out/i)).toBeNull();
  });

  test('?under21=1 opens the exit directly, without asking again', async () => {
    // The global AgeGate overlay hands the answer here rather than growing a
    // second copy of this screen.
    window.history.replaceState({}, '', '/onboarding/age?under21=1');
    render(<OnboardingAgePage />);
    await screen.findByRole('heading', { name: /next bar is for ages 21\+/i });
    expect(screen.queryByRole('button', { name: /21 or older/i })).toBeNull();
    expect(replaced).toEqual([]);
  });

  test('a failed sign-out offers another attempt, never "close the tab"', async () => {
    // supabase-js persists the session in browser storage and returns the
    // error WITHOUT clearing it, so "close this tab to end the session" is
    // advice that does not work. What is offered instead is another attempt,
    // and it has to actually re-call signOut.
    let attempts = 0;
    signOut = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('network');
    };

    const view = await takeTheExit();
    await waitFor(() =>
      expect(screen.getByText(/still signed in on this device/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/close this tab/i)).toBeNull();

    await userEvent.click(
      screen.getByRole('button', { name: /try signing out again/i }),
    );
    authStatus = 'signed-out';
    view.rerender(<OnboardingAgePage />);
    await waitFor(() =>
      expect(
        screen.getByText(/we.ve signed you out of this device/i),
      ).toBeTruthy(),
    );
    expect(attempts).toBe(2);
  });

  test('discloses the account it cannot delete, and how to have it deleted', async () => {
    await takeTheExit();
    expect(
      screen.getByText(/if you already created an account, it still exists/i),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: /hi@next-bar\.app/i })
        .getAttribute('href'),
    ).toContain('mailto:hi@next-bar.app');
    // …and it never claims the signup was undone.
    expect(screen.queryByText(/nothing you entered here is stored/i)).toBeNull();
    expect(
      screen.getByText(/nothing you entered on this screen is stored/i),
    ).toBeTruthy();
  });

  test('the exit is terminal — it navigates nowhere on its own', async () => {
    await takeTheExit();
    expect(replaced).toEqual([]);
    expect(pushed).toEqual([]);
  });

  /**
   * The device ack is WITHDRAWN by the exit.
   *
   * The gap this closes: the global AgeGate overlay on `/` writes the same
   * key and stays down for an acknowledged device. A device that confirmed
   * 21+ there, then answered "under 21" here, kept its ack and could reach the
   * app again — and the sign-out cannot be relied on to stop it, because
   * `useAuth().signOut()` returns `Promise<void>` and swallows the provider
   * error. Clearing the ack is the half of the exit that cannot fail.
   */
  test('withdraws the device 21+ acknowledgement', async () => {
    await takeTheExit();
    expect(ackCleared).toBe(1);
  });

  test('withdraws it on the deep-linked exit too', async () => {
    // The overlay hands its answer here via ?under21=1, and that path must not
    // be the one that leaves the ack standing.
    window.history.replaceState({}, '', '/onboarding/age?under21=1');
    render(<OnboardingAgePage />);
    await screen.findByRole('heading', { name: /next bar is for ages 21\+/i });
    expect(ackCleared).toBe(1);
  });

  test('withdraws it even when the sign-out fails', async () => {
    signOut = async () => {
      throw new Error('network');
    };
    await takeTheExit();
    await waitFor(() =>
      expect(screen.getByText(/still signed in on this device/i)).toBeTruthy(),
    );
    expect(ackCleared).toBe(1);
  });
});
