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
/**
 * Mutable so a test can put the identity read in its FAILED state. It used to
 * be a frozen `known: true`, which meant the screen's not-loaded branches —
 * the ones a real network failure lands on — were never rendered by any test.
 */
const ownProfileRetry = vi.fn();
let ownProfile = {
  handle: null as string | null,
  displayName: 'Alice' as string | null,
  isPrivate: false as boolean | null,
  known: true,
  failed: false,
  consentLive: true,
};
vi.mock('../_useOwnProfile', () => ({
  useOwnProfile: () => ({
    ...ownProfile,
    retry: ownProfileRetry,
    setHandle: vi.fn(),
    setDisplayName: vi.fn(),
    setIsPrivate: vi.fn(),
  }),
}));
let storedVibe: {
  archetype: string;
  tags: string[];
  preferredNeighborhoods: string[];
  savedAt: string;
} | null = null;
vi.mock('@/lib/storedProfile', () => ({
  loadProfile: () => storedVibe,
  clearProfile: vi.fn(),
}));
// The two editors are out of this lane's write scope; what matters here is
// that they bubble `input` events (any real text field does) and that they
// report a save upward through the callback the page passes them.
vi.mock('@/components/DisplayNameEditor', () => ({
  default: ({ onSaved }: { onSaved: (name: string) => void }) => (
    <>
      <input aria-label="Account name" />
      <button type="button" onClick={() => onSaved('Alicia')}>
        Save name
      </button>
    </>
  ),
}));
vi.mock('@/components/ClaimHandle', () => ({
  default: ({ onClaimed }: { onClaimed: (handle: string) => void }) => (
    <>
      <input aria-label="Username" />
      <button type="button" onClick={() => onClaimed('alicia')}>
        Claim username
      </button>
    </>
  ),
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

  test('saving one editor does not disarm the guard over the other', async () => {
    // One page-level dirty flag was set by input from EITHER editor and
    // cleared by a save from either, so saving the name silently disarmed the
    // guard while the username draft was still on screen and Back lost it.
    render(<EditProfilePage />);

    await userEvent.type(screen.getByLabelText(/account name/i), 'Alicia');
    await userEvent.type(screen.getByLabelText('Username'), 'alicia');
    await userEvent.click(screen.getByRole('button', { name: /save name/i }));

    await userEvent.click(backLink());

    await waitFor(() => expect(discardDialog()).toBeTruthy());
  });

  test('stops guarding once every editor has been saved', async () => {
    // The mirror of the test above: per-editor flags must still CLEAR, or the
    // prompt becomes noise that people learn to tap through.
    render(<EditProfilePage />);

    await userEvent.type(screen.getByLabelText(/account name/i), 'Alicia');
    await userEvent.type(screen.getByLabelText('Username'), 'alicia');
    await userEvent.click(screen.getByRole('button', { name: /save name/i }));
    await userEvent.click(screen.getByRole('button', { name: /claim username/i }));

    await userEvent.click(backLink());

    expect(discardDialog()).toBeNull();
  });

  test('guards the in-page quiz link, not only the back arrow', async () => {
    // The Vibe profile row navigates away from inside the form. As a plain
    // link it walked off with unsaved text and no prompt: the guard was not
    // weak there, it was absent.
    render(<EditProfilePage />);

    await userEvent.type(screen.getByLabelText(/account name/i), 'Alicia');
    await userEvent.click(screen.getByRole('link', { name: /take the quiz/i }));

    await waitFor(() => expect(discardDialog()).toBeTruthy());
    // Discard finishes the trip that was intercepted rather than dumping the
    // user back on the settings list they never asked for.
    expect(
      screen.getByRole('link', { name: /^discard$/i }).getAttribute('href'),
    ).toBe('/quiz');
  });
});

describe('V8-R-ACC-004 — the saved vibe profile can be VIEWED, not just retaken', () => {
  test('shows the derived profile when the quiz has been taken', async () => {
    // The row used to say only "Your quiz answers are saved" and link to a NEW
    // quiz, so the footnote promised a view the screen did not have.
    storedVibe = {
      archetype: 'Late-night wanderer',
      tags: ['dive', 'live-music'],
      preferredNeighborhoods: ['East Village'],
      savedAt: '2026-08-01T00:00:00.000Z',
    };
    try {
      render(<EditProfilePage />);

      await waitFor(() =>
        expect(screen.getByText('Late-night wanderer')).toBeInTheDocument(),
      );
      expect(screen.getByText(/dive · live-music/)).toBeInTheDocument();
      expect(screen.getByText(/East Village/)).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /retake the quiz/i }),
      ).toBeInTheDocument();
    } finally {
      storedVibe = null;
    }
  });

  test('says so plainly when there is nothing to view yet', () => {
    render(<EditProfilePage />);

    expect(screen.getByText('No vibe profile yet.')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /take the quiz/i }),
    ).toBeInTheDocument();
  });
});

describe('V8-R-OPS-001 / -007 — a failed identity read is not a permanent "Loading…"', () => {
  const readState = (next: { known: boolean; failed: boolean }): void => {
    ownProfile = { ...ownProfile, ...next };
  };

  test('offers ONE retry, naming the failure, once the silent budget is spent', async () => {
    // The regression this pins: `known` went true only on success, so a single
    // failed read left BOTH identity slots showing "Loading…" for the life of
    // the mount — no message, no retry, no end.
    readState({ known: false, failed: true });
    try {
      render(<EditProfilePage />);

      const states = screen.getAllByTestId('operational-state');
      // One per identity slot (display name, username), each carrying at most
      // one recovery — the shared component's own contract.
      expect(states).toHaveLength(2);
      for (const state of states) {
        expect(state.getAttribute('data-state')).toBe('failed');
      }
      expect(screen.queryByText('Loading…')).toBeNull();
      expect(
        screen.getAllByText(/couldn't load your profile/i).length,
      ).toBeGreaterThan(0);

      const retries = screen.getAllByRole('button', { name: /retry/i });
      await userEvent.click(retries[0]);
      expect(ownProfileRetry).toHaveBeenCalled();
    } finally {
      readState({ known: true, failed: false });
      ownProfileRetry.mockClear();
    }
  });

  test('still says "Loading…" while attempts remain — the budget is not spent', () => {
    // The negative half: an in-flight read must NOT be dressed as a failure,
    // or the screen asks the user to fix something that is still working.
    readState({ known: false, failed: false });
    try {
      render(<EditProfilePage />);

      expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);
      expect(screen.queryByTestId('operational-state')).toBeNull();
      expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    } finally {
      readState({ known: true, failed: false });
    }
  });
});
