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
}));
/**
 * The classifier takes only a token now. It used to carry an `afterUnknown`
 * flag — the client's memory of its own uncertainty — which the cycle-5
 * redesign removed by making `/api/account/delete` answer a validly signed
 * token whose user is gone with success.
 */
vi.mock('./_deleteRequest', () => ({
  requestAccountDeletionOutcome: vi.fn(async () => deletionOutcome),
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
  vi.clearAllMocks();
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

  /**
   * THE SIX TESTS THAT USED TO FOLLOW ARE GONE WITH THE THING THEY PINNED.
   *
   * They asserted that this screen REMEMBERED an unknown outcome — across
   * Cancel, across a remount, across tabs, into sessionStorage when
   * localStorage refused, and not into another account's view. Every one was a
   * correct rule about a client-side latch that existed only because a retry's
   * `unauthorized` meant both "you were never signed in" and "the account is
   * already gone".
   *
   * `/api/account/delete` now answers a validly signed token whose user is
   * gone with success (`route.test.ts` pins that), so the retry is
   * authoritative: `refused` is certain on every attempt, not just the first,
   * and there is no memory left to test. The case below is what remains, and
   * it asserts the OPPOSITE of what those six did — which is the point.
   */
  it('a refusal is certain on EVERY attempt, including one after an unknown', async () => {
    // The rule the latch existed to break, now true by construction. A retry
    // that the server answers before deleting anything is a certain refusal
    // whatever happened on an earlier attempt, because `unauthorized` no
    // longer means "possibly already deleted" — that case answers success.
    deletionOutcome = 'unknown';
    await armAndDelete();
    await waitFor(() =>
      expect(
        screen.getByText(/couldn.t confirm whether your account was deleted/i),
      ).toBeTruthy(),
    );

    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));

    deletionOutcome = 'refused';
    await userEvent.click(
      screen.getByRole('button', { name: /^Delete account$/i }),
    );
    await userEvent.type(screen.getByLabelText(/type/i), 'DELETE');
    await userEvent.click(
      screen.getByRole('button', { name: /permanently delete/i }),
    );

    await waitFor(() =>
      expect(screen.getByText(/nothing was removed/i)).toBeTruthy(),
    );
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
