import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecipientPicker from '@/app/friends/consensus/RecipientPicker';
import { fetchMyGroups, fetchGroupMembers } from '@/lib/groups.server';
import { deriveInviteeIds, mergeSelection, YOU_ID } from './inviteeSelection';

/**
 * These pin the step the previous invite tests skipped. Those passed a
 * hand-made `inviteeIds` array to the button, so the derivation could be — and
 * was — wrong while every test stayed green (cold panel, Codex, HIGH).
 */

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CARLA = '33333333-3333-4333-8333-333333333333';

describe('mergeSelection', () => {
  it('deduplicates direct picks and overlapping groups', () => {
    expect(mergeSelection({ direct: new Set([ALICE]), groupMembers: [[ALICE, BOB], [BOB, CARLA]] }))
      .toEqual(new Set([ALICE, BOB, CARLA]));
  });
  it('handles an empty selection', () => {
    expect(mergeSelection({ direct: [], groupMembers: [] })).toEqual(new Set());
  });
  it('handles group-only selection', () => {
    expect(mergeSelection({ direct: [], groupMembers: [[BOB, CARLA]] })).toEqual(new Set([BOB, CARLA]));
  });
  it('preserves direct picks when groups are deselected', () => {
    expect(mergeSelection({ direct: [ALICE], groupMembers: [] })).toEqual(new Set([ALICE]));
  });
});

describe('deriveInviteeIds', () => {
  it('invites a followed friend who has ranked NOTHING', () => {
    // The defect: invitees were derived from the rating-qualified list, so a
    // friend with no ranked bars was silently never invited. Carla has none.
    const circleIds = [ALICE, CARLA];
    const selected = new Set([ALICE, CARLA]);
    expect(deriveInviteeIds({ isServer: true, circleIds, selected })).toEqual([
      ALICE,
      CARLA,
    ]);
  });

  it('does not depend on ratings having loaded', () => {
    // The second half of the same defect: the rating-qualified list is EMPTY
    // while friendRatings loads, so starting a plan a moment early invited
    // nobody and said nothing. The circle is what matters, and it is available
    // independently of ratings.
    const circleIds = [ALICE, BOB];
    const selected = new Set([ALICE, BOB]);
    expect(
      deriveInviteeIds({ isServer: true, circleIds, selected }),
      'invitees vanished when ratings were unavailable',
    ).toEqual([ALICE, BOB]);
  });

  it('honours deselection', () => {
    const circleIds = [ALICE, BOB, CARLA];
    const selected = new Set([ALICE, CARLA]);
    expect(deriveInviteeIds({ isServer: true, circleIds, selected })).toEqual([
      ALICE,
      CARLA,
    ]);
  });

  it('never returns YOU or a demo handle', () => {
    // night_out_members is FK-bound to profiles and the invite RPC returns
    // false rather than throwing, so a non-uuid would fail silently.
    const circleIds = [YOU_ID, 'devbar', ALICE, 'priya'];
    const selected = new Set([YOU_ID, 'devbar', ALICE, 'priya']);
    expect(deriveInviteeIds({ isServer: true, circleIds, selected })).toEqual([
      ALICE,
    ]);
  });

  it('invites nobody in demo/local mode', () => {
    expect(
      deriveInviteeIds({
        isServer: false,
        circleIds: [ALICE, BOB],
        selected: new Set([ALICE, BOB]),
      }),
    ).toEqual([]);
  });

  it('invites nobody when nothing is selected', () => {
    expect(
      deriveInviteeIds({
        isServer: true,
        circleIds: [ALICE, BOB],
        selected: new Set(),
      }),
    ).toEqual([]);
  });
});


vi.mock('@/lib/groups.server', () => ({
  fetchMyGroups: vi.fn(),
  fetchGroupMembers: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => null }));
afterEach(cleanup);

const pickerPeople = Array.from({ length: 10 }, (_, index) => ({
  id: String(index), label: `Person ${index}`, seed: `handle${index}`, initials: 'P', ratings: [],
}));
const pickerProps = () => ({
  people: pickerPeople, circleIds: pickerPeople.map((p) => p.id), selected: new Set<string>(),
  groupMembers: {}, onToggle: vi.fn(), onGroupChange: vi.fn(), onBusy: vi.fn(),
  userId: ALICE, isServer: false, loading: false, failed: false,
});

describe('RecipientPicker', () => {
  it('caps suggestions, searches full names and handles, and selects an exact match with Enter', async () => {
    const props = pickerProps();
    const user = userEvent.setup();
    const { rerender } = render(createElement(RecipientPicker, props));
    expect(screen.getByText('Selected \u00b7 0 people')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Person/ })).toHaveLength(8);
    await user.click(screen.getByRole('button', { name: 'Show all (10)' }));
    expect(screen.getAllByRole('button', { name: /^Person/ })).toHaveLength(10);
    const search = screen.getByRole('searchbox', { name: 'Search people' });
    await user.type(search, 'PERSON 9{Enter}');
    expect(props.onToggle).toHaveBeenLastCalledWith('9');
    expect(screen.getAllByRole('button', { name: /^Person/ })).toHaveLength(1);
    await user.clear(search);
    await user.type(search, '@HANDLE9{Enter}');
    expect(props.onToggle).toHaveBeenCalledTimes(2);
    rerender(createElement(RecipientPicker, { ...props, selected: new Set(['9']) }));
    expect(screen.getByRole('button', { name: 'Person 9 \u2014 no ranked bars yet' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Remove Person 9' }));
    expect(props.onToggle).toHaveBeenCalledTimes(3);
  });

  it('loads real group members, reports failures and retries without selecting a failed roster', async () => {
    const group = { id: BOB, name: 'Weekend', createdAt: '' };
    const member = { profileId: CARLA, displayName: 'Carla', handle: 'carla', isAdmin: false, joinedAt: '' };
    vi.mocked(fetchMyGroups).mockResolvedValue({ ok: true, value: [group] });
    vi.mocked(fetchGroupMembers).mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'Roster failed' })
      .mockResolvedValueOnce({ ok: true, value: [member] });
    const props = { ...pickerProps(), isServer: true };
    const user = userEvent.setup();
    render(createElement(RecipientPicker, props));
    const groups = screen.getByRole('group', { name: 'Groups' });
    const button = await within(groups).findByRole('button', { name: 'Weekend' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('Roster failed');
    expect(props.onGroupChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry Weekend' }));
    await waitFor(() => expect(props.onGroupChange).toHaveBeenCalledWith(BOB, [member]));
    expect(fetchGroupMembers).toHaveBeenCalledWith(null, BOB);
    expect(props.onBusy).toHaveBeenLastCalledWith(false);
  });
});
