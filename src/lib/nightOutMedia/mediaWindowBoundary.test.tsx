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
   * The one thing a skewed clock may cost is a single early round trip. If the
   * server still reports 'before' after the device thinks the start has passed,
   * the timer is not re-armed — the boundary is no longer in this device's
   * future — so there is no spin.
   */
  test('a boundary already past by this device does not re-arm', async () => {
    fetchNightOutMediaWindow.mockResolvedValue(BEFORE);

    render(<NightOutMedia planId={PLAN} canAddPhoto />);

    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(61_000);
    await waitFor(() => expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(2));

    // The device clock is now past `opensAt`, and the answer is unchanged.
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000 + 60_000);
    expect(fetchNightOutMediaWindow).toHaveBeenCalledTimes(2);
  });
});
