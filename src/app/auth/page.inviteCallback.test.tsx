import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * What the confirmation URL's `redirect_to` actually carries — and, since the
 * round-6 panel, what it does NOT.
 *
 * The invite handoff rides sessionStorage plus a short-TTL localStorage copy,
 * both scoped to one browser profile. `/auth` additionally puts the token in
 * the confirmation link's own `redirect_to` when a signup begins with an invite
 * pending.
 *
 * THAT IS NOT A CROSS-PROFILE FIX, and this file used to say it was — filed by
 * both lanes at round 7. `@supabase/ssr` hard-sets `flowType: "pkce"`
 * (`createBrowserClient.js`, `createServerClient.js`) and this project passes no
 * override, so `exchangeCodeForSession` needs the verifier held by the profile
 * that started the signup. Open the link in a system browser or a partitioned
 * mail webview and the exchange fails first: the user reaches `/auth?error=...`,
 * never the plan. No assertion below can see that, because they inspect the
 * URL Supabase was handed, not what happens when it is opened elsewhere.
 *
 * What these tests DO pin, and all they pin: signup with a pending invite puts
 * the plan in `redirect_to` (which is what lets an invite survive the 30-minute
 * localStorage TTL within one profile); signup without one keeps the default
 * post-auth page; and recovery keeps its own destination plus the marker that
 * stops the global handoff from overriding it.
 *
 * Acceptance criterion 1 is therefore MET for same-profile signup and OPEN for
 * cross-profile. See docs/V8-3-HANDOFF-2026-08-16b.md.
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

describe('what the confirmation email carries (same profile only — see the header)', () => {
  test('a pending invite becomes the callback destination', async () => {
    pending = INVITE_TOKEN;
    await submitSignup();
    await waitFor(() => expect(signUp).toHaveBeenCalled());

    const redirect = new URL(
      signUp.mock.calls[0][0].options.emailRedirectTo,
    ).searchParams.get('redirect_to');
    expect(
      redirect,
      'the confirmation link dropped the invite, so it cannot outlive the storage TTL',
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
