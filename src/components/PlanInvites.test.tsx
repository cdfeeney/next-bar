import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Social → Plans, the five approved card states.
 *
 * Design: next-bar-night-out-invite-recipient-v1.dc.html Part B, approved
 * 2026-08-16. One test per drawn state, plus the two decisions this build made
 * explicit (declined rows omitted, section hidden when empty) so a later change
 * has to argue with a test rather than with a comment.
 */

type Row = Record<string, unknown>;

let rows: Row[] = [];
let respondOk = true;
// Lets a test say "the row had already moved on" — the reason a real refusal
// happens, and the thing the card has to notice.
let onRefusal: (() => void) | null = null;
const responded: Array<[string, boolean, number]> = [];
/** How many times the list has been read. A click-time re-fetch shows up here. */
let getMyNightOutsCalls = 0;
/** Reads observed AT SEND time. A post-success re-sync read must not be mistaken for a pre-send re-fetch. */
let readsAtSend = -1;
const pushed: string[] = [];
let authStatus = 'signed-in';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ status: authStatus }) }));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }));
vi.mock('@/lib/nightOuts.server', () => ({
  getMyNightOuts: async () => {
    getMyNightOutsCalls += 1;
    return rows.map((r) => ({
      nightOutId: r.id,
      night: r.night ?? '2026-08-20',
      title: r.title ?? 'Friday night in the LES',
      status: 'open',
      ownerHandle: 'dev',
      ownerDisplayName: 'Dev',
      myStatus: r.myStatus,
      respondedAt: r.respondedAt ?? null,
      acceptedCount: r.acceptedCount ?? 4,
      shareToken: r.shareToken ?? null,
      planUpdated: r.planUpdated ?? false,
      isPast: r.isPast ?? false,
      myRevision: r.myRevision ?? 0,
    }));
  },
  respondNightOut: async (
    _s: unknown,
    id: string,
    accept: boolean,
    _expectedStatus: string,
    expectedRevision: number,
  ) => {
    // The revision is captured so a test can assert the card sends the value it
    // RENDERED. Sending a re-fetched one would re-open the replay window in the
    // client, and nothing else in the suite would notice.
    readsAtSend = getMyNightOutsCalls;
    responded.push([id, accept, expectedRevision]);
    if (respondOk && accept) {
      rows = rows.map((r) =>
        r.id === id ? { ...r, myStatus: 'accepted', shareToken: 'tok-1' } : r,
      );
    }
    if (respondOk && !accept) {
      rows = rows.map((r) => (r.id === id ? { ...r, myStatus: 'declined' } : r));
    }
    if (!respondOk) onRefusal?.();
    return respondOk;
  },
}));

import PlanInvites from './PlanInvites';

beforeEach(() => {
  rows = [];
  respondOk = true;
  onRefusal = null;
  responded.length = 0;
  getMyNightOutsCalls = 0;
  readsAtSend = -1;
  pushed.length = 0;
  authStatus = 'signed-in';
});

describe('Social → Plans invitation cards', () => {
  test('pending invite offers Accept and Decline, naming who invited you', async () => {
    rows = [{ id: 'p1', myStatus: 'pending' }];
    render(<PlanInvites />);
    expect(await screen.findByTestId('invite-pending')).toBeTruthy();
    expect(screen.getByText(/Dev invited you/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
  });

  test('accepting shows the confirmation state and can open the plan', async () => {
    rows = [{ id: 'p1', myStatus: 'pending' }];
    const user = userEvent.setup();
    render(<PlanInvites />);
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(responded).toEqual([['p1', true, 0]]));
    expect(await screen.findByTestId('invite-accepted-confirm')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'View plan' }));
    // share_token only exists once accepted — that is the 0047 rule, and it is
    // what makes "View plan" reachable here and not on a pending card.
    expect(pushed).toEqual(['/night-out/tok-1']);
  });

  test('declining removes the card — a declined invite leaves your list', async () => {
    rows = [{ id: 'p1', myStatus: 'pending' }];
    const user = userEvent.setup();
    const { container } = render(<PlanInvites />);
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(responded).toEqual([['p1', false, 0]]));
    await waitFor(() => expect(container.querySelector('[data-testid="plan-invites"]')).toBeNull());
  });

  test('the card sends the revision it RENDERED, not a default and not a re-fetch', async () => {
    // 0059: the revision is what makes the replay guard reliable, and it only
    // works if the value travelling with the tap is the one the card was drawn
    // from. A card rendered at revision 4 that sends 0 — or re-fetches at click
    // time — hands the RPC a version the user never saw, which is the ABA
    // window moved into the client.
    //
    // ROUND 2: the first version of this test left `rows` untouched between
    // render and click, so a click-time re-fetch would have returned the same 4
    // and passed. Both review lanes caught that the comment claimed more than
    // the assertion proved. The backend now MOVES after the card is drawn, which
    // is the only way to tell "what was rendered" from "what is true now".
    // Keep the two values different.
    rows = [{ id: 'p1', myStatus: 'pending', myRevision: 4 }];
    const user = userEvent.setup();
    render(<PlanInvites />);
    const accept = await screen.findByRole('button', { name: 'Accept' });
    const afterRender = getMyNightOutsCalls;

    // Someone else responded; the rendered card is now stale.
    rows = [{ id: 'p1', myStatus: 'pending', myRevision: 91 }];
    expect(afterRender, 'the list had not loaded before the backend moved').toBeGreaterThan(0);

    await user.click(accept);
    // 4 = rendered. 91 = re-fetched at click time. 0 = fabricated default.
    await waitFor(() => expect(responded).toEqual([['p1', true, 4]]));
    expect(readsAtSend, 'the card re-read the list BEFORE sending').toBe(afterRender);
  });

  test('an already-accepted invite reads as already responded, not as new', async () => {
    rows = [{ id: 'p1', myStatus: 'accepted', shareToken: 'tok-1' }];
    render(<PlanInvites />);
    expect(await screen.findByTestId('invite-responded')).toBeTruthy();
    expect(screen.getByText(/already accepted this invite/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  test('a plan changed since you responded shows the Updated state', async () => {
    rows = [{ id: 'p1', myStatus: 'accepted', shareToken: 'tok-1', planUpdated: true }];
    render(<PlanInvites />);
    expect(await screen.findByTestId('invite-updated')).toBeTruthy();
    expect(screen.getByText('Updated')).toBeTruthy();
  });

  test('a past night reads as expired and can be dismissed', async () => {
    rows = [{ id: 'p1', myStatus: 'pending', isPast: true }];
    const user = userEvent.setup();
    const { container } = render(<PlanInvites />);
    expect(await screen.findByTestId('invite-expired')).toBeTruthy();
    // Expired wins over pending: you cannot accept a night that already happened.
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(container.querySelector('[data-testid="plan-invites"]')).toBeNull());
  });

  test('renders nothing at all when there is nothing to show', async () => {
    rows = [];
    const { container } = render(<PlanInvites />);
    await waitFor(() => expect(container.querySelector('[data-testid="plan-invites"]')).toBeNull());
  });

  test('renders nothing when signed out', async () => {
    authStatus = 'signed-out';
    rows = [{ id: 'p1', myStatus: 'pending' }];
    const { container } = render(<PlanInvites />);
    await waitFor(() => expect(container.querySelector('[data-testid="plan-invites"]')).toBeNull());
  });

  test('a failed response says so and leaves the card actionable', async () => {
    rows = [{ id: 'p1', myStatus: 'pending' }];
    respondOk = false;
    const user = userEvent.setup();
    render(<PlanInvites />);
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByText(/didn't go through/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy();
  });

  test('a refusal re-reads state, so the retry is not doomed to repeat it', async () => {
    // The expected-status guard refuses DETERMINISTICALLY: this card claims
    // 'pending' while the row has already been answered somewhere else. Retrying
    // from an unrefreshed card re-sends the same stale expectation and fails
    // identically every time, so "try again" is advice that can never succeed
    // unless the card first stops lying about what it is looking at.
    rows = [{ id: 'p1', myStatus: 'pending' }];
    respondOk = false;
    onRefusal = () => {
      rows = rows.map((r) =>
        r.id === 'p1' ? { ...r, myStatus: 'accepted', respondedAt: '2026-08-16T00:00:00Z' } : r,
      );
    };
    const user = userEvent.setup();
    render(<PlanInvites />);
    await user.click(await screen.findByRole('button', { name: 'Accept' }));

    expect(await screen.findByText(/didn't go through/)).toBeTruthy();
    // Re-synced to what the database actually holds, so the next tap cannot
    // re-send 'pending'.
    expect(await screen.findByTestId('invite-responded')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });
});
