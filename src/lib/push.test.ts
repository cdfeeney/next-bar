import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getPushOptInPrompt,
  isPushEnabled,
  subscribeToPush,
  unsubscribeFromPush,
  urlBase64ToUint8Array,
} from '@/lib/push';

/**
 * P1 push scaffolding — the load-bearing property is DARKNESS: with the
 * env flags absent (current state of every deployment) nothing executes.
 * The rest exercises the flow against mocked browser APIs + supabase.
 */

// Friday 23:00 local — inside the Thu–Sat cadence window.
const FRIDAY_NIGHT = new Date('2026-07-24T23:00:00');
// Tuesday 23:00 — outside it.
const TUESDAY_NIGHT = new Date('2026-07-21T23:00:00');

const VAPID_KEY = 'BPd6ycn7EK4E1Zi8-abcdefghijklmnopqrstuvwxyz012345678';

function fakeSupabase(rpcResults: Record<string, { data?: unknown; error?: unknown }>) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const client = {
    rpc(fn: string, args: unknown) {
      calls.push({ fn, args });
      const r = rpcResults[fn] ?? {};
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

type SubscriptionShape = {
  endpoint: string;
  toJSON: () => { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  unsubscribe: () => Promise<boolean>;
};

function stubBrowserPush(opts: {
  permission?: NotificationPermission;
  requestResult?: NotificationPermission;
  subscription?: SubscriptionShape | null;
  subscribeThrows?: boolean;
  existingSubscription?: SubscriptionShape | null;
}) {
  const subscribeMock = vi.fn(async () => {
    if (opts.subscribeThrows) throw new Error('push service unavailable');
    return opts.subscription;
  });
  const registration = {
    pushManager: {
      subscribe: subscribeMock,
      getSubscription: vi.fn(async () => opts.existingSubscription ?? null),
    },
  };
  vi.stubGlobal('Notification', {
    permission: opts.permission ?? 'default',
    requestPermission: vi.fn(async () => opts.requestResult ?? 'granted'),
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration) },
  });
  return { subscribeMock, registration };
}

describe('push — dark by default (the shipping state)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_PUSH_ENABLED', '');
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('isPushEnabled is false with the flags absent', () => {
    expect(isPushEnabled()).toBe(false);
  });

  it('flag without key (and key without flag) still reads disabled', () => {
    vi.stubEnv('NEXT_PUBLIC_PUSH_ENABLED', '1');
    expect(isPushEnabled()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_PUSH_ENABLED', '');
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', VAPID_KEY);
    expect(isPushEnabled()).toBe(false);
  });

  it('opt-in prompt is null even on a weekend night', () => {
    expect(getPushOptInPrompt(FRIDAY_NIGHT)).toBeNull();
  });

  it('subscribeToPush returns disabled WITHOUT touching browser APIs', async () => {
    const notificationSpy = vi.fn();
    vi.stubGlobal('Notification', { requestPermission: notificationSpy });
    // Pin the full dark property (Opus review): serviceWorker must not be
    // reached either — a getter spy catches ANY access, not just calls.
    const swAccess = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get() {
        swAccess();
        return { ready: Promise.reject(new Error('must not be reached')) };
      },
    });
    const { client, calls } = fakeSupabase({});
    expect(await subscribeToPush(client)).toBe('disabled');
    expect(notificationSpy).not.toHaveBeenCalled();
    expect(swAccess).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

describe('push — enabled flow (mocked browser)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_PUSH_ENABLED', '1');
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', VAPID_KEY);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('cadence gates the opt-in prompt: weekend yes, Tuesday no', () => {
    stubBrowserPush({ permission: 'default' });
    expect(getPushOptInPrompt(FRIDAY_NIGHT)).toMatch(/next bar/i);
    expect(getPushOptInPrompt(TUESDAY_NIGHT)).toBeNull();
  });

  it('denied permission suppresses the prompt', () => {
    stubBrowserPush({ permission: 'denied' });
    expect(getPushOptInPrompt(FRIDAY_NIGHT)).toBeNull();
  });

  it('happy path: subscribes and persists via save_push_subscription', async () => {
    const subscription: SubscriptionShape = {
      endpoint: 'https://push.example/ep-1',
      toJSON: () => ({
        endpoint: 'https://push.example/ep-1',
        keys: { p256dh: 'key-p256dh', auth: 'key-auth' },
      }),
      unsubscribe: vi.fn(async () => true),
    };
    const { subscribeMock } = stubBrowserPush({ subscription });
    const { client, calls } = fakeSupabase({
      save_push_subscription: { data: true },
    });

    expect(await subscribeToPush(client)).toBe('subscribed');
    expect(subscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(calls).toEqual([
      {
        fn: 'save_push_subscription',
        args: {
          sub_endpoint: 'https://push.example/ep-1',
          sub_p256dh: 'key-p256dh',
          sub_auth: 'key-auth',
        },
      },
    ]);
  });

  it('permission refusal short-circuits before subscribing', async () => {
    const { subscribeMock } = stubBrowserPush({ requestResult: 'denied' });
    const { client, calls } = fakeSupabase({});
    expect(await subscribeToPush(client)).toBe('permission-denied');
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('server refusal rolls the browser subscription back (no orphan)', async () => {
    const unsubscribe = vi.fn(async () => true);
    const subscription: SubscriptionShape = {
      endpoint: 'https://push.example/ep-1',
      toJSON: () => ({
        endpoint: 'https://push.example/ep-1',
        keys: { p256dh: 'k', auth: 'a' },
      }),
      unsubscribe,
    };
    stubBrowserPush({ subscription });
    const { client } = fakeSupabase({
      // Pre-0009 (RPC missing) and cap-refusal both land here.
      save_push_subscription: { error: { message: 'function does not exist' } },
    });

    expect(await subscribeToPush(client)).toBe('failed');
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('subscribe throw maps to failed, not an exception', async () => {
    stubBrowserPush({ subscribeThrows: true });
    const { client } = fakeSupabase({});
    expect(await subscribeToPush(client)).toBe('failed');
  });

  it('unsubscribe removes browser + server sides, true with no subscription', async () => {
    const unsubscribe = vi.fn(async () => true);
    stubBrowserPush({
      existingSubscription: {
        endpoint: 'https://push.example/ep-1',
        toJSON: () => ({}),
        unsubscribe,
      },
    });
    const { client, calls } = fakeSupabase({
      delete_push_subscription: { data: true },
    });
    expect(await unsubscribeFromPush(client)).toBe(true);
    expect(unsubscribe).toHaveBeenCalled();
    expect(calls).toEqual([
      {
        fn: 'delete_push_subscription',
        args: { sub_endpoint: 'https://push.example/ep-1' },
      },
    ]);

    stubBrowserPush({ existingSubscription: null });
    expect(await unsubscribeFromPush(client)).toBe(true);
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes base64url with url-safe chars and padding', () => {
    // 'foob' in base64url is 'Zm9vYg' (unpadded).
    const bytes = urlBase64ToUint8Array('Zm9vYg');
    expect(Array.from(bytes)).toEqual([102, 111, 111, 98]);
  });
});
