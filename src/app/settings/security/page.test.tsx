import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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
vi.mock('@/lib/accountDeletion', () => ({
  requestAccountDeletion: vi.fn(async () => true),
}));
vi.mock('@/lib/pairwise.server', () => ({
  deleteAllServerComparisons: vi.fn(async () => true),
}));
vi.mock('@/lib/ratings.server', () => ({
  deleteAllServerRatings: vi.fn(async () => true),
}));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => null }));

import SecurityAccountPage from './page';

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
