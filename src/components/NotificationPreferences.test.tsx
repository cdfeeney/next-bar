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
const rpcCalls: Array<{ fn: string; args: unknown }> = [];
let nativeAvailable = false;
let nativeResult: string = 'registered';
let registerCalls = 0;

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => authState,
}));

vi.mock('@/lib/accountCache', () => ({
  getCacheEpoch: () => 1,
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
