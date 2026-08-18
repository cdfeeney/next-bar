import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Criterion 1, the half that browser storage cannot reach (cold-panel round 2,
 * Codex, HIGH).
 *
 * The invite handoff rode sessionStorage plus a short-TTL localStorage copy,
 * and `pendingInvite`'s own header says what that does NOT cover: Web Storage
 * is scoped to an origin within ONE browser profile. Open an invite in an
 * in-app browser, sign up, and confirm from the system mail app — the common
 * shape on a phone — and neither store exists when the callback runs. The
 * callback carried a fixed `/settings`, so the user was signed in and stranded.
 *
 * The confirmation URL is the only channel that crosses profiles, so the token
 * rides it. These tests pin that it is actually put there, and that a signup
 * with no invite pending is unaffected.
 */

const INVITE_TOKEN = '11111111-1111-4111-8111-111111111111';

let pending: string | null = null;
const signUp = vi.fn();
const resetPasswordForEmail = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/pendingInvite', () => ({
  peekPendingInvite: () => pending,
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({
    auth: {
      signUp: (...a: unknown[]) => signUp(...a),
      signInWithPassword: vi.fn(),
      resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...a),
    },
  }),
}));

import AuthPage from './page';

async function submitSignup(): Promise<void> {
  const user = userEvent.setup();
  render(<AuthPage />);
  await user.click(screen.getByRole('button', { name: /new here\? create an account/i }));
  await user.type(screen.getByPlaceholderText(/you@example\.com/i), 'new@example.com');
  await user.type(screen.getByPlaceholderText(/choose a password/i), 'hunter2!');
  await user.click(screen.getByRole('button', { name: /create account/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  pending = null;
  signUp.mockResolvedValue({ data: { user: { identities: [{}] } }, error: null });
  resetPasswordForEmail.mockResolvedValue({ error: null });
});

describe('the confirmation email carries the invite across browser profiles', () => {
  test('a pending invite becomes the callback destination', async () => {
    pending = INVITE_TOKEN;
    await submitSignup();
    await waitFor(() => expect(signUp).toHaveBeenCalled());

    const redirect = new URL(
      signUp.mock.calls[0][0].options.emailRedirectTo,
    ).searchParams.get('redirect_to');
    expect(
      redirect,
      'the confirmation link dropped the invite, so a cross-profile confirm lands nowhere near the plan',
    ).toBe(`/night-out/${INVITE_TOKEN}`);
  });

  test('no pending invite still lands on the default post-auth page', async () => {
    await submitSignup();
    await waitFor(() => expect(signUp).toHaveBeenCalled());

    const redirect = new URL(
      signUp.mock.calls[0][0].options.emailRedirectTo,
    ).searchParams.get('redirect_to');
    expect(redirect, 'an ordinary signup was rerouted').toBe('/settings');
  });

  test('the reset-password link does NOT carry it — recovery keeps its own destination', async () => {
    // Round 4 (Codex). The signup fix was applied to the reset flow too, and it
    // should not have been: a recovery link exists to get the user to the
    // account card's "Set a password", and sending them to the plan instead
    // skips the one step the flow is for. The invite handoff was authorized for
    // signup, not for every email this page sends.
    pending = INVITE_TOKEN;
    const user = userEvent.setup();
    render(<AuthPage />);
    await user.click(screen.getByRole('button', { name: /forgot your password/i }));
    await user.type(screen.getByPlaceholderText(/you@example\.com/i), 'new@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalled());

    const redirect = new URL(
      resetPasswordForEmail.mock.calls[0][1].redirectTo,
    ).searchParams.get('redirect_to');
    expect(
      redirect,
      'password recovery was rerouted away from the page that sets the password',
    ).toBe('/settings?from=recovery');
  });
});
