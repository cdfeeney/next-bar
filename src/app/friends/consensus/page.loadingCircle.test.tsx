import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Starting a Night Out before the followed circle has loaded must be
 * impossible.
 *
 * WHY THIS FILE DRIVES THE PAGE. `inviteeIds` is built inside ConsensusPage
 * from `useFollows().circle`, which is EMPTY while follows are in flight. The
 * page destructured `circle` but not `loading`, so the Start button rendered
 * armed with an empty invitee list: tapping it created a real plan and invited
 * NOBODY — no error, no empty state (cold panel, both lanes, HIGH).
 *
 * The previous tests could not see this. They called `deriveInviteeIds` with a
 * hand-made `circleIds` literal, which asserts the helper is right about a list
 * it was HANDED — while the defect was in the page that hands it the list. A
 * test that never renders ConsensusPage cannot fail on a missing `loading`.
 * So: render the real page, move it through the real loading transition.
 *
 * The discriminator is the FIRST assertion block. Delete `disabled` from the
 * page's <StartNightOutButton> and the click below reaches handleStart with an
 * empty invitee list — createNightOut fires and this test fails. Any fixture
 * that only checks the loaded state would stay green through that revert.
 */

const FRIEND_ID = '123e4567-e89b-42d3-a456-426614174000';
const PLAN_ID = '223e4567-e89b-42d3-a456-426614174000';
const TOKEN = '323e4567-e89b-42d3-a456-426614174000';

/** Mutable so a single render can be walked through the loading transition. */
let follows: {
  circle: Array<{ id: string; handle: string; displayName: string | null }>;
  mode: string;
  loading: boolean;
};

const createNightOut =
  vi.fn<(...args: unknown[]) => Promise<string>>(async () => PLAN_ID);
const inviteToNightOut =
  vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/hooks/useFollows', () => ({
  useFollows: () => ({
    ...follows,
    requested: [],
    followers: [],
    friends: [],
    isFollowing: () => false,
  }),
}));
vi.mock('@/hooks/useRatings', () => ({
  useRatings: () => ({ ratings: [] }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'me' } }),
}));
vi.mock('@/hooks/useVibeVotes', () => ({
  useVibeVotes: () => ({
    votes: null,
    myTag: null,
    winner: null,
    counts: {},
    busy: false,
    failed: false,
    toggleVote: vi.fn(),
  }),
}));
vi.mock('@/lib/useBars', () => ({ useBars: () => [] }));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }));
vi.mock('@/lib/accountCache', () => ({ getCacheEpoch: () => 1 }));
vi.mock('@/lib/follows.server', () => ({
  fetchAllFriendRatings: async () => ({}),
}));
// Not under test and it opens its own supabase reads.
vi.mock('@/components/TonightSuggestions', () => ({ default: () => null }));
vi.mock('@/lib/nightOuts.server', () => ({
  createNightOut: (...args: unknown[]) => createNightOut(...args),
  inviteToNightOut: (...args: unknown[]) => inviteToNightOut(...args),
  getNightOut: async () => ({ id: PLAN_ID, shareToken: TOKEN }),
}));

import ConsensusPage from '@/app/friends/consensus/page';

const startButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: /start the official night out/i });

describe('ConsensusPage — starting a night out while follows load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    follows = { circle: [], mode: 'server', loading: true };
  });

  it('cannot start a night out while the followed circle is still loading', async () => {
    render(<ConsensusPage />);

    // The circle is empty ONLY because it has not arrived yet. That is
    // indistinguishable from "nobody to invite" at the button, which is why
    // the page has to withhold the action rather than the button guessing.
    expect(startButton()).toBeDisabled();

    await userEvent.click(startButton(), { pointerEventsCheck: 0 });

    // The real assertion: no plan was created. A plan made here would exist,
    // be un-unmakeable, and have no guests.
    expect(createNightOut).not.toHaveBeenCalled();
    expect(inviteToNightOut).not.toHaveBeenCalled();
  });

  it('starts the night out once the circle has loaded, and invites it', async () => {
    const { rerender } = render(<ConsensusPage />);
    expect(startButton()).toBeDisabled();

    // Follows resolve — the same transition useFollows performs for real.
    follows = {
      circle: [{ id: FRIEND_ID, handle: 'claire', displayName: 'Claire R' }],
      mode: 'server',
      loading: false,
    };
    rerender(<ConsensusPage />);

    await waitFor(() => expect(startButton()).toBeEnabled());
    await userEvent.click(startButton());

    await waitFor(() => expect(createNightOut).toHaveBeenCalledTimes(1));
    // …and the invitee list is the loaded circle, not the empty one.
    expect(inviteToNightOut).toHaveBeenCalledTimes(1);
    expect(inviteToNightOut.mock.calls[0][2]).toBe(FRIEND_ID);
  });
});
