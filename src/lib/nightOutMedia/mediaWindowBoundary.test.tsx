import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * THE WINDOW TURNS WHILE THE PAGE IS OPEN (round-6 panel, Codex, MEDIUM).
 *
 * The recap read `night_out_media_window` once per plan and once more after a
 * successful attach, and nothing re-read it as the window's own boundary
 * passed. A page opened at 8:59 PM therefore stayed on the 'before' side past
 * the 9 PM scheduled start — no Add-a-photo, no Archive — until the member
 * reloaded by hand; one left open past the expiry went on offering both for a
 * write the server would refuse.
 *
 * The device clock still decides NOTHING about which side we are on. These
 * tests assert exactly that split: the timer fires, the SERVER is asked again,
 * and the surface follows the server's new answer.
 */

const fetchNightOutMedia = vi.fn();
const fetchNightOutMediaWindow = vi.fn();

vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }));
vi.mock('@/lib/nightOutMedia/MediaThumb', () => ({ default: () => null }));
vi.mock('@/lib/nightOutMedia/server', () => ({
  fetchNightOutMedia: (...a: unknown[]) => fetchNightOutMedia(...a),
  fetchNightOutMediaWindow: (...a: unknown[]) => fetchNightOutMediaWindow(...a),
  addNightOutMedia: vi.fn(),
  archiveNightOut: vi.fn(),
}));

import NightOutMedia from '../../app/night-out/[token]/NightOutMedia';

const PLAN = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-08-20T00:59:00.000Z');
const OPENS_AT = '2026-08-20T01:00:00.000Z';
const EXPIRES_AT = '2026-08-21T01:00:00.000Z';

const BEFORE = {
  opensAt: OPENS_AT,
  expiresAt: EXPIRES_AT,
  isOpen: false,
  state: 'before' as const,
};
const OPEN = { ...BEFORE, isOpen: true, state: 'open' as const };
const CLOSED = { ...BEFORE, isOpen: false, state: 'closed' as const };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  fetchNightOutMedia.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the media window re-asks the server at its own boundary', () => {
  test('a page open across the scheduled start reaches the open state without a reload', async () => {
    fetchNightOutMediaWindow
      .mockResolvedValueOnce(BEFORE)
      .mockResolvedValue(OPEN);

    render(<NightOutMedia planId={PLAN} canAddPhoto />);

    // Before the start: the server says 'before', so no write control is drawn.
    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('night-out-add-photo')).toBeNull();

    // The boundary passes. Nothing here decides the new side — the second read
    // does, and it is the server's.
    await vi.advanceTimersByTimeAsync(61_000);

    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId('night-out-add-photo')).toBeTruthy(),
    );
  });

  /**
   * ROUND-10 ROUND 7, Codex. A boundary this device thinks is still AHEAD used
   * to be waited for exactly, which is only right when the two clocks agree. On
   * a device running slow the SERVER crosses first and starts serving media,
   * while the recap goes on hiding both controls for the whole skew because its
   * own timer is not due yet. The behind case already had a floor; the approach
   * now has a cap, so neither direction of skew can hide a boundary for longer
   * than one extra read.
   */
  test('a boundary far ahead is still re-asked within a minute, for a slow clock', async () => {
    // This device believes the start is ten minutes away. The server has
    // already crossed it — which is exactly what the second answer says.
    vi.setSystemTime(Date.parse(OPENS_AT) - 10 * 60_000);
    fetchNightOutMediaWindow.mockResolvedValueOnce(BEFORE).mockResolvedValue(OPEN);

    render(<NightOutMedia planId={PLAN} canAddPhoto />);
    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('night-out-add-photo')).toBeNull();

    await vi.advanceTimersByTimeAsync(61_000);

    await waitFor(() =>
      expect(
        fetchNightOutMediaWindow,
        'a boundary ten minutes ahead was waited for exactly, so a slow clock hid it',
      ).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(screen.getByTestId('night-out-add-photo')).toBeTruthy(),
    );
  });

  test('a page open across the expiry stops offering a write it cannot land', async () => {
    vi.setSystemTime(Date.parse(EXPIRES_AT) - 60_000);
    fetchNightOutMediaWindow.mockResolvedValueOnce(OPEN).mockResolvedValue(CLOSED);

    render(<NightOutMedia planId={PLAN} canAddPhoto />);

    await waitFor(() =>
      expect(screen.getByTestId('night-out-add-photo')).toBeTruthy(),
    );

    await vi.advanceTimersByTimeAsync(61_000);

    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByTestId('night-out-add-photo')).toBeNull(),
    );
  });

  /**
   * ROUND-7 PANEL, BOTH LANES. A cancelled plan keeps its Archive control until
   * the window closes — that is deliberate, the night happened — so it has a
   * boundary like any other. Only 'before' and 'open' armed, so past `expiresAt`
   * the recap went on saying what is here can still be saved, for an archive the
   * server refuses.
   */
  test('a cancelled plan still reaches its expiry', async () => {
    const CANCELLED = { ...BEFORE, state: 'cancelled' as const };
    vi.setSystemTime(Date.parse(EXPIRES_AT) - 60_000);
    fetchNightOutMedia.mockResolvedValue([
      { destinationId: 'd1', mediaId: 'm1', authorId: 'u1', createdAt: '', expiresAt: '' },
    ]);
    fetchNightOutMediaWindow
      .mockResolvedValueOnce(CANCELLED)
      .mockResolvedValue(CLOSED);

    render(<NightOutMedia planId={PLAN} canAddPhoto />);

    await waitFor(() =>
      expect(screen.getByTestId('night-out-archive')).toBeTruthy(),
    );

    await vi.advanceTimersByTimeAsync(61_000);

    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByTestId('night-out-archive')).toBeNull(),
    );
  });

  /**
   * A settled side has no boundary ahead of it, and a window we could not read
   * has no instant to arm from. Neither may turn into a poll.
   */
  test('a closed window arms nothing', async () => {
    fetchNightOutMediaWindow.mockResolvedValue(CLOSED);

    render(<NightOutMedia planId={PLAN} canAddPhoto />);

    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000 + 60_000);
    expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(1);
  });

  test('a window that could not be read arms nothing', async () => {
    fetchNightOutMediaWindow.mockResolvedValue(null);

    render(<NightOutMedia planId={PLAN} canAddPhoto />);

    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000 + 60_000);
    expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(1);
  });

  /**
   * ROUND-10 ROUND 9, Codex — and the distinction the test above does NOT make.
   * Never having read a window is not the same as having read one and then
   * losing it. A single transport blip on a boundary refresh replaced a known
   * window with null, the effect returned without re-arming, and both controls
   * and every photo the server was serving stayed gone until a reload.
   */
  test('a window LOST to a failed refresh is asked for again', async () => {
    vi.setSystemTime(Date.parse(OPENS_AT) - 30_000);
    fetchNightOutMediaWindow
      .mockResolvedValueOnce(BEFORE)
      // The boundary refresh blips.
      .mockResolvedValueOnce(null)
      .mockResolvedValue(OPEN);

    render(<NightOutMedia planId={PLAN} canAddPhoto />);
    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(1));

    // The boundary passes and the refresh fails: the window is now unknown.
    await vi.advanceTimersByTimeAsync(31_000);
    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('night-out-add-photo')).toBeNull();

    // Nothing else re-reads on this side, so the floor has to. Before this fix
    // the timer was disarmed here and the count stayed at 2 forever.
    await vi.advanceTimersByTimeAsync(61_000);
    await waitFor(() =>
      expect(
        screen.getByTestId('night-out-add-photo'),
        'one failed read permanently disarmed the boundary timer',
      ).toBeTruthy(),
    );
  });

  /**
   * ROUND-7 PANEL, BOTH LANES — AND THIS TEST ASSERTED THE DEFECT.
   *
   * It used to demand that a boundary already behind this device arm NOTHING,
   * on the round-6 reasoning that a skew costs "at most one early round trip".
   * It does not. Nothing else re-reads the window on the 'before' side — both
   * controls are hidden, so there is no action to refresh from — so a fast
   * clock, or merely a response that arrives after its own boundary, stranded
   * the recap on the stale side for the whole session. It arms on the floor
   * instead, and stops as soon as the server's answer moves.
   */
  test('a boundary already behind this device keeps asking until the server moves', async () => {
    vi.setSystemTime(Date.parse(OPENS_AT) + 5 * 60_000); // this device is late/fast
    fetchNightOutMediaWindow
      .mockResolvedValueOnce(BEFORE)
      .mockResolvedValueOnce(BEFORE)
      .mockResolvedValue(OPEN);

    render(<NightOutMedia planId={PLAN} canAddPhoto />);

    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('night-out-add-photo')).toBeNull();

    // Still 'before' by the server: ask again on the floor rather than giving up.
    await vi.advanceTimersByTimeAsync(61_000);
    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(2));

    // The server crosses, and the surface follows it.
    await vi.advanceTimersByTimeAsync(61_000);
    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(screen.getByTestId('night-out-add-photo')).toBeTruthy(),
    );
  });

  /**
   * ROUND-9 PANEL. The floor round 7 introduced for a boundary already BEHIND
   * this device was applied to every delay, so a boundary five seconds AHEAD
   * waited a full minute — leaving Add-a-photo unavailable, or still offered,
   * for about fifty-four seconds past the server's own instant. The floor is
   * for the disagreement case; a boundary still ahead is waited for exactly.
   */
  test('a boundary a few seconds ahead is not rounded up to a minute', async () => {
    vi.setSystemTime(Date.parse(OPENS_AT) - 5_000);
    fetchNightOutMediaWindow.mockResolvedValueOnce(BEFORE).mockResolvedValue(OPEN);

    render(<NightOutMedia planId={PLAN} canAddPhoto />);

    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('night-out-add-photo')).toBeNull();

    // Ten seconds — past the boundary and its grace, nowhere near the floor.
    await vi.advanceTimersByTimeAsync(10_000);
    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId('night-out-add-photo')).toBeTruthy(),
    );
  });

  /**
   * ROUND-10 ROUND 8, BOTH LANES. Round 7 capped an AHEAD wait at a minute to
   * tolerate a slow clock. `Math.min(delay, 60_000)` does not mean "notice it a
   * minute late"; it means "ask again every minute, forever" — and the media
   * window stays open for 24 hours, so a left-open recap re-ran both its RPCs
   * 1,440 times a day while the code claimed at most one extra read per
   * approach. The tolerance is a WINDOW now: outside it, one wait.
   */
  test('a boundary hours ahead is waited for, not polled every minute', async () => {
    // Three hours before the expiry, on the open side.
    vi.setSystemTime(Date.parse(EXPIRES_AT) - 3 * 60 * 60 * 1_000);
    fetchNightOutMediaWindow.mockResolvedValue(OPEN);

    render(<NightOutMedia planId={PLAN} canAddPhoto />);
    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(1));

    // Half an hour of sitting on the page. The approach window has not opened,
    // so nothing is re-read: the previous shape had made thirty round trips.
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(
      fetchNightOutMediaWindow,
      'an ahead boundary was polled once a minute for the whole ahead period',
    ).toHaveBeenCalledTimes(1);

    // ...and the approach still opens in time to absorb a ten-minute skew.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1_000 + 21 * 60_000);
    expect(fetchNightOutMediaWindow.mock.calls.length).toBeGreaterThan(1);
  });

  /**
   * ROUND-10 ROUND 9, Codex. Round 8 slept the whole way to the window's edge
   * in ONE wait, which made the tolerance a constant: a device thirty minutes
   * slow was told the boundary was still twenty-one minutes off and hid media
   * the server had already begun serving for twenty of them. Halving the
   * remaining wait makes the lag scale with the error instead — at a
   * logarithmic number of reads, not one a minute.
   */
  test('a boundary hours ahead is re-asked well before the approach window', async () => {
    // Three hours by this device's clock; the server has ALREADY opened.
    vi.setSystemTime(Date.parse(OPENS_AT) - 3 * 60 * 60 * 1_000);
    fetchNightOutMediaWindow.mockResolvedValueOnce(BEFORE).mockResolvedValue(OPEN);

    render(<NightOutMedia planId={PLAN} canAddPhoto />);
    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('night-out-add-photo')).toBeNull();

    // Halved: the next ask is at about 90 minutes, not at 2h50m. Round 8's
    // single sleep would still have 80 minutes to run here.
    await vi.advanceTimersByTimeAsync(91 * 60_000);
    await waitFor(() =>
      expect(
        screen.getByTestId('night-out-add-photo'),
        'the wait ran to the window edge in one go, so a large skew hid the window for its whole length',
      ).toBeTruthy(),
    );
  });

  /**
   * ROUND-10 ROUND 8, Codex. The epoch separates PLANS; two reads of the SAME
   * plan share it, so the later one won on screen only if it also landed later.
   * A stalled pre-expiry read that returns AFTER a post-expiry one put
   * Add-a-photo and Archive back, for writes the server now refuses.
   */
  test('an older window response cannot reopen controls a newer one closed', async () => {
    vi.setSystemTime(Date.parse(EXPIRES_AT) - 60_000);
    let releaseFirst: (value: typeof OPEN) => void = () => undefined;
    fetchNightOutMediaWindow
      // The mount read answers immediately so the component settles.
      .mockResolvedValueOnce(OPEN)
      // The boundary read STALLS — this is the one that must not win.
      .mockReturnValueOnce(
        new Promise<typeof OPEN>((resolve) => {
          releaseFirst = resolve;
        }),
      )
      .mockResolvedValue(CLOSED);

    render(<NightOutMedia planId={PLAN} canAddPhoto />);
    await waitFor(() =>
      expect(screen.getByTestId('night-out-add-photo')).toBeTruthy(),
    );

    // The expiry passes: read 2 is issued and stalls. The timer re-arms on its
    // own tick rather than on the answer, so a later read goes out regardless
    // and comes back 'closed' first — which is the whole ordering this guards.
    await vi.advanceTimersByTimeAsync(3 * 61_000);
    await waitFor(() =>
      expect(screen.queryByTestId('night-out-add-photo')).toBeNull(),
    );

    // Now the older read lands, still saying the window was open.
    releaseFirst(OPEN);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      screen.queryByTestId('night-out-add-photo'),
      'an older response passed the plan-only epoch guard and reopened an expired window',
    ).toBeNull();
  });
});
