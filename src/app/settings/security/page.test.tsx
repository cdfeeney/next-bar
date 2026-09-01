import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeletionOutcome } from './_deleteRequest';

/** What the (mocked) delete request reports for the test in hand. */
let deletionOutcome: DeletionOutcome = 'deleted';

/**
 * Security & account — V8-R-ACC-012's typed confirmation and, inside it,
 * V8-R-GRP-009's enumeration of group memberships.
 *
 * The enumeration is the requirement, not decoration: "the confirmation
 * ENUMERATES what is destroyed". A generic "this cannot be undone" satisfies
 * nobody, and the previous version of this screen silently omitted posts and
 * stories from the list while the account deletion cascade destroyed them.
 * Each clause is asserted separately so dropping one fails loudly.
 */

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    status: 'signed-in',
    user: { id: 'me', email: 'me@example.com' },
    session: { access_token: 'token' },
    signOut: vi.fn(),
  }),
}));
vi.mock('@/hooks/useRatings', () => ({
  useRatings: () => ({ ratings: [] }),
  drainBarWrites: vi.fn(async () => {}),
}));
vi.mock('@/components/SetPassword', () => ({ default: () => null }));
vi.mock('@/lib/accountCache', () => ({
  abandonInFlightSyncs: vi.fn(),
  destroyAccountDataOnDeletion: vi.fn(),
  // The real registered key, not a stand-in: the persistence test below is
  // about the value that actually survives a remount.
  DELETION_UNCERTAIN_KEY: 'next-bar:account:deletion-uncertain:v1',
}));
/**
 * The mock HONOURS `afterUnknown` rather than ignoring it. A mock that drops
 * the argument cannot tell a correct caller from one that forgets the flag,
 * and the cancel-then-retry defect below passed a green suite for exactly
 * that reason.
 */
const seenAfterUnknown: boolean[] = [];
vi.mock('./_deleteRequest', () => ({
  requestAccountDeletionOutcome: vi.fn(async (_token: string, afterUnknown = false) => {
    seenAfterUnknown.push(afterUnknown);
    // Mirrors the real classifier: once an attempt has ended unknown, nothing
    // short of a confirmed deletion is certain again.
    return afterUnknown && deletionOutcome !== 'deleted' ? 'unknown' : deletionOutcome;
  }),
}));
vi.mock('@/lib/pairwise.server', () => ({
  deleteAllServerComparisons: vi.fn(async () => true),
}));
vi.mock('@/lib/ratings.server', () => ({
  deleteAllServerRatings: vi.fn(async () => true),
}));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => null }));

import SecurityAccountPage from './page';

beforeEach(() => {
  deletionOutcome = 'deleted';
  seenAfterUnknown.length = 0;
  // The uncertainty latch is now STORED, so it outlives a test that does not
  // clear it — which is the whole point of the change, and exactly why the
  // suite has to reset it between cases. Both stores: the latch falls back to
  // sessionStorage when localStorage refuses.
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const dangerZone = (): HTMLElement =>
  screen.getByRole('heading', { name: /danger zone/i })
    .parentElement as HTMLElement;

describe('V8-R-ACC-012 — the deletion confirmation enumerates what is destroyed', () => {
  it.each([
    /profile, photo\s+and @username/i,
    /posts, stories and night recaps/i,
    /friendships,\s+followers and group memberships/i,
    /ratings, saved bars and account data/i,
    /there is no undo/i,
  ])('names %s', (pattern) => {
    render(<SecurityAccountPage />);

    expect(within(dangerZone()).getByText(pattern)).toBeInTheDocument();
  });

  it('states the V8-R-GRP-009 succession rule, not just the loss of membership', () => {
    render(<SecurityAccountPage />);

    expect(
      within(dangerZone()).getByText(/longest-standing remaining member/i),
    ).toBeInTheDocument();
  });
});

describe('V8-R-ACC-012 — deletion requires typing DELETE in full', () => {
  it('keeps the destructive button unavailable until the word is complete', async () => {
    render(<SecurityAccountPage />);

    await userEvent.click(
      screen.getByRole('button', { name: /^Delete account$/i }),
    );

    const confirm = screen.getByRole('button', { name: /permanently delete/i });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/type/i), 'DELET');
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/type/i), 'E');
    expect(confirm).toBeEnabled();
  });

  /**
   * The gate is EXACTLY the word the label prints. The previous check was
   * `trim().toLowerCase()`, so "delete" and " DELETE " both armed an
   * irreversible, all-or-nothing action the screen said required DELETE.
   * These are the two inputs that used to pass and must not.
   */
  it.each(['delete', 'Delete', ' DELETE ', 'DELETE '])(
    'refuses %p, which is not the word the label asks for',
    async (typed) => {
      render(<SecurityAccountPage />);

      await userEvent.click(
        screen.getByRole('button', { name: /^Delete account$/i }),
      );
      await userEvent.type(screen.getByLabelText(/type/i), typed);

      expect(
        screen.getByRole('button', { name: /permanently delete/i }),
      ).toBeDisabled();
    },
  );

  it('makes Cancel the larger of the two buttons', async () => {
    // "Cancel is the larger, more prominent of the two" is a stated
    // requirement, and the destructive control is outlined while the safe one
    // is not — so the sizes are asserted rather than eyeballed.
    render(<SecurityAccountPage />);

    await userEvent.click(
      screen.getByRole('button', { name: /^Delete account$/i }),
    );

    const cancel = screen.getByRole('button', { name: /^Cancel$/i });
    const confirm = screen.getByRole('button', { name: /permanently delete/i });
    expect(cancel.className).toContain('min-h-[48px]');
    expect(confirm.className).toContain('min-h-[44px]');
  });
});

/**
 * V8-R-OPS-001 — never present a fallback as a success, and never present a
 * GUESS as a fact.
 *
 * The defect this pins: every non-success collapsed onto one boolean, so the
 * danger zone answered "nothing was removed" to both a refusal and a lost
 * response. The route deletes the auth user and only THEN writes its reply, so
 * a connection dropped in between is precisely the case where the account is
 * most likely already gone — and the screen told its owner it had survived.
 * Being told your account still exists when it does not is worse than being
 * told nothing, because you stop looking.
 */
describe('V8-R-ACC-012 — the deletion result says only what is known', () => {
  const armAndDelete = async (): Promise<void> => {
    render(<SecurityAccountPage />);
    await userEvent.click(
      screen.getByRole('button', { name: /^Delete account$/i }),
    );
    await userEvent.type(screen.getByLabelText(/type/i), 'DELETE');
    await userEvent.click(
      screen.getByRole('button', { name: /permanently delete/i }),
    );
  };

  it('reports a server refusal as nothing removed, which is what happened', async () => {
    deletionOutcome = 'refused';

    await armAndDelete();

    await waitFor(() =>
      expect(screen.getByText(/nothing was removed/i)).toBeTruthy(),
    );
  });

  it('refuses to claim "nothing was removed" when the answer was lost', async () => {
    deletionOutcome = 'unknown';

    await armAndDelete();

    await waitFor(() =>
      expect(
        screen.getByText(/couldn.t confirm whether your account was deleted/i),
      ).toBeTruthy(),
    );
    // The exact false assurance the old single-boolean path printed here.
    expect(screen.queryByText(/nothing was removed/i)).toBeNull();
  });

  it('tells an unknown outcome how to find out, rather than to just retry', async () => {
    // A blind retry against an account that is already gone answers 401 and
    // reads as a second failure. Checking comes first.
    deletionOutcome = 'unknown';

    await armAndDelete();

    await waitFor(() =>
      expect(screen.getByText(/may\s+already be gone/i)).toBeTruthy(),
    );
    expect(screen.getByText(/try to sign in to check/i)).toBeTruthy();
  });

  it('remembers an unknown outcome across Cancel, so a re-armed retry cannot claim a refusal', async () => {
    // The flag was first derived from the transient view state, which Cancel
    // resets to 'idle'. So: attempt ends unknown -> Cancel -> re-arm -> retry
    // asked as if it were a FIRST attempt, the dead token produced the route's
    // `unauthorized`, and the screen printed "nothing was removed" over an
    // account the first attempt may already have destroyed. Whether an earlier
    // attempt left the account's fate open is a fact about the SESSION, not
    // about what is currently on screen.
    deletionOutcome = 'unknown';
    await armAndDelete();
    await waitFor(() => expect(seenAfterUnknown).toEqual([false]));

    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));

    // Re-arm and retry. The server now refuses outright.
    deletionOutcome = 'refused';
    await userEvent.click(
      screen.getByRole('button', { name: /^Delete account$/i }),
    );
    await userEvent.type(screen.getByLabelText(/type/i), 'DELETE');
    await userEvent.click(
      screen.getByRole('button', { name: /permanently delete/i }),
    );

    // The retry must be asked as a retry …
    await waitFor(() => expect(seenAfterUnknown).toEqual([false, true]));
    // … and the screen must not go back to the confident sentence.
    expect(screen.queryByText(/nothing was removed/i)).toBeNull();
  });

  it('remembers an unknown outcome across a REMOUNT — the reload it recommends', async () => {
    // The same root cause one step further out, and the reason the latch is
    // now stored rather than held in `useState`. The unknown message tells the
    // user to RELOAD and try to sign in; a cached JWT then re-renders this
    // screen signed-in with a fresh mount, and a mount-scoped flag is gone.
    // The retry's `unauthorized` — which is precisely what a DELETED user's
    // token produces — then read as a certain refusal and reprinted "nothing
    // was removed" over an account that no longer exists.
    deletionOutcome = 'unknown';
    const first = render(<SecurityAccountPage />);
    await userEvent.click(
      screen.getByRole('button', { name: /^Delete account$/i }),
    );
    await userEvent.type(screen.getByLabelText(/type/i), 'DELETE');
    await userEvent.click(
      screen.getByRole('button', { name: /permanently delete/i }),
    );
    await waitFor(() => expect(seenAfterUnknown).toEqual([false]));

    // Everything React was holding goes away. Only storage survives.
    first.unmount();

    deletionOutcome = 'refused';
    render(<SecurityAccountPage />);
    await userEvent.click(
      screen.getByRole('button', { name: /^Delete account$/i }),
    );
    await userEvent.type(screen.getByLabelText(/type/i), 'DELETE');
    await userEvent.click(
      screen.getByRole('button', { name: /permanently delete/i }),
    );

    await waitFor(() => expect(seenAfterUnknown).toEqual([false, true]));
    expect(screen.queryByText(/nothing was removed/i)).toBeNull();
  });

  it('sees an unknown outcome recorded by ANOTHER TAB after this one mounted', async () => {
    // A seed taken at mount is correct for exactly one instant. Two tabs on
    // the same account: tab A's attempt ends unknown, tab B was already open
    // and still holds the seed it read before that happened, so B's retry gets
    // asked as a first attempt and the deleted user's 401 reprints "nothing
    // was removed". The fix is to read the fact at the moment of the attempt,
    // which has no staleness window at all.
    render(<SecurityAccountPage />);

    // Tab A, elsewhere, ends unknown for this same user.
    window.localStorage.setItem(
      'next-bar:account:deletion-uncertain:v1',
      'me',
    );

    deletionOutcome = 'refused';
    await userEvent.click(
      screen.getByRole('button', { name: /^Delete account$/i }),
    );
    await userEvent.type(screen.getByLabelText(/type/i), 'DELETE');
    await userEvent.click(
      screen.getByRole('button', { name: /permanently delete/i }),
    );

    await waitFor(() => expect(seenAfterUnknown).toEqual([true]));
    expect(screen.queryByText(/nothing was removed/i)).toBeNull();
  });

  it('falls back to sessionStorage when localStorage refuses the write', async () => {
    // The latch was back to mount-scoped whenever localStorage threw — a full
    // or blocked store — and the unknown message tells the user to RELOAD,
    // which is exactly what a mount-scoped fact does not survive.
    // sessionStorage has its own quota and survives that reload.
    //
    // The patch is an OWN property on the localStorage instance and is
    // DELETED afterwards, not reassigned: leaving an own `setItem` behind
    // shadows `Storage.prototype`, which is how the next test patches both
    // stores at once — and a restore that quietly disarms a later test is
    // worse than no restore at all.
    Object.defineProperty(window.localStorage, 'setItem', {
      configurable: true,
      value: () => {
        throw new DOMException('QuotaExceededError');
      },
    });
    try {
      deletionOutcome = 'unknown';
      await armAndDelete();
      await waitFor(() => expect(seenAfterUnknown).toEqual([false]));

      expect(
        window.sessionStorage.getItem('next-bar:account:deletion-uncertain:v1'),
      ).toBe('me');
      // And the screen does NOT claim it could not remember, because it could.
      expect(screen.queryByText(/wouldn.t let us remember/i)).toBeNull();
    } finally {
      delete (window.localStorage as unknown as Record<string, unknown>).setItem;
      window.sessionStorage.clear();
    }
  });

  it('says plainly when NO store would keep the uncertainty', async () => {
    // Both stores refusing is the one case nothing on the client can survive a
    // reload. The screen's own advice outlives the record, so it must not let
    // the next visit sound certain — it says the record was not kept.
    // Patched on the PROTOTYPE, which both stores share, so neither can take
    // the write. This only bites because the test above deletes its own-property
    // patch rather than reassigning it.
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };
    try {
      deletionOutcome = 'unknown';
      await armAndDelete();

      await waitFor(() =>
        expect(screen.getByText(/wouldn.t let us remember/i)).toBeTruthy(),
      );
      // The primary honest sentence is still there; this only adds to it.
      expect(
        screen.getByText(/couldn.t confirm whether your account was deleted/i),
      ).toBeTruthy();
      expect(screen.queryByText(/nothing was removed/i)).toBeNull();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('does not make a DIFFERENT account cautious — the latch names its user', async () => {
    // The negative half of "keyed to the user id". A latch that outlived its
    // session must not silently downgrade the next owner of this device to
    // permanent uncertainty about an account nothing ever tried to delete.
    window.localStorage.setItem(
      'next-bar:account:deletion-uncertain:v1',
      'someone-else',
    );
    deletionOutcome = 'refused';

    await armAndDelete();

    await waitFor(() => expect(seenAfterUnknown).toEqual([false]));
    expect(screen.getByText(/nothing was removed/i)).toBeTruthy();
  });
});

describe('V8-R-ACC-011 — sign out is an ordinary action, not a deletion', () => {
  it('keeps Sign out outside the danger zone', () => {
    render(<SecurityAccountPage />);

    expect(screen.getByRole('button', { name: /^Sign out$/i })).toBeInTheDocument();
    expect(within(dangerZone()).queryByRole('button', { name: /sign out/i })).toBeNull();
  });

  it('reports the session it can actually see, and claims no device count', () => {
    render(<SecurityAccountPage />);

    expect(screen.getByText('Active sessions')).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByText(/Email & password · Verified/i)).toBeInTheDocument();
  });
});
