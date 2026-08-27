import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GroupThread from './GroupThread';

/**
 * WP6 round-2 guards for the three GroupThread findings the round-1 panel raised.
 *
 * Each test names its finding. They drive the real component against a mocked
 * `@/lib/groups.server`, which is the seam every one of these defects lives at: the component's
 * job is to report what the server actually said, and all three findings are it reporting
 * something else.
 */

vi.mock('@/lib/groups.server', () => ({
  fetchGroupMessages: vi.fn(),
  fetchGroupMembers: vi.fn(),
  markGroupRead: vi.fn(),
  renameGroup: vi.fn(),
  addGroupMember: vi.fn(),
  removeGroupMember: vi.fn(),
  leaveGroup: vi.fn(),
  sendGroupMessage: vi.fn(),
  deleteGroupMessage: vi.fn(),
  inviteGroupToNightOut: vi.fn(),
  MAX_GROUP_MESSAGE_LENGTH: 2000,
  MAX_GROUP_NAME_LENGTH: 60,
}));

vi.mock('@/lib/moderation/reports', () => ({ reportContent: vi.fn() }));

const groups = await import('@/lib/groups.server');

const VIEWER = 'viewer-1';

function props(overrides: Record<string, unknown> = {}) {
  return {
    client: {} as never,
    accessToken: 'token',
    groupId: 'group-1',
    groupName: 'Thursday Crew',
    viewerId: VIEWER,
    addable: [],
    onClose: () => {},
    onChanged: () => {},
    ...overrides,
  };
}

const ADMIN_ROSTER = [
  { profileId: VIEWER, handle: 'me', displayName: 'Me', isAdmin: true, joinedAt: '2026-01-01' },
  { profileId: 'other', handle: 'them', displayName: 'Them', isAdmin: false, joinedAt: '2026-01-02' },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(groups.markGroupRead).mockResolvedValue({ ok: true } as never);
  vi.mocked(groups.fetchGroupMembers).mockResolvedValue({ ok: true, value: ADMIN_ROSTER } as never);
  vi.mocked(groups.fetchGroupMessages).mockResolvedValue({ ok: true, value: [] } as never);
});

describe('a failed thread load does not clear the unread badge (round-1 finding 4)', () => {
  it('does not mark the group read when the messages fail to load', async () => {
    // The defect: mark-read fired from its own mount effect, independent of the load. The user
    // saw "could not be loaded" while every prior message was silently marked read and the
    // badge cleared — read state advanced past messages that were never shown.
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue(
      { ok: false, message: 'The conversation could not be loaded.' } as never,
    );

    render(<GroupThread {...props()} />);

    await screen.findByText('The conversation could not be loaded.');
    expect(groups.markGroupRead).not.toHaveBeenCalled();
  });

  it('still marks the group read on a successful load', async () => {
    render(<GroupThread {...props()} />);
    await waitFor(() => expect(groups.markGroupRead).toHaveBeenCalledTimes(1));
  });
});

describe('a failed rename does not leave a false group name on screen (round-1 finding 5)', () => {
  it('keeps the canonical heading when the rename RPC is rejected', async () => {
    // The defect: the heading and the rename input read the same `name` state, so typing
    // renamed the group on screen before the server agreed, and a rejected write left the
    // uncommitted name displayed — a failed administrative write looking applied.
    vi.mocked(groups.renameGroup).mockResolvedValue(
      { ok: false, message: 'That name could not be saved.' } as never,
    );

    render(<GroupThread {...props()} />);
    const heading = await screen.findByTestId('group-thread-name');
    expect(heading.textContent).toBe('Thursday Crew');

    const input = await screen.findByTestId('group-rename-input');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input, { target: { value: 'Renamed Crew' } });

    // Typing alone must never move the heading.
    expect(screen.getByTestId('group-thread-name').textContent).toBe('Thursday Crew');

    fireEvent.click(screen.getByTestId('group-rename'));
    await screen.findByText('That name could not be saved.');

    expect(screen.getByTestId('group-thread-name').textContent).toBe('Thursday Crew');
  });
});

describe('partial Night Out invites report per person (round-1 finding 2)', () => {
  it('names who was not invited and offers a per-person resend, not one whole-group retry', async () => {
    // The defect: mixed outcomes were collapsed to "N of M invites did not go through", and the
    // returned profile ids were discarded — so the only recovery offered was inviting the whole
    // group again. V8-R-GRP-003 requires "a failed invite shows a per-person Resend invite;
    // other successful invites are unaffected".
    vi.mocked(groups.inviteGroupToNightOut).mockResolvedValue({
      ok: true,
      value: [
        { profileId: VIEWER, invited: true },
        { profileId: 'other', invited: false },
      ],
    } as never);

    render(<GroupThread {...props()} />);
    const { fireEvent } = await import('@testing-library/react');

    fireEvent.change(await screen.findByTestId('group-invite-plan'), {
      target: { value: 'plan-1' },
    });
    fireEvent.click(screen.getByTestId('group-invite-send'));

    // The person who failed is named, and carries their own retry.
    const resend = await screen.findByTestId('group-invite-resend-other');
    expect(resend).toBeTruthy();
    // The one who succeeded is not offered a resend.
    expect(screen.queryByTestId(`group-invite-resend-${VIEWER}`)).toBeNull();
  });
});
