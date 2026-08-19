import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  cancelNightOut,
  createNightOut,
  decideNightOut,
  getMyNightOuts,
  getNightOut,
  getNightOutBoard,
  getNightOutMembers,
  inviteToNightOut,
  joinNightOutByToken,
  previewNightOut,
  resolveNightOutByToken,
  respondNightOut,
  suggestNightOutBar,
  voteNightOutBar,
} from './nightOuts.server';

/**
 * V8-3 client surface tests. The tables have no client grants, so this
 * module's RPC calls ARE the entire client contract — assert the exact RPC
 * name + p_-prefixed params (the 0011 42702 rule), the null/false-on-error
 * house pattern, and that malformed input never reaches the network.
 */

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const UUID2 = '223e4567-e89b-42d3-a456-426614174000';
const PLAN_UUID = '523e4567-e89b-42d3-a456-426614174000';

function fakeRpc(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn(() =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
  );
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('nightOuts.server write RPCs', () => {
  it('createNightOut calls create_night_out with p_ params and returns the id', async () => {
    const { client, rpc } = fakeRpc({ data: UUID });
    await expect(createNightOut(client, '2026-08-20', 'Birthday crawl')).resolves.toBe(UUID);
    expect(rpc).toHaveBeenCalledWith('create_night_out', {
      p_night: '2026-08-20',
      p_title: 'Birthday crawl',
      p_idempotency_key: null,
    });
  });

  it('createNightOut passes an idempotency key through when given one', async () => {
    // A retry carrying the same key returns the existing plan instead of making
    // a second one. If the key stops reaching the RPC, that protection is gone
    // and nothing else would notice (cold panel, Codex).
    const { client, rpc } = fakeRpc({ data: UUID });
    const key = '9f1c2b7e-1111-4111-8111-222222222222';
    await expect(
      createNightOut(client, '2026-08-20', 'Birthday crawl', key),
    ).resolves.toBe(UUID);
    expect(rpc).toHaveBeenCalledWith('create_night_out', {
      p_night: '2026-08-20',
      p_title: 'Birthday crawl',
      p_idempotency_key: key,
    });
  });

  it('createNightOut refuses a malformed idempotency key without a network call', async () => {
    const { client, rpc } = fakeRpc({ data: UUID });
    await expect(
      createNightOut(client, '2026-08-20', 'Birthday crawl', 'not-a-uuid'),
    ).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('createNightOut rejects a malformed night without a network call', async () => {
    const { client, rpc } = fakeRpc({ data: UUID });
    await expect(createNightOut(client, 'tonight')).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('cancel/decide/respond return false on RPC error (never throw)', async () => {
    const { client } = fakeRpc({ error: { message: 'denied' } });
    await expect(cancelNightOut(client, UUID)).resolves.toBe(false);
    await expect(decideNightOut(client, UUID, 'attaboy')).resolves.toBe(false);
    await expect(respondNightOut(client, UUID, true, 'pending', 0)).resolves.toBe(false);
  });

  it('respondNightOut carries the accept flag — "Not tonight" is accept=false', async () => {
    const { client, rpc } = fakeRpc({ data: true });
    await expect(respondNightOut(client, UUID, false, 'pending', 0)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('respond_night_out', {
      p_night_out: UUID,
      p_accept: false,
      p_expected_status: 'pending',
      p_expected_revision: 0,
    });
  });

  it('respondNightOut sends the state the caller observed', async () => {
    // All four params by name: 0057 dropped the 2-argument respond_night_out
    // and 0059 the 3-argument one, so (uuid, boolean, text, integer) is the
    // only overload the serving database has — both review lanes filed the
    // 2-argument call as a HIGH (Accept and Decline resolved no function).
    //
    // Without it, a replayed accept reversed a LATER decline and recorded the
    // person as coming when they had said no (cold panel, Codex, HIGH). If the
    // expected state stops reaching the RPC, that protection is gone silently.
    //
    // 0059: the REVISION travels with the status, and it is the half that makes
    // the guard reliable — a status can come back, so a status-only check
    // matched a stale request again once the row returned to it.
    const { client, rpc } = fakeRpc({ data: true });
    await expect(respondNightOut(client, UUID, true, 'declined', 3)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('respond_night_out', {
      p_night_out: UUID,
      p_accept: true,
      p_expected_status: 'declined',
      p_expected_revision: 3,
    });
  });

  it('respondNightOut refuses a revision that was never rendered', async () => {
    // A caller reaching here with no revision has not rendered one, and the
    // tempting fix — substituting 0 — sends a value the user never saw, which
    // is the fabricated-default pattern the RPC exists to reject. Refuse
    // locally so the failure is attributable to the caller rather than
    // arriving as an opaque `false` from the database.
    const { client, rpc } = fakeRpc({ data: true });
    for (const bad of [-1, 1.5, Number.NaN]) {
      await expect(respondNightOut(client, UUID, true, 'pending', bad)).resolves.toBe(false);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('getMyNightOuts maps my_revision onto myRevision', async () => {
    // Both review lanes found this gap independently. The two component tests
    // mock the whole nightOuts.server module, and the live tests query SQL
    // directly, so NOTHING exercised this mapping. Break it — drop the key,
    // typo it, or rename the SQL column — and tsc stays 0 (the row is a blind
    // `as MyNightOutRow[]` cast) while every Accept and Decline on Social →
    // Plans silently stops working, because respondNightOut's local
    // Number.isInteger guard refuses an undefined revision.
    //
    // The revision is the only field asserted here that has no other coverage;
    // the rest of the row is included so a reordering or a dropped key shows up
    // as a diff rather than a silent pass.
    const { client, rpc } = fakeRpc({
      data: [
        {
          night_out_id: PLAN_UUID,
          night: '2026-08-20',
          title: 'Birthday crawl',
          status: 'open',
          owner_handle: 'conor',
          owner_display_name: 'Conor',
          my_status: 'pending',
          responded_at: null,
          accepted_count: 4,
          share_token: null,
          plan_updated: false,
          is_past: false,
          my_revision: 5,
        },
      ],
    });
    await expect(getMyNightOuts(client)).resolves.toEqual([
      {
        nightOutId: PLAN_UUID,
        night: '2026-08-20',
        title: 'Birthday crawl',
        status: 'open',
        ownerHandle: 'conor',
        ownerDisplayName: 'Conor',
        myStatus: 'pending',
        respondedAt: null,
        acceptedCount: 4,
        shareToken: null,
        planUpdated: false,
        isPast: false,
        myRevision: 5,
      },
    ]);
    expect(rpc).toHaveBeenCalledWith('get_my_night_outs');
  });

  it('getMyNightOuts returns null on error rather than an empty list', async () => {
    // An empty list and a failed read render identically on the card surface
    // (the section hides when empty), so conflating them would make an outage
    // look like "no invitations".
    const { client } = fakeRpc({ error: { message: 'denied' } });
    await expect(getMyNightOuts(client)).resolves.toBeNull();
  });

  it('inviteToNightOut validates both uuids before calling', async () => {
    const { client, rpc } = fakeRpc({ data: true });
    await expect(inviteToNightOut(client, UUID, 'not-a-uuid')).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    await expect(inviteToNightOut(client, UUID, UUID2)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('invite_to_night_out', {
      p_night_out: UUID,
      p_user: UUID2,
    });
  });

  it('resolveNightOutByToken is the read path — null for non-members falls to preview+Join', async () => {
    const member = fakeRpc({ data: PLAN_UUID });
    await expect(resolveNightOutByToken(member.client, UUID)).resolves.toBe(PLAN_UUID);
    expect(member.rpc).toHaveBeenCalledWith('resolve_night_out_by_token', {
      p_token: UUID,
    });
    const nonMember = fakeRpc({ data: null });
    await expect(resolveNightOutByToken(nonMember.client, UUID)).resolves.toBeNull();
  });

  it('joinNightOutByToken returns the plan id, null on dead link', async () => {
    const ok = fakeRpc({ data: UUID2 });
    await expect(joinNightOutByToken(ok.client, UUID)).resolves.toBe(UUID2);
    expect(ok.rpc).toHaveBeenCalledWith('join_night_out_by_token', {
      p_token: UUID,
    });
    const dead = fakeRpc({ data: null });
    await expect(joinNightOutByToken(dead.client, UUID)).resolves.toBeNull();
  });

  it('suggest/vote validate the bar id shape locally', async () => {
    const { client, rpc } = fakeRpc({ data: true });
    await expect(suggestNightOutBar(client, UUID, 'Attaboy!')).resolves.toBe(false);
    await expect(voteNightOutBar(client, UUID, 'x'.repeat(61))).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    await expect(suggestNightOutBar(client, UUID, 'attaboy')).resolves.toBe(true);
    await expect(voteNightOutBar(client, UUID, 'attaboy')).resolves.toBe(true);
  });
});

describe('nightOuts.server reads', () => {
  it('getNightOut maps the row and surfaces caller role/status', async () => {
    const { client } = fakeRpc({
      data: [
        {
          id: UUID,
          night: '2026-08-20',
          title: null,
          status: 'open',
          decided_bar_id: null,
          owner_handle: 'conor',
          owner_display_name: 'Conor',
          share_token: UUID2,
          caller_role: 'member',
          caller_status: 'accepted',
          caller_revision: 4,
        },
      ],
    });
    const plan = await getNightOut(client, UUID);
    expect(plan).toMatchObject({
      id: UUID,
      status: 'open',
      callerRole: 'member',
      callerStatus: 'accepted',
      // The revision the response guard is built on: it must survive the row
      // mapping, or every caller sends a made-up version.
      callerRevision: 4,
      shareToken: UUID2,
    });
  });

  it('getNightOut returns null for a nonmember (empty definer result) — criterion 3 client half', async () => {
    const { client } = fakeRpc({ data: [] });
    await expect(getNightOut(client, UUID)).resolves.toBeNull();
  });

  it('members and board return null on error, mapped rows on success', async () => {
    const err = fakeRpc({ error: { message: 'denied' } });
    await expect(getNightOutMembers(err.client, UUID)).resolves.toBeNull();
    await expect(getNightOutBoard(err.client, UUID)).resolves.toBeNull();

    const ok = fakeRpc({
      data: [
        {
          bar_id: 'attaboy',
          suggested_by_handle: 'conor',
          votes: '2',
          caller_voted: true,
        },
      ],
    });
    await expect(getNightOutBoard(ok.client, UUID)).resolves.toEqual([
      { barId: 'attaboy', suggestedByHandle: 'conor', votes: 2, callerVoted: true },
    ]);
  });

  it('previewNightOut exposes ONLY the shared plan fields (criterion 5 shape)', async () => {
    const { client, rpc } = fakeRpc({
      data: [
        {
          night: '2026-08-20',
          title: 'Birthday crawl',
          status: 'open',
          owner_handle: 'conor',
          owner_display_name: 'Conor',
          accepted_count: 3,
        },
      ],
    });
    const preview = await previewNightOut(client, UUID);
    expect(rpc).toHaveBeenCalledWith('preview_night_out', { p_token: UUID });
    expect(preview).toEqual({
      night: '2026-08-20',
      title: 'Birthday crawl',
      status: 'open',
      ownerHandle: 'conor',
      ownerDisplayName: 'Conor',
      acceptedCount: 3,
    });
    // The mapped type carries no member identities, account ids, ratings,
    // scores, or tokens — the preview payload IS this object.
    expect(Object.keys(preview as object).sort()).toEqual([
      'acceptedCount',
      'night',
      'ownerDisplayName',
      'ownerHandle',
      'status',
      'title',
    ]);
  });

  it('previewNightOut rejects a malformed token locally', async () => {
    const { client, rpc } = fakeRpc({ data: [] });
    await expect(previewNightOut(client, 'guessable')).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
