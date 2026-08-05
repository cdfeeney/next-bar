import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Current-device account deletion (Browser A of the cross-device fix):
 * the requesting browser must delete, sign out, and hard-redirect — and the
 * redirect must survive a signOut throw (the account no longer exists;
 * staying on a signed-in-looking page lies). Pins the acceptance criterion
 * "the requesting browser still deletes and redirects correctly."
 */

const h = vi.hoisted(() => ({
  requestAccountDeletionMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock('@/lib/accountDeletion', () => ({
  requestAccountDeletion: h.requestAccountDeletionMock,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    status: 'signed-in',
    user: { id: 'user-a', email: 'a@example.com' },
    session: { access_token: 'access-token-a' },
    signOut: h.signOutMock,
  }),
}));

vi.mock('@/hooks/useRatings', () => ({
  useRatings: () => ({ ratings: [] }),
}));
vi.mock('@/lib/useBars', () => ({ useBars: () => [] }));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => null }));
vi.mock('@/components/InstallPrompt', () => ({ default: () => null }));
vi.mock('@/components/SetPassword', () => ({ default: () => null }));
vi.mock('@/components/ClaimHandle', () => ({ default: () => null }));
vi.mock('@/components/DisplayNameEditor', () => ({ default: () => null }));

import SettingsPage from './page';

const assignMock = vi.fn();

describe('settings — current-device account deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requestAccountDeletionMock.mockResolvedValue(true);
    h.signOutMock.mockResolvedValue(undefined);
    // jsdom's location.assign is not implemented — replace wholesale.
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...window.location, assign: assignMock },
    });
  });

  async function armAndConfirm(): Promise<void> {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.type(screen.getByLabelText(/to confirm/i), 'delete');
    await user.click(
      screen.getByRole('button', { name: 'Permanently delete' }),
    );
  }

  it('deletes with the caller token, signs out, and hard-redirects to /', async () => {
    await armAndConfirm();

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/'));
    expect(h.requestAccountDeletionMock).toHaveBeenCalledWith(
      'access-token-a',
    );
    expect(h.signOutMock).toHaveBeenCalledTimes(1);
  });

  it('still redirects when signOut throws — the account is already gone', async () => {
    h.signOutMock.mockRejectedValue(new Error('logout endpoint 403'));

    await armAndConfirm();

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/'));
  });

  it('a failed deletion signs nothing out and stays on the page with an error', async () => {
    h.requestAccountDeletionMock.mockResolvedValue(false);

    await armAndConfirm();

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        /Couldn't delete your account/i,
      ),
    );
    expect(h.signOutMock).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
  });
});
