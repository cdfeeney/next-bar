import { describe, expect, it, vi } from 'vitest';

import {
  fetchAnonRsvpCounts,
  fetchNightOutVoting,
  lockNightOut,
  removeNightOutSuggestion,
} from './planActions';

/**
 * The two plan actions and the two plan reads this lane added.
 *
 * The reads are here because both carry a distinction the surface depends on
 * and that a coercion would quietly erase: a voting state we could not READ is
 * not a closed vote (it would withdraw every participant control on a guess),
 * and a failed RSVP-count read is not "nobody replied from the link".
 */

const PLAN = '11111111-1111-1111-1111-111111111111';

function rpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as never, rpc };
}

function throwingClient() {
  return { rpc: vi.fn().mockRejectedValue(new Error('offline')) } as never;
}

describe('lockNightOut (V8-R-SOC-007)', () => {
  it('sends only the plan — the bar is the server\'s to choose', async () => {
    const { client, rpc } = rpcClient({ data: 'attaboy', error: null });
    await expect(lockNightOut(client, PLAN)).resolves.toBe('attaboy');
    expect(rpc).toHaveBeenCalledWith('lock_night_out', { p_night_out: PLAN });
  });

  /**
   * "A failed lock leaves voting open and says so." Null is the refusal — not
   * the owner, not open, or an empty shortlist — and the caller reports it.
   */
  it('is null on every refusal, and never throws', async () => {
    for (const data of [null, false, '', 'NOT A BAR ID']) {
      const { client } = rpcClient({ data, error: null });
      await expect(lockNightOut(client, PLAN)).resolves.toBeNull();
    }
    const errored = rpcClient({ data: 'attaboy', error: { message: 'no' } });
    await expect(lockNightOut(errored.client, PLAN)).resolves.toBeNull();
    await expect(lockNightOut(throwingClient(), PLAN)).resolves.toBeNull();
  });
});

describe('removeNightOutSuggestion (V8-R-SOC-008)', () => {
  it('sends the plan and the bar', async () => {
    const { client, rpc } = rpcClient({ data: true, error: null });
    await expect(
      removeNightOutSuggestion(client, PLAN, 'attaboy'),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('remove_night_out_suggestion', {
      p_night_out: PLAN,
      p_bar: 'attaboy',
    });
  });

  it('refuses a malformed bar id without a round trip', async () => {
    const { client, rpc } = rpcClient({ data: true, error: null });
    await expect(
      removeNightOutSuggestion(client, PLAN, 'Not A Bar'),
    ).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('fetchNightOutVoting (V8-R-NO-005)', () => {
  it('carries the deadline and the SERVER\'s open/closed answer', async () => {
    const { client, rpc } = rpcClient({
      data: [
        { voting_closes_at: '2026-08-20T23:00:00.000Z', voting_open: true },
      ],
      error: null,
    });
    await expect(fetchNightOutVoting(client, PLAN)).resolves.toEqual({
      votingClosesAt: '2026-08-20T23:00:00.000Z',
      votingOpen: true,
    });
    expect(rpc).toHaveBeenCalledWith('get_night_out_voting', {
      p_night_out: PLAN,
    });
  });

  it('carries "no deadline" as a real state, not as an absent read', async () => {
    const { client } = rpcClient({
      data: [{ voting_closes_at: null, voting_open: true }],
      error: null,
    });
    await expect(fetchNightOutVoting(client, PLAN)).resolves.toEqual({
      votingClosesAt: null,
      votingOpen: true,
    });
  });

  /**
   * A voting state we could not read is NOT a closed vote. Coercing here would
   * withdraw the suggest form and every Vote control from a participant on a
   * guess — the same class of lie as rendering an empty circle for a failed
   * presence read.
   */
  it('is null when the answer is unreadable, and never coerces voting_open', async () => {
    const failed = rpcClient({ data: null, error: { message: 'boom' } });
    await expect(fetchNightOutVoting(failed.client, PLAN)).resolves.toBeNull();
    const nonMember = rpcClient({ data: [], error: null });
    await expect(
      fetchNightOutVoting(nonMember.client, PLAN),
    ).resolves.toBeNull();
    const junk = rpcClient({
      data: [{ voting_closes_at: null, voting_open: 'yes' }],
      error: null,
    });
    await expect(fetchNightOutVoting(junk.client, PLAN)).resolves.toBeNull();
    await expect(fetchNightOutVoting(throwingClient(), PLAN)).resolves.toBeNull();
  });
});

describe('fetchAnonRsvpCounts (V8-R-INV-003)', () => {
  it('carries the three counts the members are allowed to see', async () => {
    const { client, rpc } = rpcClient({
      data: [{ going: 2, maybe: 1, declined: 0 }],
      error: null,
    });
    await expect(fetchAnonRsvpCounts(client, PLAN)).resolves.toEqual({
      going: 2,
      maybe: 1,
      declined: 0,
    });
    expect(rpc).toHaveBeenCalledWith('get_night_out_anon_rsvps', {
      p_night_out: PLAN,
    });
  });

  it('keeps "nobody replied" and "we could not ask" apart', async () => {
    const none = rpcClient({
      data: [{ going: 0, maybe: 0, declined: 0 }],
      error: null,
    });
    await expect(fetchAnonRsvpCounts(none.client, PLAN)).resolves.toEqual({
      going: 0,
      maybe: 0,
      declined: 0,
    });
    const failed = rpcClient({ data: null, error: { message: 'boom' } });
    await expect(fetchAnonRsvpCounts(failed.client, PLAN)).resolves.toBeNull();
    await expect(
      fetchAnonRsvpCounts(throwingClient(), PLAN),
    ).resolves.toBeNull();
  });
});
