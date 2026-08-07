import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: vi.fn() }));

import { getBrowserSupabase } from '@/lib/supabase/client';
import { AUTH_COPY } from '@/lib/authErrors';
import SetPassword from './SetPassword';

const getSupabaseMock = vi.mocked(getBrowserSupabase);

/**
 * SetPassword is the SECOND place the operator could have seen "Load failed":
 * it is the step that runs *after* the recovery link lands, so a transport
 * blip here reads as "the reset itself is broken". It rendered
 * `error.message` verbatim for everything except the same-password case.
 */
function stubUpdateUser(result: unknown): ReturnType<typeof vi.fn> {
  const updateUser = vi.fn().mockResolvedValue(result);
  getSupabaseMock.mockReturnValue({ auth: { updateUser } } as unknown as ReturnType<
    typeof getBrowserSupabase
  >);
  return updateUser;
}

async function submitPassword(value = 'brand-new-pass'): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /set a password/i }));
  await userEvent.type(screen.getByPlaceholderText(/New password/), value);
  await userEvent.click(screen.getByRole('button', { name: /save password/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SetPassword — never renders a raw SDK message', () => {
  it('shows connection guidance instead of "Load failed"', async () => {
    stubUpdateUser({ error: new AuthRetryableFetchError('Load failed', 0) });
    render(<SetPassword />);

    await submitPassword();

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_COPY.network);
    expect(screen.queryByText(/load failed/i)).not.toBeInTheDocument();
  });

  it('preserves the same-password message', async () => {
    stubUpdateUser({
      error: new AuthApiError(
        'New password should be different from the old password.',
        422,
        'same_password',
      ),
    });
    render(<SetPassword />);

    await submitPassword();

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_COPY.samePassword);
  });

  it('renders generic copy for an unrecognised failure', async () => {
    stubUpdateUser({ error: new AuthApiError('pq: relation missing', 500, undefined) });
    render(<SetPassword />);

    await submitPassword();

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_COPY.generic);
    expect(screen.queryByText(/relation missing/i)).not.toBeInTheDocument();
  });

  it('confirms success without an alert', async () => {
    const updateUser = stubUpdateUser({ error: null });
    render(<SetPassword />);

    await submitPassword();

    expect(await screen.findByText(/password set/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(updateUser).toHaveBeenCalledWith({ password: 'brand-new-pass' });
  });

  it('blocks a short password before any request', async () => {
    const updateUser = stubUpdateUser({ error: null });
    render(<SetPassword />);

    await submitPassword('abc');

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 6 characters/i);
    expect(updateUser).not.toHaveBeenCalled();
  });
});
