import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Social · Tonight's own-pin state machine — the three round-3 findings, each of
 * which is a window between an intention and a write.
 *
 *  1. THE FIRST READ IS A STATE (Codex, HIGH). While `get_my_presence` was in
 *     flight the component looked exactly like "you have no pin", so the status
 *     pills rendered enabled and a tap in that window wrote the 'friends'
 *     default over a live 'close' or 'people' pin.
 *  2. SELECTING A BAR IS NOT PUBLISHING ONE (Codex, HIGH). Picking a bar wrote
 *     it immediately with whatever audience was lying around, so a first-time
 *     pinner's location went out before anyone asked who should see it.
 *  3. A STALE READ MUST NOT REPAINT (Codex, HIGH). `reloadMine` painted
 *     unconditionally after its await, so a read for account A could settle
 *     after a sign-out and put A's bar back on screen.
 *
 * The reads are DEFERRED, not resolved: all three defects live in the window
 * between issuing a read and painting it, and a test that cannot hold a
 * response open cannot express them.
 *
 * This file sits under `src/lib/presence/` — the module whose contract it is
 * about — rather than beside the component, whose directory this lane owns one
 * named file in and not a test alongside it.
 */

class Deferred<T> {
  readonly promise: Promise<T>;
  private settle!: (value: T) => void;
  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.settle = resolve;
    });
  }
  resolve(value: T): void {
    this.settle(value);
  }
}

type Auth = {
  status: 'loading' | 'signed-in' | 'signed-out';
  user?: { id: string };
};
let auth: Auth = { status: 'signed-in', user: { id: 'u1' } };

const fetchMyPresence = vi.fn();
const setPresence = vi.fn();
const clearPresence = vi.fn();
const refresh = vi.fn();

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useFollows', () => ({
  useFollows: () => ({ mutuals: [], loading: false }),
}));
vi.mock('@/lib/useBars', () => ({ useBars: () => undefined }));
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }));
vi.mock('@/lib/catalog', () => ({
  getBarById: (id: string) => ({ id, name: `Bar ${id}` }),
}));
vi.mock('@/lib/presence/server', () => ({
  fetchMyPresence: (...a: unknown[]) => fetchMyPresence(...a),
  setPresence: (...a: unknown[]) => setPresence(...a),
  clearPresence: (...a: unknown[]) => clearPresence(...a),
}));
vi.mock('../../app/friends/_components/usePinnedHandles', () => ({
  usePinnedHandles: () => ({
    loading: false,
    rows: [],
    night: '2026-08-20',
    refresh,
  }),
  announcePresenceChanged: vi.fn(),
  PRESENCE_CHANGED_EVENT: 'next-bar:presence-changed',
}));
// The bar dialog is another packet's surface; what matters here is what the
// component does with the bar it hands back.
vi.mock('@/lib/presence/PinDialogs', () => ({
  PinBarDialog: ({ onPick }: { onPick: (bar: { id: string }) => void }) => (
    <button type="button" data-testid="fake-pick" onClick={() => onPick({ id: 'attaboy' })}>
      pick attaboy
    </button>
  ),
  PinAudienceDialog: () => null,
}));

import TonightPresence from '../../app/friends/_components/TonightPresence';

const LIVE_CLOSE_PIN = {
  status: 'going' as const,
  barId: 'attaboy',
  audience: 'close' as const,
  recipientIds: [] as string[],
  updatedAt: '2026-08-20T02:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  auth = { status: 'signed-in', user: { id: 'u1' } };
  setPresence.mockResolvedValue(true);
  clearPresence.mockResolvedValue(true);
});

describe('the own-pin read is a THREE-state answer', () => {
  test('the status pills are disabled until the server has answered', async () => {
    const held = new Deferred<{ kind: 'ok'; presence: typeof LIVE_CLOSE_PIN }>();
    fetchMyPresence.mockReturnValue(held.promise);

    render(<TonightPresence />);

    // In flight: we do not know what the pin is, so no tap may build a write.
    await expect(
      screen.findByTestId('my-pin-loading'),
    ).resolves.toBeTruthy();
    for (const label of ['Going out', 'Maybe', 'Not going']) {
      const pill = screen.queryByRole('button', { name: label });
      if (pill !== null) expect(pill).toBeDisabled();
    }
    // The assertion that actually protects the user: nothing was written.
    expect(setPresence).not.toHaveBeenCalled();
    expect(clearPresence).not.toHaveBeenCalled();

    held.resolve({ kind: 'ok', presence: LIVE_CLOSE_PIN });
    await waitFor(() =>
      expect(screen.queryByTestId('my-pin-loading')).toBeNull(),
    );
  });

  test('"could not read" and "still reading" say different things', async () => {
    fetchMyPresence.mockResolvedValue({ kind: 'failed' });
    render(<TonightPresence />);
    await expect(screen.findByTestId('my-pin-error')).resolves.toBeTruthy();
    expect(screen.queryByTestId('my-pin-loading')).toBeNull();
  });

  /**
   * NO PIN IS AN ANSWER, NOT A FAILURE — and it is the answer every account
   * gets on every night before its first pin.
   *
   * Round 3 collapsed `fetchMyPresence`'s three kinds into two with a ternary,
   * so `unset` landed in `unreadable`: the pills sat disabled behind "couldn't
   * check your pin" and no account could ever set a first status. The round-3
   * suite was green through it because every mock returned 'ok' or 'failed'.
   * This is the case that was missing.
   */
  test('a signed-in account with NO pin can still set one', async () => {
    fetchMyPresence.mockResolvedValue({ kind: 'unset' });
    render(<TonightPresence />);

    const going = await screen.findByRole('button', { name: 'Going out' });
    await waitFor(() => expect(going).not.toBeDisabled());
    expect(screen.queryByTestId('my-pin-error')).toBeNull();
    expect(screen.queryByTestId('my-pin-loading')).toBeNull();

    // And the tap actually writes, with the contract's default audience.
    going.click();
    await waitFor(() => expect(setPresence).toHaveBeenCalledTimes(1));
    expect(setPresence.mock.calls[0]?.[1]).toEqual({
      status: 'going',
      barId: null,
      audience: 'friends',
      recipientIds: [],
    });
  });
});

describe('a read the view has moved on from cannot repaint', () => {
  test('an authenticated own-pin read settling AFTER sign-out shows no pin', async () => {
    const held = new Deferred<{ kind: 'ok'; presence: typeof LIVE_CLOSE_PIN }>();
    fetchMyPresence.mockReturnValue(held.promise);

    const view = render(<TonightPresence />);
    await waitFor(() => expect(fetchMyPresence).toHaveBeenCalled());

    // Sign out while the authenticated read is still in flight.
    auth = { status: 'signed-out' };
    view.rerender(<TonightPresence />);

    // ...and only now does the authenticated answer arrive.
    held.resolve({ kind: 'ok', presence: LIVE_CLOSE_PIN });

    await waitFor(() =>
      expect(screen.getByTestId('presence-signed-out')).toBeTruthy(),
    );
    expect(
      screen.queryByTestId('my-pin'),
      'a stale authenticated read put a private pin back on screen after sign-out',
    ).toBeNull();
  });
});

describe('the pin sequence publishes on confirmation, not on selection', () => {
  test('picking a bar opens the audience step and writes nothing', async () => {
    fetchMyPresence.mockResolvedValue({
      kind: 'ok',
      presence: {
        status: 'going',
        barId: null,
        audience: 'friends',
        recipientIds: [],
        updatedAt: '2026-08-20T02:00:00.000Z',
      },
    });

    render(<TonightPresence />);
    const pin = await screen.findByTestId('pin-my-spot');
    pin.click();
    (await screen.findByTestId('fake-pick')).click();

    await expect(
      screen.findByTestId('pin-audience-step'),
    ).resolves.toBeTruthy();
    expect(
      setPresence,
      'selecting a bar published the pin before anyone chose its audience',
    ).not.toHaveBeenCalled();

    // Confirming is the ONE write, and it carries bar and audience together.
    (await screen.findByTestId('pin-confirm')).click();
    await waitFor(() => expect(setPresence).toHaveBeenCalledTimes(1));
    expect(setPresence.mock.calls[0]?.[1]).toEqual({
      status: 'going',
      barId: 'attaboy',
      audience: 'friends',
      recipientIds: [],
    });
  });

  /**
   * A HALF-COMPOSED PIN BELONGS TO THE ACCOUNT AND NIGHT THAT COMPOSED IT
   * (round-3 panel, both gates).
   *
   * The pending bar, audience and recipient list are not written yet, and they
   * used to survive a sign-out: account B arrived at a live "Pin it" carrying
   * A's bar and A's recipients. The night rollover is the same defect on the
   * other axis.
   */
  test('a pending pin does not survive an identity change', async () => {
    fetchMyPresence.mockResolvedValue({
      kind: 'ok',
      presence: {
        status: 'going',
        barId: null,
        audience: 'friends',
        recipientIds: [],
        updatedAt: '2026-08-20T02:00:00.000Z',
      },
    });

    const view = render(<TonightPresence />);
    (await screen.findByTestId('pin-my-spot')).click();
    (await screen.findByTestId('fake-pick')).click();
    await expect(
      screen.findByTestId('pin-audience-step'),
    ).resolves.toBeTruthy();

    // Sign out on the same device, without a remount.
    auth = { status: 'signed-out' };
    view.rerender(<TonightPresence />);

    await waitFor(() =>
      expect(
        screen.queryByTestId('pin-audience-step'),
        "the previous account's composed pin was still on screen",
      ).toBeNull(),
    );
    expect(setPresence).not.toHaveBeenCalled();
  });

  test('cancelling the sequence writes nothing and closes the step', async () => {
    fetchMyPresence.mockResolvedValue({
      kind: 'ok',
      presence: {
        status: 'going',
        barId: null,
        audience: 'friends',
        recipientIds: [],
        updatedAt: '2026-08-20T02:00:00.000Z',
      },
    });

    render(<TonightPresence />);
    (await screen.findByTestId('pin-my-spot')).click();
    (await screen.findByTestId('fake-pick')).click();
    (await screen.findByTestId('pin-cancel')).click();

    await waitFor(() =>
      expect(screen.queryByTestId('pin-audience-step')).toBeNull(),
    );
    expect(setPresence).not.toHaveBeenCalled();
  });
});
