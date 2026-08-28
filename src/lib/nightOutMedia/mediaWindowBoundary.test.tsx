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
});
