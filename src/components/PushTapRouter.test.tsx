import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The tap path had complete, tested logic and no listener — so every test
 * passed while tapping a notification did nothing (cold panel, both lanes,
 * HIGH). These assert the WIRING, which is the part that was missing.
 */

let authStatus = 'signed-in';
let nativeAvailable = true;
const pushed: string[] = [];
const stored: string[] = [];
let listenerCount = 0;
let fire: ((action: unknown) => void) | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ status: authStatus }) }));
vi.mock('@/lib/nativePush', () => ({
  isNativePushAvailable: () => nativeAvailable,
}));
vi.mock('@/lib/pendingInvite', () => ({
  storePendingInvite: (token: string) => stored.push(token),
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: async (event: string, handler: (action: unknown) => void) => {
      if (event === 'pushNotificationActionPerformed') {
        listenerCount += 1;
        fire = handler;
      }
      return { remove: async () => undefined };
    },
  },
}));

import PushTapRouter, { __resetPushTapRouterForTests } from './PushTapRouter';

const TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const tap = (data: unknown) => fire?.({ notification: { data } });

beforeEach(() => {
  __resetPushTapRouterForTests();
  authStatus = 'signed-in';
  nativeAvailable = true;
  pushed.length = 0;
  stored.length = 0;
  listenerCount = 0;
  fire = null;
});

describe('PushTapRouter', () => {
  test('a tap opens that exact plan', async () => {
    render(<PushTapRouter />);
    await waitFor(() => expect(fire).not.toBeNull());
    tap({ nightOutToken: TOKEN, eventType: 'invited' });
    expect(pushed, 'tapping a notification did not open the plan').toEqual([
      `/night-out/${TOKEN}`,
    ]);
  });

  test('a signed-out tap stores the handoff AND still opens the preview', async () => {
    authStatus = 'signed-out';
    render(<PushTapRouter />);
    await waitFor(() => expect(fire).not.toBeNull());
    tap({ nightOutToken: TOKEN, eventType: 'invited' });
    expect(stored).toEqual([TOKEN]);
    expect(pushed).toEqual([`/night-out/${TOKEN}`]);
  });

  test('auth is read at TAP time, not at attach time', async () => {
    // The listener attaches once and outlives auth transitions. A closure over
    // auth.status would freeze it here and misroute every later tap as
    // signed-out — which is what the first version of this component did.
    authStatus = 'signed-out';
    const view = render(<PushTapRouter />);
    await waitFor(() => expect(fire).not.toBeNull());

    authStatus = 'signed-in';
    view.rerender(<PushTapRouter />);
    tap({ nightOutToken: TOKEN, eventType: 'invited' });

    expect(stored, 'a signed-IN tap was treated as signed-out').toEqual([]);
    expect(pushed).toEqual([`/night-out/${TOKEN}`]);
  });

  test('a malformed payload navigates nowhere', async () => {
    render(<PushTapRouter />);
    await waitFor(() => expect(fire).not.toBeNull());
    tap({ nightOutToken: 'not-a-uuid', eventType: 'invited' });
    tap({ nightOutToken: TOKEN, eventType: 'made-up' });
    tap(null);
    expect(pushed).toEqual([]);
    expect(stored).toEqual([]);
  });

  test('attaches exactly once across re-renders', async () => {
    // Native addListener calls stack; a second listener means two navigations
    // per tap.
    const view = render(<PushTapRouter />);
    await waitFor(() => expect(listenerCount).toBe(1));
    view.rerender(<PushTapRouter />);
    view.rerender(<PushTapRouter />);
    expect(listenerCount).toBe(1);
  });

  test('does nothing on a non-native build', async () => {
    nativeAvailable = false;
    render(<PushTapRouter />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listenerCount).toBe(0);
  });

  test('waits for auth to resolve before attaching', async () => {
    // Handling a tap while auth is still loading would route it as signed-out
    // and store a pending invite the user does not need. The OS holds a
    // cold-launch tap until a listener exists, so waiting loses nothing.
    authStatus = 'loading';
    const view = render(<PushTapRouter />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listenerCount).toBe(0);

    authStatus = 'signed-in';
    view.rerender(<PushTapRouter />);
    await waitFor(() => expect(listenerCount).toBe(1));
  });
});
