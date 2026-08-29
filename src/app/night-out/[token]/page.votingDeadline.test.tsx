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

  /**
   * ROUND-10 ROUND 7, Codex — the twin of the media-window case, and the reason
   * both copies of `clampRecheck` were changed together rather than one of them.
   * A deadline this device thinks is still AHEAD used to be waited for exactly,
   * which is only right when the clocks agree. On a slow device the server
   * closes voting first while Suggest, Vote and Remove stay editable here for
   * the whole skew, and the first tap is refused instead of the surface having
   * gone read-only.
   */
  test('a deadline far ahead is still re-asked within a minute, for a slow clock', async () => {
    vi.setSystemTime(Date.parse(CLOSES_AT) - 10 * 60_000);
    fetchNightOutVoting
      .mockResolvedValueOnce({ votingClosesAt: CLOSES_AT, votingOpen: true })
      .mockResolvedValue({ votingClosesAt: CLOSES_AT, votingOpen: false });

    renderPage();

    await waitFor(() => expect(screen.getByTestId('member-board')).toBeTruthy());
    expect(screen.queryByTestId('night-out-voting-closed')).toBeNull();

    await vi.advanceTimersByTimeAsync(61_000);

    await waitFor(() =>
      expect(
        fetchNightOutVoting,
        'a deadline ten minutes ahead was waited for exactly, so a slow clock kept voting editable',
      ).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(screen.getByTestId('night-out-voting-closed')).toBeTruthy(),
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

  /**
   * ROUND-10 ROUND 8, BOTH LANES — the twin of the media-window cost case, and
   * again the reason both copies of `clampRecheck` change together. Round 7's
   * `Math.min(delay, 60_000)` polled for the ENTIRE ahead period, and here each
   * poll is `loadMemberView`'s five RPCs. A plan opened three hours before its
   * deadline made 180 of them for nothing.
   */
  test('a deadline hours ahead is waited for, not polled every minute', async () => {
    vi.setSystemTime(Date.parse(CLOSES_AT) - 3 * 60 * 60 * 1_000);
    fetchNightOutVoting.mockResolvedValue({
      votingClosesAt: CLOSES_AT,
      votingOpen: true,
    });

    renderPage();
    await waitFor(() => expect(screen.getByTestId('member-board')).toBeTruthy());
    expect(fetchNightOutVoting).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(
      fetchNightOutVoting,
      'an ahead deadline was polled once a minute for the whole ahead period',
    ).toHaveBeenCalledTimes(1);

    // ...and the approach still opens in time to absorb a ten-minute skew.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1_000 + 21 * 60_000);
    expect(fetchNightOutVoting.mock.calls.length).toBeGreaterThan(1);
  });

  /**
   * ROUND-10 ROUND 8, Codex. `viewEpoch` separates VIEWS, not reads of the same
   * view, so a stalled pre-deadline load that returned after a post-deadline one
   * passed the guard and re-enabled Vote, Suggest and Remove — every one of
   * which the server now refuses.
   */
  test('an older member load cannot reopen voting a newer one closed', async () => {
    let releaseStalled: (value: unknown) => void = () => undefined;
    fetchNightOutVoting
      .mockResolvedValueOnce({ votingClosesAt: CLOSES_AT, votingOpen: true })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseStalled = resolve;
        }),
      )
      .mockResolvedValue({ votingClosesAt: CLOSES_AT, votingOpen: false });

    renderPage();
    await waitFor(() => expect(screen.getByTestId('member-board')).toBeTruthy());
    expect(screen.queryByTestId('night-out-voting-closed')).toBeNull();

    // The deadline passes. The timer re-arms on its own tick, so a later load
    // goes out while the earlier one is still stalled and answers 'closed'.
    await vi.advanceTimersByTimeAsync(3 * 61_000);
    await waitFor(() =>
      expect(screen.getByTestId('night-out-voting-closed')).toBeTruthy(),
    );

    // The older load lands, still saying voting was open.
    releaseStalled({ votingClosesAt: CLOSES_AT, votingOpen: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(
      screen.queryByTestId('night-out-voting-closed'),
      'an older load passed the same view epoch and put voting back',
    ).toBeTruthy();
  });

  /**
   * V8-R-NO-005's accessibility line: "the deadline is expressed in time AND
   * REMAINING MINUTES in words, never by colour alone". The owner's form has
   * said both since it was written; this page — the only surface a participant
   * ever sees — stated the absolute New York time alone (round-10 round 8,
   * Codex).
   */
  test('a participant is told how long is left, not only the clock time', async () => {
    vi.setSystemTime(Date.parse(CLOSES_AT) - 40 * 60_000);
    fetchNightOutVoting.mockResolvedValue({
      votingClosesAt: CLOSES_AT,
      votingOpen: true,
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('night-out-deadline')).toBeTruthy(),
    );
    const words = screen.getByTestId('night-out-deadline').textContent ?? '';
    expect(words, 'the absolute time is still stated').toMatch(/9:00\s*PM/);
    expect(
      words,
      'a participant got a clock time in a zone that may not be theirs, and no remaining minutes',
    ).toMatch(/in about 40 minutes/);
  });

  /**
   * ROUND-10 ROUND 9, Codex. Round 8 tied the wording to `deadlineTick`, which
   * only fires inside the ten-minute approach window, and argued the coarse
   * phrasing made the long wait outside it harmless. Coarse is not stale: a
   * page opened six hours early still said "in about 6 hours" hours later.
   */
  test('the remaining-time wording keeps up while the page sits open', async () => {
    vi.setSystemTime(Date.parse(CLOSES_AT) - 40 * 60_000);
    fetchNightOutVoting.mockResolvedValue({
      votingClosesAt: CLOSES_AT,
      votingOpen: true,
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('night-out-deadline').textContent).toMatch(
        /in about 40 minutes/,
      ),
    );

    // Twenty minutes pass with no server round trip due.
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    await waitFor(() =>
      expect(
        screen.getByTestId('night-out-deadline').textContent,
        'the sentence whose whole job is to say how long is left was frozen at load',
      ).toMatch(/in about 20 minutes/),
    );
  });

  /**
   * ROUND-10 ROUND 9, Codex. `fetchNightOutVoting` rides alongside
   * `get_night_out` rather than through it, so it fails on its own: the plan
   * painted, `voting` became null, the effect returned, and `votingOpen` fell
   * back to the plan status. One blip left the vote editable past a deadline
   * the server was already enforcing, permanently.
   */
  test('a voting read LOST to a failed refresh is asked for again', async () => {
    vi.setSystemTime(Date.parse(CLOSES_AT) - 30_000);
    fetchNightOutVoting
      .mockResolvedValueOnce({ votingClosesAt: CLOSES_AT, votingOpen: true })
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ votingClosesAt: CLOSES_AT, votingOpen: false });

    renderPage();
    await waitFor(() => expect(screen.getByTestId('member-board')).toBeTruthy());
    expect(screen.queryByTestId('night-out-voting-closed')).toBeNull();

    // The deadline passes and the refresh blips: voting state is now unknown.
    await vi.advanceTimersByTimeAsync(31_000);
    await waitFor(() => expect(fetchNightOutVoting).toHaveBeenCalledTimes(2));

    // The floor has to keep asking; before this fix the timer was disarmed and
    // Suggest, Vote and Remove stayed live for good.
    await vi.advanceTimersByTimeAsync(61_000);
    await waitFor(() =>
      expect(
        screen.getByTestId('night-out-voting-closed'),
        'one failed voting read permanently disarmed the deadline timer',
      ).toBeTruthy(),
    );
  });
});
