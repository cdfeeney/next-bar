import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

/**
 * V8-R-ACC-006 failure_recovery — "leaving with unsaved edits raises 'Discard
 * changes?' with Keep editing as the default".
 *
 * The defect this pins: `StackHeader` rendered a plain link and nothing on the
 * Edit profile screen tracked dirty state, so a tap on Back walked away with
 * the typed edits and no prompt at all. Requirements that only bite when
 * something goes wrong are the ones that ship unimplemented.
 *
 * NOT `window.confirm`: the native dialog focuses OK, so its default answer is
 * the destructive one — the opposite of what the requirement asks for.
 */

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    status: 'signed-in',
    user: { id: 'alice' },
    signOut: vi.fn(),
  }),
}));
vi.mock('../_useOwnProfile', () => ({
  useOwnProfile: () => ({
    handle: null,
    displayName: 'Alice',
    isPrivate: false,
    known: true,
    consentLive: true,
    setHandle: vi.fn(),
    setDisplayName: vi.fn(),
    setIsPrivate: vi.fn(),
  }),
}));
vi.mock('@/lib/storedProfile', () => ({
  loadProfile: () => null,
  clearProfile: vi.fn(),
}));
// The two editors are out of this lane's write scope; what matters here is
// that they bubble `input` events, which any real text field does.
vi.mock('@/components/DisplayNameEditor', () => ({
  default: () => <input aria-label="Account name" />,
}));
vi.mock('@/components/ClaimHandle', () => ({
  default: () => <input aria-label="Username" />,
}));

import EditProfilePage from './page';

const backLink = (): HTMLElement => screen.getByRole('link', { name: /back/i });
const discardDialog = () =>
  screen.queryByRole('dialog', { name: /discard changes/i });

describe('leaving Edit profile with unsaved edits', () => {
  test('leaves immediately when nothing has been typed', async () => {
    render(<EditProfilePage />);

    await userEvent.click(backLink());

    expect(discardDialog()).toBeNull();
    // Nothing intercepted the navigation.
    expect(backLink().getAttribute('href')).toBe('/settings/preferences');
  });

  test('raises "Discard changes?" instead of walking away with the edits', async () => {
    render(<EditProfilePage />);

    await userEvent.type(screen.getByLabelText(/account name/i), 'Alicia');
    await userEvent.click(backLink());

    await waitFor(() => expect(discardDialog()).toBeTruthy());
  });

  test('makes Keep editing the default answer, and Discard the deliberate one', async () => {
    render(<EditProfilePage />);

    await userEvent.type(screen.getByLabelText(/account name/i), 'Alicia');
    await userEvent.click(backLink());
    await waitFor(() => expect(discardDialog()).toBeTruthy());

    const dialog = discardDialog() as HTMLElement;
    const keep = screen.getByRole('button', { name: /keep editing/i });
    const discard = screen.getByRole('link', { name: /^discard$/i });

    // Keep editing comes first in the dialog and is the filled control; the
    // destructive answer is the plain one below it.
    expect(dialog.contains(keep)).toBe(true);
    expect(keep.compareDocumentPosition(discard) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(keep.className).toContain('bg-accent');
    // Discard is a real navigation: the edits live in state that unmounts with
    // the route, so leaving IS discarding.
    expect(discard.getAttribute('href')).toBe('/settings/preferences');
  });

  test('Keep editing returns to the form with the typed value intact', async () => {
    render(<EditProfilePage />);

    const field = screen.getByLabelText(/account name/i);
    await userEvent.type(field, 'Alicia');
    await userEvent.click(backLink());
    await waitFor(() => expect(discardDialog()).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: /keep editing/i }));

    await waitFor(() => expect(discardDialog()).toBeNull());
    expect(screen.getByLabelText(/account name/i)).toHaveValue('Alicia');
  });

  test('Escape keeps editing rather than discarding', async () => {
    // The dialog contract's dismissal path must resolve to the SAFE answer.
    render(<EditProfilePage />);

    await userEvent.type(screen.getByLabelText(/account name/i), 'Alicia');
    await userEvent.click(backLink());
    await waitFor(() => expect(discardDialog()).toBeTruthy());

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(discardDialog()).toBeNull());
    expect(screen.getByLabelText(/account name/i)).toHaveValue('Alicia');
  });

  test('guards edits typed into the username field too, not just the name', async () => {
    // Both editors are watched — the guard is on the form region, not on one
    // favoured control.
    render(<EditProfilePage />);

    await userEvent.type(screen.getByLabelText('Username'), 'alicia');
    await userEvent.click(backLink());

    await waitFor(() => expect(discardDialog()).toBeTruthy());
  });
});
