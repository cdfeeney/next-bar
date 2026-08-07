import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: vi.fn() }));

import { getBrowserSupabase } from '@/lib/supabase/client';
import { AUTH_COPY } from '@/lib/authErrors';
import AuthPage from './page';

const getSupabaseMock = vi.mocked(getBrowserSupabase);

/**
 * The operator-visible regression: /auth rendered `error.message` verbatim,
 * so a failed fetch in the iOS WebView showed the bare WebKit string
 * "Load failed". Every path that can surface an SDK error is pinned here.
 *
 * NETWORK_ERROR is the exact shape auth-js produces for that failure —
 * `_handleRequest` catches the engine's TypeError and rethrows
 * `AuthRetryableFetchError(e.message, 0)`.
 */
const NETWORK_ERROR = new AuthRetryableFetchError('Load failed', 0);

type AuthStub = {
  resetPasswordForEmail?: ReturnType<typeof vi.fn>;
  signUp?: ReturnType<typeof vi.fn>;
  signInWithPassword?: ReturnType<typeof vi.fn>;
};

function stubAuth(auth: AuthStub): void {
  getSupabaseMock.mockReturnValue({
    auth: {
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      ...auth,
    },
  } as unknown as ReturnType<typeof getBrowserSupabase>);
}

async function fillEmail(value = 'connor@example.com'): Promise<void> {
  await userEvent.type(screen.getByPlaceholderText('you@example.com'), value);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/auth');
});

describe('/auth — forgot password never renders a raw SDK message', () => {
  it('shows connection guidance instead of "Load failed"', async () => {
    stubAuth({ resetPasswordForEmail: vi.fn().mockResolvedValue({ error: NETWORK_ERROR }) });
    render(<AuthPage />);

    await userEvent.click(screen.getByRole('button', { name: /forgot your password/i }));
    await fillEmail();
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(AUTH_COPY.network);
    expect(screen.queryByText(/load failed/i)).not.toBeInTheDocument();
    // A transport failure must not be mistaken for a sent email.
    expect(screen.queryByText(/check your inbox/i)).not.toBeInTheDocument();
  });

  it('keeps the rate-limit distinction rather than collapsing to generic copy', async () => {
    stubAuth({
      resetPasswordForEmail: vi
        .fn()
        .mockResolvedValue({ error: new AuthApiError('x', 429, 'over_email_send_rate_limit') }),
    });
    render(<AuthPage />);

    await userEvent.click(screen.getByRole('button', { name: /forgot your password/i }));
    await fillEmail();
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/rate limit/i);
  });

  it('renders generic app copy — not the message — for an unrecognised failure', async () => {
    stubAuth({
      resetPasswordForEmail: vi.fn().mockResolvedValue({
        error: new AuthApiError('relation "auth.users" does not exist', 500, undefined),
      }),
    });
    render(<AuthPage />);

    await userEvent.click(screen.getByRole('button', { name: /forgot your password/i }));
    await fillEmail();
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_COPY.generic);
    expect(screen.queryByText(/relation/i)).not.toBeInTheDocument();
  });

  it('success shows the sent state and does NOT change the URL', async () => {
    stubAuth({ resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }) });
    render(<AuthPage />);

    await userEvent.click(screen.getByRole('button', { name: /forgot your password/i }));
    await fillEmail();
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    // Negative assertion (CLAUDE.md): a successful reset request is an
    // in-place state change, never a navigation.
    expect(window.location.pathname).toBe('/auth');
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

describe('/auth — sign in never renders a raw SDK message', () => {
  it('maps a transport failure to connection guidance', async () => {
    stubAuth({ signInWithPassword: vi.fn().mockResolvedValue({ error: NETWORK_ERROR }) });
    render(<AuthPage />);

    await fillEmail();
    await userEvent.type(screen.getByPlaceholderText('Password'), 'hunter22');
    await userEvent.click(screen.getByRole('button', { name: /^Sign in →$/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(AUTH_COPY.network);
    expect(screen.queryByText(/load failed/i)).not.toBeInTheDocument();
  });

  it('preserves the invalid-credentials guidance', async () => {
    stubAuth({
      signInWithPassword: vi
        .fn()
        .mockResolvedValue({ error: new AuthApiError('Invalid login credentials', 400, undefined) }),
    });
    render(<AuthPage />);

    await fillEmail();
    await userEvent.type(screen.getByPlaceholderText('Password'), 'wrongpass');
    await userEvent.click(screen.getByRole('button', { name: /^Sign in →$/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/wrong email or password/i);
  });

  it('preserves the unconfirmed-email guidance', async () => {
    stubAuth({
      signInWithPassword: vi.fn().mockResolvedValue({
        error: new AuthApiError('Email not confirmed', 400, 'email_not_confirmed'),
      }),
    });
    render(<AuthPage />);

    await fillEmail();
    await userEvent.type(screen.getByPlaceholderText('Password'), 'hunter22');
    await userEvent.click(screen.getByRole('button', { name: /^Sign in →$/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/verification link/i);
  });

  it('renders generic copy for an unrecognised sign-in failure', async () => {
    stubAuth({
      signInWithPassword: vi
        .fn()
        .mockResolvedValue({ error: new AuthApiError('pq: deadlock detected', 500, undefined) }),
    });
    render(<AuthPage />);

    await fillEmail();
    await userEvent.type(screen.getByPlaceholderText('Password'), 'hunter22');
    await userEvent.click(screen.getByRole('button', { name: /^Sign in →$/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_COPY.generic);
    expect(screen.queryByText(/deadlock/i)).not.toBeInTheDocument();
  });
});

describe('/auth — sign up never renders a raw SDK message', () => {
  it('maps a transport failure to connection guidance', async () => {
    stubAuth({ signUp: vi.fn().mockResolvedValue({ data: { user: null }, error: NETWORK_ERROR }) });
    render(<AuthPage />);

    await userEvent.click(screen.getByRole('button', { name: /create an account/i }));
    await fillEmail('new@example.com');
    await userEvent.type(screen.getByPlaceholderText(/Choose a password/), 'hunter22');
    await userEvent.click(screen.getByRole('button', { name: /^Create account →$/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(AUTH_COPY.network);
    expect(screen.queryByText(/load failed/i)).not.toBeInTheDocument();
  });

  it('keeps the already-registered guidance from the zero-identities signal', async () => {
    stubAuth({
      signUp: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: 'u1', identities: [] } }, error: null }),
    });
    render(<AuthPage />);

    await userEvent.click(screen.getByRole('button', { name: /create an account/i }));
    await fillEmail('taken@example.com');
    await userEvent.type(screen.getByPlaceholderText(/Choose a password/), 'hunter22');
    await userEvent.click(screen.getByRole('button', { name: /^Create account →$/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already has an account/i);
  });
});

describe('/auth — callback banner', () => {
  it('gives cross-browser guidance for the PKCE sentinel, not "expired"', async () => {
    window.history.replaceState({}, '', '/auth?error=pkce_code_verifier_not_found');
    stubAuth({});
    render(<AuthPage />);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/same device and browser/i);
    // The precise regression: this must NOT claim the link expired.
    expect(banner).not.toHaveTextContent(/expired/i);
    expect(banner).not.toHaveTextContent(/already used/i);
  });

  it('still shows expired guidance for a genuinely expired link', async () => {
    window.history.replaceState({}, '', '/auth?error=otp_expired');
    stubAuth({});
    render(<AuthPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/expired or was already used/i);
  });

  it('strips the error param so a refresh cannot re-show a stale banner', async () => {
    window.history.replaceState({}, '', '/auth?error=otp_expired');
    stubAuth({});
    render(<AuthPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/auth', { scroll: false }));
  });
});
