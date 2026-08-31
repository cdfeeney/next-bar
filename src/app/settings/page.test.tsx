import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The Account root: what it IS, and what V8 says it must not be.
 *
 * V8-R-ACC-001 — the identity header must never print the same @handle twice.
 * AccountPage derived its `name` as `displayName ?? '@' + handle`, then handed
 * IdentityHeader BOTH that name and the raw handle. IdentityHeader printed the
 * grey @handle line whenever handle was non-null — so a signed-in profile that
 * has claimed a username but never set a display name rendered "@connor_f" on
 * the top line and "@connor_f" again underneath.
 *
 * The reference (approved/next-bar-account-a-tabs.png) shows the two lines as
 * "Connor Feeney" over "@connor" — a name and its handle, never a handle over
 * itself. The discriminator is the handle-only case below: restore the old
 * `handle !== null` condition on the secondary line and it finds two matches.
 * The display-name case is kept alongside it so the fix cannot be "delete the
 * secondary line" — that would still be wrong for the profile the reference
 * actually draws.
 */

const auth = { status: 'signed-in' as const, user: { id: 'me' }, signOut: vi.fn() };

let profile: { handle: string | null; displayName: string | null };

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useRatings', () => ({ useRatings: () => ({ ratings: [] }) }));
vi.mock('@/hooks/useFollows', () => ({
  useFollows: () => ({ follows: [], mutuals: [] }),
}));
vi.mock('@/hooks/useFollowRequests', () => ({
  useFollowRequests: () => ({ requests: [] }),
}));
// Stable reference on purpose: the real useBars is a useSyncExternalStore
// snapshot, so it never hands back a fresh array. A mock returning a new []
// per render changes the nights effect's deps every pass and spins forever.
const NO_BARS: never[] = [];
vi.mock('@/lib/useBars', () => ({ useBars: () => NO_BARS }));
vi.mock('./_useOwnProfile', () => ({
  useOwnProfile: () => ({
    ...profile,
    isPrivate: false,
    known: true,
    consentLive: true,
    setHandle: vi.fn(),
    setDisplayName: vi.fn(),
    setIsPrivate: vi.fn(),
  }),
}));

import AccountPage from './page';

describe('Account root identity header', () => {
  it('renders a handle-only profile as ONE @handle, not two', () => {
    profile = { handle: 'connor_f', displayName: null };
    render(<AccountPage />);

    expect(screen.getAllByText('@connor_f')).toHaveLength(1);
  });

  it('renders a display name over its @handle when both exist', () => {
    profile = { handle: 'connor_f', displayName: 'Connor Feeney' };
    render(<AccountPage />);

    expect(screen.getByText('Connor Feeney')).toBeInTheDocument();
    expect(screen.getAllByText('@connor_f')).toHaveLength(1);
  });
});

/**
 * V8-R-ACC-004/005 — the gear is the ONE entry to Settings, and the Account
 * root carries no settings rows of its own. The inherited HIGH finding on this
 * file was exactly the opposite arrangement: the Account tab landed directly
 * on the legacy Settings utility page, so there was no profile root and no
 * gear at all.
 */
describe('Account root is the profile, and Settings is behind the gear', () => {
  it('offers the gear as the route into the Settings stack', () => {
    profile = { handle: 'connor_f', displayName: 'Connor Feeney' };
    render(<AccountPage />);

    const gear = screen.getByRole('link', { name: /settings/i });
    expect(gear.getAttribute('href')).toBe('/settings/preferences');
  });

  it('renders no Settings heading or configuration rows itself', () => {
    profile = { handle: 'connor_f', displayName: 'Connor Feeney' };
    render(<AccountPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: /^Account$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /^Settings$/i }),
    ).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

/**
 * V8-R-ACC-003 defers Badges and Persona to V9, and its exclusions are blunt:
 * "no Badges tab in V8", "no Persona card in V8". Both are drawn in full on
 * the approved canvas, which is exactly why this needs a test rather than a
 * comment — the next person to look at the reference will see them there.
 */
describe('Badges and Persona are deferred to V9', () => {
  it('renders neither the Badges tab nor the Persona card', () => {
    profile = { handle: 'connor_f', displayName: 'Connor Feeney' };
    render(<AccountPage />);

    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText(/badges/i)).toBeNull();
    expect(screen.queryByText(/persona/i)).toBeNull();
    expect(screen.queryByText(/explorer score/i)).toBeNull();
  });
});

/**
 * V8 defers the durable multi-night archive to V9 (operator scope amendment,
 * 2026-08-22) and binds the deferral to a copy constraint: this surface holds
 * only the current-or-previous night, so no user-facing string may promise a
 * saved archive, past nights or a tappable historical recap. That is a
 * requirement, not a style preference — it is the one thing a reviewer is told
 * to fail the candidate on, so it gets a check that fails if the promise
 * returns.
 */
const PERSISTENCE_CLAIM =
  /archive|history|past night|previous night|all your nights|every night/i;

describe('Nights Out copy claims no persistent history', () => {
  it('the empty state offers tonight only, and promises no archive', () => {
    profile = { handle: 'connor_f', displayName: 'Connor Feeney' };
    render(<AccountPage />);

    // No night is seeded, so the empty state is what renders.
    expect(screen.getByText(/No nights out yet/i)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(PERSISTENCE_CLAIM);
  });
});
