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
const responded: Array<[string, boolean]> = [];
const pushed: string[] = [];
let authStatus = 'signed-in';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ status: authStatus }) }));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }));
vi.mock('@/lib/nightOuts.server', () => ({
  getMyNightOuts: async () =>
    rows.map((r) => ({
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
    })),
  respondNightOut: async (_s: unknown, id: string, accept: boolean) => {
    responded.push([id, accept]);
    if (respondOk && accept) {
      rows = rows.map((r) =>
        r.id === id ? { ...r, myStatus: 'accepted', shareToken: 'tok-1' } : r,
      );
    }
    if (respondOk && !accept) {
      rows = rows.map((r) => (r.id === id ? { ...r, myStatus: 'declined' } : r));
    }
    return respondOk;
  },
}));

import PlanInvites from './PlanInvites';

beforeEach(() => {
  rows = [];
  respondOk = true;
  responded.length = 0;
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
    await waitFor(() => expect(responded).toEqual([['p1', true]]));
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
    await waitFor(() => expect(responded).toEqual([['p1', false]]));
    await waitFor(() => expect(container.querySelector('[data-testid="plan-invites"]')).toBeNull());
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
});
