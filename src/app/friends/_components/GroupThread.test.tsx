import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  inviteNightOutMember: vi.fn(),
  fetchInvitableNightOuts: vi.fn(),
  MAX_GROUP_MESSAGE_LENGTH: 2000,
  MAX_GROUP_NAME_LENGTH: 60,
  GROUP_THREAD_PAGE: 200,
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
  vi.mocked(groups.fetchInvitableNightOuts).mockResolvedValue({ ok: true, value: [] } as never);
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

  it('marks the group read THROUGH THE NEWEST LOADED MESSAGE, not merely at all', async () => {
    // ROUND-4: the round-3 version asserted only the CALL COUNT, so the watermark argument could
    // be dropped entirely and every test stayed green. The argument IS the fix; assert it.
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({
      ok: true,
      value: [
        { id: 'm1', groupId: 'group-1', senderId: 'o', senderHandle: null, senderDisplayName: null, body: 'a', mediaId: null, createdAt: '2026-08-01T00:00:00Z' },
        { id: 'm2', groupId: 'group-1', senderId: 'o', senderHandle: null, senderDisplayName: null, body: 'b', mediaId: null, createdAt: '2026-08-02T00:00:00Z' },
      ],
    } as never);
    render(<GroupThread {...props()} />);
    await waitFor(() => expect(groups.markGroupRead).toHaveBeenCalledTimes(1));
    expect(groups.markGroupRead).toHaveBeenCalledWith(
      expect.anything(), 'group-1', '2026-08-02T00:00:00Z',
    );
  });

  // REMOVED IN ROUND 5, and it was not bent to fit: this test asserted the round-4 RULE that a
  // truncated page must never mark read. The round-4 panel found that rule to BE a defect - it
  // froze read state forever for any group past GROUP_THREAD_PAGE messages. Its real intent,
  // "a message the viewer never saw is never marked read", is asserted with the CORRECT trigger
  // by INVARIANT B below (unread exceeds the page). Keeping both would pin two contradictory
  // rules and the freeze would be the one that won.

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
    // ROUND 5 (X4): the plan control is now a PICKER, so this test has to have a plan to pick.
    // It used to type a raw uuid into a text box, which is the defect X4 closes.
    vi.mocked(groups.fetchInvitableNightOuts).mockResolvedValue({
      ok: true,
      value: [{ nightOutId: 'plan-1', night: '2026-09-04', title: 'The plan', status: 'open', myRole: 'owner' }],
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

/**
 * ROUND 5 — THE WATERMARK'S TWO INVARIANTS, PINNED TOGETHER, BEFORE THE FIX.
 *
 * These pull in opposite directions and every previous attempt satisfied one by breaking the
 * other. Round 3 marked through the newest row (unseen older messages marked read). Round 4
 * refused to mark on a truncated page (read state frozen forever once a group passes 200
 * messages). They are asserted as a PAIR so neither can be traded away again.
 */
describe('round-5: the watermark must satisfy BOTH invariants', () => {
  const msg = (i: number, min: number) => ({
    id: `m${i}`, groupId: 'group-1', senderId: 'o', senderHandle: null,
    senderDisplayName: null, body: 'x', mediaId: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, min)).toISOString(),
  });

  it('INVARIANT A — the badge clears when every unread message was on screen', async () => {
    // A long thread (a full page) whose UNREAD portion is small: all of it was rendered, so read
    // state MUST advance. Round 4 refused to, and the badge grew forever on exactly the active
    // groups GRP-008's unread state exists for.
    const full = Array.from({ length: 200 }, (_, i) => msg(i, i));
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({ ok: true, value: full } as never);
    render(<GroupThread {...props({ unreadCount: 3 })} />);
    await waitFor(() => expect(groups.markGroupRead).toHaveBeenCalledTimes(1));
    expect(groups.markGroupRead).toHaveBeenCalledWith(
      expect.anything(), 'group-1', full[full.length - 1].createdAt,
    );
  });

  it('INVARIANT B — a message the viewer never saw is never marked read', async () => {
    // A full page whose unread count EXCEEDS the page: there are unread messages above what was
    // rendered, so nothing may be marked. Round 3 marked anyway and ate them.
    const full = Array.from({ length: 200 }, (_, i) => msg(i, i));
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({ ok: true, value: full } as never);
    render(<GroupThread {...props({ unreadCount: 250 })} />);
    await screen.findByTestId('group-thread-name');
    await new Promise((r) => { setTimeout(r, 50); });
    expect(groups.markGroupRead).not.toHaveBeenCalled();
  });

  it('a short thread still marks read — the ordinary case is not collateral', async () => {
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue(
      { ok: true, value: [msg(0, 0), msg(1, 1)] } as never,
    );
    render(<GroupThread {...props({ unreadCount: 2 })} />);
    await waitFor(() => expect(groups.markGroupRead).toHaveBeenCalledTimes(1));
  });
});


describe('round 5, X4: the night out plan is PICKED, not typed', () => {
  const PLANS = [
    { nightOutId: 'plan-a', night: '2026-09-04', title: 'Sam-s birthday', status: 'open', myRole: 'owner' },
    { nightOutId: 'plan-b', night: '2026-09-11', title: null, status: 'draft', myRole: 'member' },
  ];

  it('offers the viewer-s plans as options rather than asking for a uuid', async () => {
    // The defect this closes: the control was a text input placeheld "Night out id". A uuid is
    // not a choice a person can make, so the requirement-s invite surface was unusable by the
    // person it is for.
    vi.mocked(groups.fetchInvitableNightOuts).mockResolvedValue({ ok: true, value: PLANS } as never);

    render(<GroupThread {...props()} />);

    const picker = await screen.findByTestId('group-invite-plan');
    expect(picker.tagName).toBe('SELECT');
    // Titled plan by title; untitled plan falls back to its date.
    expect(screen.getByRole('option', { name: 'Sam-s birthday (yours)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '2026-09-11' })).toBeTruthy();
  });

  it('invites the SELECTED plan, not whatever was typed', async () => {
    vi.mocked(groups.fetchInvitableNightOuts).mockResolvedValue({ ok: true, value: PLANS } as never);
    vi.mocked(groups.inviteGroupToNightOut).mockResolvedValue(
      { ok: true, value: [{ profileId: 'other', invited: true }] } as never,
    );

    render(<GroupThread {...props()} />);
    const picker = await screen.findByTestId('group-invite-plan');
    fireEvent.change(picker, { target: { value: 'plan-b' } });
    fireEvent.click(screen.getByTestId('group-invite-send'));

    await waitFor(() =>
      expect(groups.inviteGroupToNightOut).toHaveBeenCalledWith({}, 'plan-b', 'group-1'),
    );
  });

  it('distinguishes a FAILED plans read from having no plans', async () => {
    // The collapse this refuses: "you have no plans" sends someone off to create a plan they
    // already have. fetchMyGroups and the feed both refuse the same collapse by name.
    vi.mocked(groups.fetchInvitableNightOuts).mockResolvedValue(
      { ok: false, message: 'Your night out plans could not be loaded.' } as never,
    );

    render(<GroupThread {...props()} />);

    await screen.findByTestId('group-invite-plans-failed');
    expect(screen.queryByTestId('group-invite-plans-empty')).toBeNull();
    expect(screen.queryByTestId('group-invite-plan')).toBeNull();
  });

  it('says so plainly when there are genuinely no invitable plans', async () => {
    vi.mocked(groups.fetchInvitableNightOuts).mockResolvedValue({ ok: true, value: [] } as never);

    render(<GroupThread {...props()} />);

    await screen.findByTestId('group-invite-plans-empty');
    expect(screen.queryByTestId('group-invite-plans-failed')).toBeNull();
  });

  it('a plans read that fails does NOT blank the conversation', async () => {
    // The plans list is secondary content. Round 4 taught this lane the cost of one failure
    // taking down a surface that loaded fine.
    vi.mocked(groups.fetchInvitableNightOuts).mockResolvedValue(
      { ok: false, message: 'nope' } as never,
    );
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({ ok: true, value: [] } as never);

    render(<GroupThread {...props()} />);

    await screen.findByTestId('group-invite-plans-failed');
    expect(screen.getByTestId('group-invite')).toBeTruthy();
  });
});
