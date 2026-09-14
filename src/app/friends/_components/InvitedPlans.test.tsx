import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * S-03 (Social redesign): the night-out invitation notifications moved from
 * Groups & people to Plans. Three rules travelled with them and are asserted
 * here in isolation: a FAILED read says so (never "nobody invited you"), only
 * UNREAD rows render, and a refused dismiss keeps the row.
 */

const fetchNotifications = vi.fn();
const markRead = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'me' } }),
}));
vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({}),
}));
vi.mock('@/lib/groups.server', () => ({
  fetchNightOutInvitationNotifications: (...args: unknown[]) => fetchNotifications(...args),
  markInvitationNotificationRead: (...args: unknown[]) => markRead(...args),
}));

import InvitedPlans from './InvitedPlans';

const invite = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Night ${id}`,
  night: '2026-09-13',
  groupName: null,
  readAt: null,
  ...overrides,
});

describe('InvitedPlans', () => {
  beforeEach(() => {
    fetchNotifications.mockReset();
    markRead.mockReset();
  });

  test('a failed read states the failure and renders no invitation rows', async () => {
    fetchNotifications.mockResolvedValue({ ok: false, message: 'boom' });
    render(<InvitedPlans />);
    await screen.findByTestId('group-invites-failed');
    expect(screen.queryByTestId('group-invite-notification')).toBeNull();
  });

  test('only unread rows render, and nothing renders when there are none', async () => {
    fetchNotifications.mockResolvedValue({
      ok: true,
      value: [invite(1), invite(2, { readAt: '2026-09-13T01:00:00Z' })],
    });
    const { unmount } = render(<InvitedPlans />);
    await screen.findByTestId('group-invite-notification');
    expect(screen.getAllByTestId('group-invite-notification')).toHaveLength(1);
    expect(screen.getByText(/Night 1/)).toBeTruthy();
    unmount();

    fetchNotifications.mockResolvedValue({ ok: true, value: [] });
    const { container } = render(<InvitedPlans />);
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalledTimes(2));
    expect(container.querySelector('[data-testid="invited-notifications"]')).toBeNull();
  });

  test('a notification whose plan already has a card is hidden; an answered plan marks it read', async () => {
    fetchNotifications.mockResolvedValue({
      ok: true,
      value: [invite(1, { nightOutId: 'plan-a' }), invite(2, { nightOutId: 'plan-b' })],
    });
    markRead.mockResolvedValue({ ok: true, value: true });
    const { rerender } = render(
      <InvitedPlans cardedNightOutIds={new Set(['plan-a'])} answeredNightOutIds={new Set()} />,
    );
    await screen.findByTestId('group-invite-notification');
    // plan-a is carded → hidden; plan-b has no card → shown.
    expect(screen.getAllByTestId('group-invite-notification')).toHaveLength(1);
    expect(screen.getByText(/Night 2/)).toBeTruthy();
    expect(markRead).not.toHaveBeenCalled();

    // The viewer answers plan-a's card: its notification is marked read (once).
    rerender(
      <InvitedPlans cardedNightOutIds={new Set(['plan-a'])} answeredNightOutIds={new Set(['plan-a'])} />,
    );
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
    expect(markRead.mock.calls[0][1]).toBe(1);
  });

  test('a refused dismiss keeps the row and shows the message; a confirmed one removes it', async () => {
    fetchNotifications.mockResolvedValue({ ok: true, value: [invite(7)] });
    markRead.mockResolvedValueOnce({ ok: false, message: 'Could not mark as read.' });
    markRead.mockResolvedValueOnce({ ok: true, value: true });
    render(<InvitedPlans />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('group-invite-seen'));
    expect(await screen.findByText('Could not mark as read.')).toBeTruthy();
    expect(screen.getAllByTestId('group-invite-notification')).toHaveLength(1);

    await user.click(screen.getByTestId('group-invite-seen'));
    await waitFor(() => expect(screen.queryByTestId('group-invite-notification')).toBeNull());
    expect(markRead).toHaveBeenCalledTimes(2);
    expect(markRead.mock.calls[0][1]).toBe(7);
  });
});

describe('InvitedPlans — R-02 follow-ups', () => {
  beforeEach(() => {
    fetchNotifications.mockReset();
    markRead.mockReset();
  });

  test('a plan answered BEFORE the notifications load is settled once they arrive', async () => {
    fetchNotifications.mockResolvedValue({
      ok: true,
      value: [invite(1, { nightOutId: 'plan-a' }), invite(2, { nightOutId: 'plan-b' })],
    });
    markRead.mockResolvedValue({ ok: true, value: true });
    render(
      <InvitedPlans cardedNightOutIds={new Set(['plan-a'])} answeredNightOutIds={new Set(['plan-a'])} />,
    );
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
    expect(markRead.mock.calls[0][1]).toBe(1);
    // plan-b has no card and was not answered: it stays, and is the only row.
    expect(screen.getAllByTestId('group-invite-notification')).toHaveLength(1);
  });

  test('rows with no card on the page carry their own Invited heading', async () => {
    fetchNotifications.mockResolvedValue({ ok: true, value: [invite(3, { nightOutId: 'plan-c' })] });
    const { rerender } = render(<InvitedPlans cardedNightOutIds={new Set()} showHeading />);
    await screen.findByTestId('group-invite-notification');
    expect(screen.getByRole('heading', { name: 'Invited' })).toBeTruthy();

    // PlanInvites owns the heading while it has a card: no second one here.
    rerender(<InvitedPlans cardedNightOutIds={new Set()} showHeading={false} />);
    expect(screen.queryByRole('heading', { name: 'Invited' })).toBeNull();
  });
});
