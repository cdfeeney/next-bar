import { describe, expect, it } from 'vitest';
import { deriveInviteeIds, YOU_ID } from './inviteeSelection';

/**
 * These pin the step the previous invite tests skipped. Those passed a
 * hand-made `inviteeIds` array to the button, so the derivation could be — and
 * was — wrong while every test stayed green (cold panel, Codex, HIGH).
 */

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CARLA = '33333333-3333-4333-8333-333333333333';

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
