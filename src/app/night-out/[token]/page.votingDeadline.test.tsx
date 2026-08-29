import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * THE DEADLINE ARRIVES WITHOUT A RELOAD (round-6 panel, Codex, MEDIUM).
 *
 * `voting.votingOpen` was a snapshot taken when the member view loaded, and
 * nothing re-read it as `votingClosesAt` passed. A plan left open across its
 * deadline went on rendering Vote, Suggest and Remove for a server that had
 * already made it read-only, and the refusal of the first tap was how the
 * member found out. V8-R-NO-005 names a closed state; the surface has to be
 * able to reach it on its own.
 *
 * The device clock chooses only WHEN to re-ask. Every assertion below is about
 * what the SERVER's second answer does to the page.
 */

type Auth = { status: 'loading' | 'signed-in' | 'signed-out'; user?: { id: string } };
let auth: Auth = { status: 'signed-in', user: { id: 'u1' } };

const resolveByToken = vi.fn();
const getNightOut = vi.fn();
const getNightOutMembers = vi.fn();
const getNightOutBoard = vi.fn();
const previewNightOut = vi.fn();
const fetchNightOutVoting = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }));
vi.mock('@/lib/catalog', () => ({ getBarById: () => null }));
vi.mock('@/components/StartNightOutButton', () => ({
  default: () => null,
  forgetStartedNightOut: vi.fn(),
}));
vi.mock('@/lib/pendingInvite', () => ({
  consumePendingInvite: vi.fn(),
  peekPendingInvite: () => null,
  storePendingInvite: vi.fn(),
}));
vi.mock('./planActions', () => ({
  fetchNightOutVoting: (...a: unknown[]) => fetchNightOutVoting(...a),
  fetchAnonRsvpCounts: vi.fn().mockResolvedValue(null),
  lockNightOut: vi.fn(),
  removeNightOutSuggestion: vi.fn(),
}));
vi.mock('@/lib/nightOuts.server', () => ({
  resolveNightOutByToken: (...a: unknown[]) => resolveByToken(...a),
  getNightOut: (...a: unknown[]) => getNightOut(...a),
  getNightOutMembers: (...a: unknown[]) => getNightOutMembers(...a),
  getNightOutBoard: (...a: unknown[]) => getNightOutBoard(...a),
  previewNightOut: (...a: unknown[]) => previewNightOut(...a),
  cancelNightOut: vi.fn(),
  decideNightOut: vi.fn(),
  declineNightOutByToken: vi.fn(),
  isNightOutFullByToken: vi.fn(),
  joinNightOutByToken: vi.fn(),
  respondNightOut: vi.fn(),
  suggestNightOutBar: vi.fn(),
  voteNightOutBar: vi.fn(),
}));

import NightOutPage from './page';

const TOKEN = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-08-20T00:59:00.000Z');
const CLOSES_AT = '2026-08-20T01:00:00.000Z';

const PLAN = {
  id: 'plan-1',
  night: '2026-08-20',
  title: 'Friday',
  status: 'open' as const,
  decidedBarId: null,
  ownerHandle: 'host',
  ownerDisplayName: 'Host',
  shareToken: TOKEN,
  callerRole: 'member' as const,
  callerStatus: 'accepted' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  auth = { status: 'signed-in', user: { id: 'u1' } };
  resolveByToken.mockResolvedValue(PLAN.id);
  getNightOut.mockResolvedValue(PLAN);
  getNightOutMembers.mockResolvedValue([]);
  getNightOutBoard.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPage(): void {
  render(<NightOutPage params={{ token: TOKEN }} />);
}

describe('the plan page reaches its own voting deadline', () => {
  test('a plan left open across the deadline re-reads and goes read-only', async () => {
    fetchNightOutVoting
      .mockResolvedValueOnce({ votingClosesAt: CLOSES_AT, votingOpen: true })
      .mockResolvedValue({ votingClosesAt: CLOSES_AT, votingOpen: false });

    renderPage();

    // Still open: the suggestion form is offered, and nothing says otherwise.
    await waitFor(() => expect(screen.getByTestId('member-board')).toBeTruthy());
    expect(screen.queryByTestId('night-out-voting-closed')).toBeNull();
    expect(fetchNightOutVoting).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(61_000);

    await waitFor(() => expect(fetchNightOutVoting).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId('night-out-voting-closed').textContent).toMatch(
        /voting has closed/i,
      ),
    );
  });

  test('a plan with no deadline arms nothing', async () => {
    fetchNightOutVoting.mockResolvedValue({
      votingClosesAt: null,
      votingOpen: true,
    });

    renderPage();

    await waitFor(() => expect(fetchNightOutVoting).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000 + 60_000);
    expect(fetchNightOutVoting).toHaveBeenCalledTimes(1);
  });

  /**
   * The server has already said voting is closed. Re-asking on a schedule would
   * be a poll with nothing to learn, and the closed state does not re-open.
   */
  test('an already-closed vote arms nothing', async () => {
    fetchNightOutVoting.mockResolvedValue({
      votingClosesAt: CLOSES_AT,
      votingOpen: false,
    });

    renderPage();

    await waitFor(() => expect(fetchNightOutVoting).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000 + 60_000);
    expect(fetchNightOutVoting).toHaveBeenCalledTimes(1);
  });

  /**
   * ROUND-7 PANEL (Codex) — AND THIS TEST ASSERTED THE DEFECT.
   *
   * It used to demand that a deadline already behind this device arm nothing.
   * That drops the commonest case of all, and it needs no skewed clock: the
   * read starts before the deadline, the server answers `votingOpen: true`, and
   * the response reaches React after the instant has passed. Vote, Suggest and
   * Remove then stayed live indefinitely on a plan the server had made
   * read-only. It keeps asking on the floor instead, and stops the moment the
   * server says closed.
   */
  test('a deadline already behind this device keeps asking until the server closes it', async () => {
    vi.setSystemTime(Date.parse(CLOSES_AT) + 5 * 60_000);
    fetchNightOutVoting
      .mockResolvedValueOnce({ votingClosesAt: CLOSES_AT, votingOpen: true })
      .mockResolvedValueOnce({ votingClosesAt: CLOSES_AT, votingOpen: true })
      .mockResolvedValue({ votingClosesAt: CLOSES_AT, votingOpen: false });

    renderPage();

    await waitFor(() => expect(fetchNightOutVoting).toHaveBeenCalledTimes(1));
    // The same still-open answer must not end the asking.
    await vi.advanceTimersByTimeAsync(61_000);
    await waitFor(() => expect(fetchNightOutVoting).toHaveBeenCalledTimes(2));

    // The server closes it, the page follows, and the asking stops.
    await vi.advanceTimersByTimeAsync(61_000);
    await waitFor(() => expect(fetchNightOutVoting).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(screen.getByTestId('night-out-voting-closed')).toBeTruthy(),
    );

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000 + 60_000);
    expect(fetchNightOutVoting).toHaveBeenCalledTimes(3);
  });

  /**
   * ROUND-9 PANEL. The floor round 7 introduced for a deadline already BEHIND
   * this device was applied to every delay, so a deadline five seconds AHEAD
   * was re-read after sixty: Suggest, Vote and Remove stayed editable for most
   * of a minute past an expiry the server was already enforcing, and the first
   * tap in that window was refused instead of the page having gone read-only.
   */
  test('a deadline a few seconds ahead is not rounded up to a minute', async () => {
    vi.setSystemTime(Date.parse(CLOSES_AT) - 5_000);
    fetchNightOutVoting
      .mockResolvedValueOnce({ votingClosesAt: CLOSES_AT, votingOpen: true })
      .mockResolvedValue({ votingClosesAt: CLOSES_AT, votingOpen: false });

    renderPage();

    await waitFor(() => expect(screen.getByTestId('member-board')).toBeTruthy());
    expect(screen.queryByTestId('night-out-voting-closed')).toBeNull();

    // Ten seconds — past the deadline and its grace, nowhere near the floor.
    await vi.advanceTimersByTimeAsync(10_000);
    await waitFor(() => expect(fetchNightOutVoting).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId('night-out-voting-closed')).toBeTruthy(),
    );
  });
});
