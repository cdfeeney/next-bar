import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * NotificationPreferences (V8-4). Mocking convention matches
 * StartNightOutButton.readFailure.test.tsx: mutable module-level state,
 * declared before the vi.mock() calls that close over it, component
 * imported after the mocks.
 */

type AuthState =
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: { id: string } };

let authState: AuthState = { status: 'signed-out' };
let prefsRow: Record<string, boolean> | null = null;
let prefsError: unknown = null;
let rpcResult: { data?: unknown; error?: unknown } = { data: true };
let onRpc: (() => void) | null = null;
const rpcCalls: Array<{ fn: string; args: unknown }> = [];
let nativeAvailable = false;
let nativeResult: string = 'registered';
let registerCalls = 0;

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => authState,
}));

// Mutable so a test can bump it MID-SAVE, which is what a sign-out does. A
// constant epoch made the guard that reads it unreachable, and the wedge it
// caused invisible.
let cacheEpoch = 1;
vi.mock('@/lib/accountCache', () => ({
  getCacheEpoch: () => cacheEpoch,
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: prefsRow, error: prefsError }),
        }),
      }),
    }),
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      // Fires while the call is in flight — the window a sign-out lands in.
      onRpc?.();
      return Promise.resolve(rpcResult);
    },
  }),
}));

vi.mock('@/lib/nativePush', () => ({
  isNativePushAvailable: () => nativeAvailable,
  markPromptedForNativePush: () => undefined,
  registerNativePush: async () => {
    registerCalls += 1;
    return nativeResult;
  },
}));

import NotificationPreferences from './NotificationPreferences';

const LABELS = [
  /When someone invites you to a Night Out/i,
  /When someone accepts your invitation/i,
  /When someone suggests a bar/i,
  /When the plan changes/i,
];

beforeEach(() => {
  authState = { status: 'signed-out' };
  prefsRow = null;
  prefsError = null;
  rpcResult = { data: true };
  rpcCalls.length = 0;
  cacheEpoch = 1;
  onRpc = null;
  nativeAvailable = false;
  nativeResult = 'registered';
  registerCalls = 0;
});

describe('NotificationPreferences — signed out', () => {
  test('shows a short explanation instead of broken toggles', () => {
    render(<NotificationPreferences />);
    expect(screen.getByText(/Sign in to choose which Night Out notifications/i)).toBeTruthy();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });
});

describe('NotificationPreferences — signed in', () => {
  beforeEach(() => {
    authState = { status: 'signed-in', user: { id: 'user-1' } };
  });

  test('a missing preferences row defaults every toggle to ON', async () => {
    render(<NotificationPreferences />);
    const switches = await screen.findAllByRole('switch');
    expect(switches).toHaveLength(4);
    for (const s of switches) {
      expect(s.getAttribute('aria-checked')).toBe('true');
    }
    for (const label of LABELS) {
      expect(screen.getByRole('switch', { name: label })).toBeTruthy();
    }
  });

  test('a stored row with one preference OFF renders that toggle unchecked', async () => {
    prefsRow = { invited: false, accepted: true, bar_suggested: true, plan_changed: true };
    render(<NotificationPreferences />);
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(4));
    expect(
      screen.getByRole('switch', { name: /invites you to a Night Out/i }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      screen.getByRole('switch', { name: /accepts your invitation/i }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  test('toggling saves via set_notification_preferences with all four current values', async () => {
    const user = userEvent.setup();
    render(<NotificationPreferences />);
    const toggle = await screen.findByRole('switch', { name: /invites you to a Night Out/i });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    await user.click(toggle);

    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual({
      fn: 'set_notification_preferences',
      args: {
        p_invited: false,
        p_accepted: true,
        p_bar_suggested: true,
        p_plan_changed: true,
      },
    });
  });

  test('a failed save reverts the toggle and shows an error — never silently swallowed', async () => {
    rpcResult = { data: false };
    const user = userEvent.setup();
    render(<NotificationPreferences />);
    const toggle = await screen.findByRole('switch', { name: /plan changes/i });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    await user.click(toggle);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/didn.t save/i),
    );
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  test('toggling does not navigate away or unmount the settings surface (negative assertion)', async () => {
    const user = userEvent.setup();
    const { container } = render(<NotificationPreferences />);
    const toggle = await screen.findByRole('switch', { name: /suggests a bar/i });
    await user.click(toggle);
    await waitFor(() => expect(rpcCalls).toHaveLength(1));
    // Still the same tree — the whole notifications section, not a redirect.
    expect(container.querySelector('h2')?.textContent).toBe('Notifications');
    expect(screen.getAllByRole('switch')).toHaveLength(4);
  });

  test('does NOT call registerNativePush on mount', async () => {
    nativeAvailable = true;
    render(<NotificationPreferences />);
    await screen.findAllByRole('switch');
    expect(registerCalls).toBe(0);
  });

  test('the native-enable button is hidden when isNativePushAvailable() is false', async () => {
    nativeAvailable = false;
    render(<NotificationPreferences />);
    await screen.findAllByRole('switch');
    expect(screen.queryByRole('button', { name: /Enable on this device/i })).toBeNull();
  });

  test('the native-enable button registers and reports success', async () => {
    nativeAvailable = true;
    nativeResult = 'registered';
    const user = userEvent.setup();
    render(<NotificationPreferences />);
    const button = await screen.findByRole('button', { name: /Enable on this device/i });
    await user.click(button);

    await waitFor(() => expect(registerCalls).toBe(1));
    expect(
      await screen.findByRole('button', { name: /Notifications enabled on this device/i }),
    ).toBeTruthy();
  });

  test('a FAILED read renders an error and NO toggles, so nothing can be written over it', async () => {
    // The fail-open this replaced: an unreadable row rendered the all-on
    // defaults, and one tap then wrote those four fabricated values over the
    // user's real opt-outs.
    prefsError = { code: '08006' };
    render(<NotificationPreferences />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Couldn.t load your notification settings/i);
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(rpcCalls).toEqual([]);
  });

  test('a MISSING row still renders the four defaults', async () => {
    // The other half of the same distinction: no row is a real answer.
    prefsRow = null;
    prefsError = null;
    render(<NotificationPreferences />);

    const switches = await screen.findAllByRole('switch');
    expect(switches).toHaveLength(LABELS.length);
    for (const control of switches) {
      expect(control.getAttribute('aria-checked')).toBe('true');
    }
  });

  test('an account change refetches and never writes the previous account values', async () => {
    // The effect used to depend on auth.status alone and never reset, so the
    // outgoing account's toggles stayed on screen flagged as loaded. Since one
    // tap writes all four columns, that wrote user A's preferences into user
    // B's row.
    prefsRow = { invited: false, accepted: false, bar_suggested: false, plan_changed: false };
    const view = render(<NotificationPreferences />);
    const first = await screen.findAllByRole('switch');
    expect(first[0].getAttribute('aria-checked')).toBe('false');

    // User B, whose stored row has everything ON.
    authState = { status: 'signed-in', user: { id: 'user-2' } };
    prefsRow = { invited: true, accepted: true, bar_suggested: true, plan_changed: true };
    view.rerender(<NotificationPreferences />);

    await waitFor(() => {
      const switches = screen.getAllByRole('switch');
      expect(switches[0].getAttribute('aria-checked')).toBe('true');
    });
    // Nothing was written while the new account's row was in flight.
    expect(rpcCalls).toEqual([]);
  });

  test('signing out and back into the SAME account never shows all-ON defaults as loaded', async () => {
    // The regression the owner-tagged snapshot exists to prevent. While the
    // owner and the values were separate pieces of state, the sign-out reset
    // the values but left the owner, so re-login rendered fabricated all-ON
    // defaults as this account's loaded preferences — and one tap wrote them
    // over every saved opt-out.
    prefsRow = { invited: false, accepted: false, bar_suggested: false, plan_changed: false };
    const view = render(<NotificationPreferences />);
    const first = await screen.findAllByRole('switch');
    expect(first.every((s) => s.getAttribute('aria-checked') === 'false')).toBe(true);

    authState = { status: 'signed-out' };
    view.rerender(<NotificationPreferences />);
    expect(screen.queryAllByRole('switch')).toHaveLength(0);

    // Same account back. Assert BEFORE the refetch resolves.
    authState = { status: 'signed-in', user: { id: 'user-1' } };
    view.rerender(<NotificationPreferences />);
    expect(
      screen.queryAllByRole('switch').some((s) => s.getAttribute('aria-checked') === 'true'),
    ).toBe(false);
    expect(rpcCalls).toEqual([]);

    await waitFor(() => {
      const switches = screen.getAllByRole('switch');
      expect(switches.every((s) => s.getAttribute('aria-checked') === 'false')).toBe(true);
    });
  });

  test('a save interrupted by a sign-out does not wedge the toggles', async () => {
    // The busy flag was set before the await and cleared after a guard that
    // RETURNED first, so a sign-out landing mid-save left every toggle
    // disabled — for the next account too, since /settings stays mounted.
    onRpc = () => {
      cacheEpoch = 2;
    };
    const user = userEvent.setup();
    render(<NotificationPreferences />);
    const toggle = (await screen.findAllByRole('switch'))[0];

    await user.click(toggle);

    await waitFor(() => {
      expect((screen.getAllByRole('switch')[0] as HTMLButtonElement).disabled).toBe(false);
    });
  });

  test('a native registration failure shows an explanatory error, not a crash', async () => {
    nativeAvailable = true;
    nativeResult = 'permission-denied';
    const user = userEvent.setup();
    render(<NotificationPreferences />);
    const button = await screen.findByRole('button', { name: /Enable on this device/i });
    await user.click(button);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/off for Next Bar in iOS Settings/i);
  });
});
