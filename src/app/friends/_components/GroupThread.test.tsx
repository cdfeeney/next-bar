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
  fetchUnreadCounts: vi.fn(),
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
  vi.mocked(groups.fetchUnreadCounts).mockResolvedValue({ ok: true, value: new Map() } as never);
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
    // Round 8: the watermark is the ONLY argument — the window went with the guard.
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

describe('round 5, X5: a message outlives its author and says so', () => {
  const msg = (over: Record<string, unknown> = {}) => ({
    id: 'm1',
    groupId: 'group-1',
    senderId: 'other',
    senderHandle: 'them',
    senderDisplayName: 'Them',
    body: 'still here',
    mediaId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  });

  it('renders a departed sender as a departed member, not as Someone', async () => {
    // 'Someone' is the DIFFERENT case: a present account with neither display name nor handle.
    // Collapsing the two would hide that the author is gone.
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({
      ok: true,
      value: [msg({ senderId: null, senderHandle: null, senderDisplayName: null })],
    } as never);

    render(<GroupThread {...props()} />);

    await screen.findByText('A departed member');
    expect(screen.queryByText('Someone')).toBeNull();
  });

  it('still shows the message body — the history is what survives', async () => {
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({
      ok: true,
      value: [msg({ senderId: null, senderHandle: null, senderDisplayName: null })],
    } as never);

    render(<GroupThread {...props()} />);

    await screen.findByText('still here');
  });

  it('a present account with no name is still Someone, not departed', async () => {
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({
      ok: true,
      value: [msg({ senderId: 'other', senderHandle: null, senderDisplayName: null })],
    } as never);

    render(<GroupThread {...props()} />);

    await screen.findByText('Someone');
    expect(screen.queryByText('A departed member')).toBeNull();
  });
});

describe('round 6: a message whose photo was removed renders a tombstone', () => {
  const base = {
    id: 'm1', groupId: 'group-1', senderId: 'other', senderHandle: 'them',
    senderDisplayName: 'Them', body: null, mediaId: null, createdAt: '2026-09-01T00:00:00.000Z',
  };

  it('says the photo is gone instead of rendering an empty message', async () => {
    // The row survives account deletion by design (V8-R-GRP-007). Rendering it as a blank bubble
    // would be the "empty row in a thread is a defect no reader can explain" case the schema
    // comment already refuses.
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({
      ok: true, value: [{ ...base, mediaRemovedAt: '2026-09-02T00:00:00.000Z' }],
    } as never);

    render(<GroupThread {...props()} />);

    await screen.findByTestId('group-message-photo-removed');
  });

  it('does NOT show the tombstone for an ordinary text message', async () => {
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({
      ok: true, value: [{ ...base, body: 'hello', mediaRemovedAt: null }],
    } as never);

    render(<GroupThread {...props()} />);

    await screen.findByText('hello');
    expect(screen.queryByTestId('group-message-photo-removed')).toBeNull();
  });
});
describe('round 8: opening a thread reads it — standard chat semantics, from the contract', () => {
  // THE CONTRACT SETTLED THIS, not a better predicate. V8-R-GRP-008 defines unread as a per-member
  // state that "clears on read", with states ["unread","read","invitation notification sent"] and
  // no exactness clause; its stated purpose is notification VOLUME. V8-R-GRP-002 guarantees a
  // "persistent thread" as RETENTION ("until removed by the sender or an administrator, or the
  // group is deleted") and never asks for scroll-back. Rounds 3-7 defended an exactly-unrendered
  // invariant the contract never posed, and each round broke the previous one.
  //
  // These are BEHAVIOUR tests: they drive the component and assert what it does. They do not
  // inspect SQL text.
  const msg = (i: number, min: number) => ({
    id: 'm' + i, groupId: 'group-1', senderId: 'other', senderHandle: null,
    senderDisplayName: null, body: 'x', mediaId: null, mediaRemovedAt: null,
    createdAt: '2026-09-01T00:' + String(min).padStart(2, '0') + ':00.000Z',
  });
  const page = (n: number) => Array.from({ length: n }, (_, i) => msg(i, i % 60));

  it('marks read THROUGH THE NEWEST RENDERED message when the thread opens', async () => {
    const three = page(3);
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({ ok: true, value: three } as never);

    render(<GroupThread {...props()} />);

    await waitFor(() => expect(groups.markGroupRead).toHaveBeenCalledTimes(1));
    expect(groups.markGroupRead).toHaveBeenCalledWith(
      expect.anything(), 'group-1', three[three.length - 1].createdAt,
    );
  });

  it('THE CEILING: a full 200 page still marks read — it does not refuse and freeze', async () => {
    // This is the behaviour rounds 4 and 7 broke in opposite directions: round 4 refused on a full
    // page, round 7 refused whenever unread sat below the window. Under the contract, opening the
    // thread reads it, so a full page marks like any other.
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({ ok: true, value: page(200) } as never);

    render(<GroupThread {...props({ unreadCount: 5000 })} />);

    await waitFor(() => expect(groups.markGroupRead).toHaveBeenCalledTimes(1));
    const p = page(200);
    expect(groups.markGroupRead).toHaveBeenCalledWith(
      expect.anything(), 'group-1', p[p.length - 1].createdAt,
    );
  });

  it('the client sends NO window argument — there is no guard left to feed', async () => {
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({ ok: true, value: page(4) } as never);

    render(<GroupThread {...props()} />);

    await waitFor(() => expect(groups.markGroupRead).toHaveBeenCalledTimes(1));
    const call = vi.mocked(groups.markGroupRead).mock.calls[0];
    expect(call.length).toBe(3);
  });

  it('an empty thread still claims nothing', async () => {
    // The one client-side refusal that survives, and it is not a heuristic: nothing was rendered,
    // so there is no watermark to send.
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({ ok: true, value: [] } as never);

    render(<GroupThread {...props()} />);

    await screen.findByTestId('group-invite');
    expect(groups.markGroupRead).not.toHaveBeenCalled();
  });

  it('re-marks when a message rendered mid-session ADVANCES the watermark', async () => {
    // ROUND 8 REVIEW, CLAUDE, MEDIUM. The ref used to hold the GROUP ID, so exactly one
    // mark_group_read could ever fire per opened thread. Another member's message that arrived
    // while the viewer was in the thread got fetched by run() -> load(), rendered on screen, and
    // then stayed counted unread in the group list until the thread was closed and reopened —
    // which contradicts "clears on read" AND this component's own rule that the watermark is the
    // newest message the caller was SHOWN.
    const first = page(2);
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({ ok: true, value: first } as never);

    const { rerender } = render(<GroupThread {...props()} />);
    await waitFor(() => expect(groups.markGroupRead).toHaveBeenCalledTimes(1));
    expect(groups.markGroupRead).toHaveBeenLastCalledWith(
      expect.anything(), 'group-1', first[first.length - 1].createdAt,
    );

    // A newer message arrives and is rendered by the next load.
    const second = page(3);
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({ ok: true, value: second } as never);
    rerender(<GroupThread {...props()} />);

    await waitFor(() => expect(groups.markGroupRead).toHaveBeenCalledTimes(2));
    expect(groups.markGroupRead).toHaveBeenLastCalledWith(
      expect.anything(), 'group-1', second[second.length - 1].createdAt,
    );
  });

  it('does NOT re-mark when the watermark has not advanced', async () => {
    // The other half, and why the ref still exists: an ordinary re-render that returns the same
    // newest message must cost nothing. The watermark only ever advances, so this terminates.
    const same = page(3);
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({ ok: true, value: same } as never);

    const { rerender } = render(<GroupThread {...props()} />);
    await waitFor(() => expect(groups.markGroupRead).toHaveBeenCalledTimes(1));

    rerender(<GroupThread {...props()} />);
    rerender(<GroupThread {...props()} />);
    await new Promise((r) => { setTimeout(r, 20); });

    expect(groups.markGroupRead).toHaveBeenCalledTimes(1);
  });

  it('a FAILED thread load still does not mark read', async () => {
    // Round-1 finding 4, which must survive every redesign: read state may never advance for a
    // conversation the viewer could not see.
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue(
      { ok: false, message: 'The conversation could not be loaded.' } as never,
    );

    render(<GroupThread {...props()} />);

    await screen.findByText('The conversation could not be loaded.');
    expect(groups.markGroupRead).not.toHaveBeenCalled();
  });
});

describe('V8-R-GRP-002: a failed send is STATED and RETRYABLE, never silently dropped', () => {
  // ROUND 8 REVIEW, CLAUDE, MEDIUM. The requirement carries that clause in its own words and it
  // had no runnable test: nothing exercised a failed sendGroupMessage, so neither the failure
  // notice nor the draft-preserved-on-failure behaviour was pinned. `onSend` clears the draft only
  // when the send is CONFIRMED, and that `if (sent)` could be deleted with the whole gate green.
  const type = (text: string) => {
    fireEvent.change(screen.getByTestId('group-composer'), { target: { value: text } });
  };

  it('states the failure and KEEPS what was typed', async () => {
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({ ok: true, value: [] } as never);
    vi.mocked(groups.sendGroupMessage).mockResolvedValue(
      { ok: false, message: 'That message could not be sent. Try again.' } as never,
    );

    render(<GroupThread {...props()} />);
    await screen.findByTestId('group-composer');
    type('are we still on for thursday');
    fireEvent.click(screen.getByTestId('group-send'));

    // STATED: the person is told, rather than the message disappearing.
    await screen.findByText('That message could not be sent. Try again.');
    // RETRYABLE: the draft survives, so Send is still there to press.
    expect(screen.getByTestId('group-composer')).toHaveValue('are we still on for thursday');
    expect(screen.getByTestId('group-send')).toBeEnabled();
  });

  it('clears the draft only on a CONFIRMED send', async () => {
    vi.mocked(groups.fetchGroupMessages).mockResolvedValue({ ok: true, value: [] } as never);
    vi.mocked(groups.sendGroupMessage).mockResolvedValue({ ok: true } as never);

    render(<GroupThread {...props()} />);
    await screen.findByTestId('group-composer');
    type('on for thursday');
    fireEvent.click(screen.getByTestId('group-send'));

    await waitFor(() => expect(screen.getByTestId('group-composer')).toHaveValue(''));
    expect(groups.sendGroupMessage).toHaveBeenCalledWith(
      expect.anything(), 'group-1', 'on for thursday',
    );
  });
});
