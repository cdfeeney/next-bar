import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import {
  __resetNativePushStateForTests,
  getInstallationId,
  hasPromptedForNativePush,
  isNativePushAvailable,
  markPromptedForNativePush,
  registerNativePush,
  revokeAllNativePush,
  revokeNativePushForThisInstallation,
} from '@/lib/nativePush';

/**
 * Native APNs registration (V8-4). @capacitor/push-notifications is mocked
 * because nativePush.ts imports it dynamically, inside registerNativePush —
 * vi.mock intercepts dynamic imports of the specifier the same as static
 * ones. @capacitor/core is the REAL package (safe under jsdom — it
 * initializes against globalThis, not window); its Capacitor.isNativePlatform
 * / getPlatform are plain mutable object properties, so tests stub them
 * directly rather than mocking the whole module.
 */

const pushMocks = vi.hoisted(() => ({
  requestPermissions: vi.fn(),
  // registerNativePush now CHECKS the existing permission before deciding
  // whether to prompt, so that the once-per-install prompt latch no longer
  // suppresses re-registration (cold panel, Codex, HIGH).
  checkPermissions: vi.fn(),
  register: vi.fn(),
  addListener: vi.fn(),
  removeAllListeners: vi.fn(),
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: pushMocks,
}));

type Listener = (arg: unknown) => void;

function captureListeners(): Record<string, Listener> {
  const listeners: Record<string, Listener> = {};
  pushMocks.addListener.mockImplementation(async (event: string, cb: Listener) => {
    listeners[event] = cb;
    return { remove: vi.fn() };
  });
  return listeners;
}

function fakeSupabase(rpcResults: Record<string, { data?: unknown; error?: unknown }>) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const client = {
    rpc(fn: string, args?: unknown) {
      calls.push({ fn, args });
      const r = rpcResults[fn] ?? {};
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

/** Flush the microtask queue so a fire-and-forget listener callback (no promise the caller awaits) settles before assertions run. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function stubNative(platform: 'ios' | 'web'): void {
  Capacitor.isNativePlatform = () => platform !== 'web';
  Capacitor.getPlatform = () => platform;
}

beforeEach(() => {
  __resetNativePushStateForTests();
  pushMocks.requestPermissions.mockReset();
  pushMocks.checkPermissions.mockReset();
  // Default: not yet granted, so the existing cases exercise the prompt path
  // exactly as they did before.
  pushMocks.checkPermissions.mockResolvedValue({ receive: 'prompt' });
  pushMocks.register.mockReset();
  pushMocks.addListener.mockReset();
  pushMocks.removeAllListeners.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isNativePushAvailable', () => {
  it('is false on a plain web build', () => {
    stubNative('web');
    expect(isNativePushAvailable()).toBe(false);
  });

  it('is true only on a Capacitor native iOS shell', () => {
    stubNative('ios');
    expect(isNativePushAvailable()).toBe(true);
  });

  it('never throws even if Capacitor is in a broken state', () => {
    Capacitor.isNativePlatform = () => {
      throw new Error('native bridge not ready');
    };
    expect(() => isNativePushAvailable()).not.toThrow();
    expect(isNativePushAvailable()).toBe(false);
  });
});

describe('getInstallationId', () => {
  it('creates a UUID once and persists it across calls', () => {
    const first = getInstallationId();
    const second = getInstallationId();
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-zA-Z-]{8,64}$/);
  });

  it('survives a corrupted stored value by minting a fresh id', () => {
    window.localStorage.setItem('next-bar:native-push-installation:v1', '!!!');
    const id = getInstallationId();
    expect(id).toMatch(/^[0-9a-zA-Z-]{8,64}$/);
  });
});

describe('hasPromptedForNativePush / markPromptedForNativePush', () => {
  it('is false until marked, true after', () => {
    expect(hasPromptedForNativePush()).toBe(false);
    markPromptedForNativePush();
    expect(hasPromptedForNativePush()).toBe(true);
  });
});

describe('registerNativePush', () => {
  beforeEach(() => {
    stubNative('ios');
  });

  it('returns unsupported without touching permissions when not on native iOS', async () => {
    stubNative('web');
    const { client } = fakeSupabase({});
    expect(await registerNativePush(client)).toBe('unsupported');
    expect(pushMocks.requestPermissions).not.toHaveBeenCalled();
  });

  it('permission denied short-circuits before register() is called', async () => {
    pushMocks.requestPermissions.mockResolvedValue({ receive: 'denied' });
    const { client } = fakeSupabase({});
    expect(await registerNativePush(client)).toBe('permission-denied');
    expect(pushMocks.register).not.toHaveBeenCalled();
  });

  it('happy path: permission granted, token normalized to hex and saved', async () => {
    const listeners = captureListeners();
    pushMocks.requestPermissions.mockResolvedValue({ receive: 'granted' });
    pushMocks.register.mockImplementation(async () => {
      listeners.registration({ value: 'ABCDEF0123456789ABCDEF0123456789' });
    });
    const { client, calls } = fakeSupabase({
      save_native_device_token: { data: true },
    });

    expect(await registerNativePush(client)).toBe('registered');
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('save_native_device_token');
    const args = calls[0].args as Record<string, unknown>;
    expect(args.p_token).toBe('abcdef0123456789abcdef0123456789');
    expect(args.p_platform).toBe('ios');
    expect(args.p_installation).toBe(getInstallationId());
  });

  it('registrationError maps to failed, not an exception', async () => {
    const listeners = captureListeners();
    pushMocks.requestPermissions.mockResolvedValue({ receive: 'granted' });
    pushMocks.register.mockImplementation(async () => {
      listeners.registrationError({ error: 'no APNs entitlement' });
    });
    const { client, calls } = fakeSupabase({});

    expect(await registerNativePush(client)).toBe('failed');
    expect(calls).toHaveLength(0);
  });

  it('the RPC returning false (device cap reached) is failed, not a crash', async () => {
    const listeners = captureListeners();
    pushMocks.requestPermissions.mockResolvedValue({ receive: 'granted' });
    pushMocks.register.mockImplementation(async () => {
      listeners.registration({ value: 'ABCDEF0123456789ABCDEF0123456789' });
    });
    const { client } = fakeSupabase({
      save_native_device_token: { data: false },
    });

    expect(await registerNativePush(client)).toBe('failed');
  });

  it('permission previously granted, later revoked at the OS level: re-registration reports denied', async () => {
    const listeners = captureListeners();
    pushMocks.requestPermissions.mockResolvedValueOnce({ receive: 'granted' });
    pushMocks.register.mockImplementation(async () => {
      listeners.registration({ value: 'ABCDEF0123456789ABCDEF0123456789' });
    });
    const { client } = fakeSupabase({ save_native_device_token: { data: true } });
    expect(await registerNativePush(client)).toBe('registered');

    pushMocks.requestPermissions.mockResolvedValueOnce({ receive: 'denied' });
    expect(await registerNativePush(client)).toBe('permission-denied');
  });

  it('token rotation: a later registration event with a different token re-saves under the same installation id', async () => {
    const listeners = captureListeners();
    pushMocks.requestPermissions.mockResolvedValue({ receive: 'granted' });
    pushMocks.register.mockImplementation(async () => {
      listeners.registration({ value: 'AAAAAAAA111111112222222233333333' });
    });
    const { client, calls } = fakeSupabase({
      save_native_device_token: { data: true },
    });

    expect(await registerNativePush(client)).toBe('registered');
    expect(calls).toHaveLength(1);

    // A rotation the OS delivers later, outside any registerNativePush()
    // call in flight — the persistent listener must still save it.
    listeners.registration({ value: 'BBBBBBBB444444445555555566666666' });
    await flush();

    expect(calls).toHaveLength(2);
    const first = calls[0].args as Record<string, unknown>;
    const second = calls[1].args as Record<string, unknown>;
    expect(first.p_token).toBe('aaaaaaaa111111112222222233333333');
    expect(second.p_token).toBe('bbbbbbbb444444445555555566666666');
    expect(second.p_installation).toBe(first.p_installation);
  });

  it('a plugin whose token value cannot normalize to a valid hex string fails cleanly', async () => {
    const listeners = captureListeners();
    pushMocks.requestPermissions.mockResolvedValue({ receive: 'granted' });
    pushMocks.register.mockImplementation(async () => {
      listeners.registration({ value: 'not-hex-at-all' });
    });
    const { client, calls } = fakeSupabase({});
    expect(await registerNativePush(client)).toBe('failed');
    expect(calls).toHaveLength(0);
  });

  it('never throws even if requestPermissions rejects', async () => {
    pushMocks.requestPermissions.mockRejectedValue(new Error('bridge error'));
    const { client } = fakeSupabase({});
    await expect(registerNativePush(client)).resolves.toBe('failed');
  });
});

describe('revokeNativePushForThisInstallation', () => {
  it('revokes the current installation and never throws', async () => {
    const { client, calls } = fakeSupabase({
      revoke_native_device_token: { data: true },
    });
    expect(await revokeNativePushForThisInstallation(client)).toBe(true);
    expect(calls[0]).toEqual({
      fn: 'revoke_native_device_token',
      args: { p_installation: getInstallationId() },
    });
  });

  it('a transport throw resolves false, not an exception', async () => {
    const client = {
      rpc: () => {
        throw new Error('network down');
      },
    } as unknown as SupabaseClient;
    await expect(revokeNativePushForThisInstallation(client)).resolves.toBe(false);
  });
});

describe('revokeAllNativePush', () => {
  it('reports success even when the count is zero', async () => {
    const { client } = fakeSupabase({ revoke_all_native_device_tokens: { data: 0 } });
    expect(await revokeAllNativePush(client)).toBe(true);
  });

  it('an RPC error resolves false, not a crash', async () => {
    const { client } = fakeSupabase({
      revoke_all_native_device_tokens: { error: { message: 'function does not exist' } },
    });
    expect(await revokeAllNativePush(client)).toBe(false);
  });
});

describe('registerNativePush — prompting is once, registering is not', () => {
  it('registers WITHOUT prompting when permission is already granted', async () => {
    // The defect: the once-per-install latch gated registration itself, so a
    // rotated token, a reinstall, or permission granted later in iOS Settings
    // left the server with a stale or absent token and nothing was ever sent.
    const listeners = captureListeners();
    pushMocks.checkPermissions.mockResolvedValue({ receive: 'granted' });
    pushMocks.register.mockImplementation(async () => {
      listeners.registration({ value: 'ABCDEF0123456789ABCDEF0123456789' });
    });
    const { client } = fakeSupabase({ save_native_device_token: { data: true } });

    expect(await registerNativePush(client, { promptIfNeeded: false })).toBe('registered');
    expect(
      pushMocks.requestPermissions,
      'a silent re-registration showed the OS permission dialog',
    ).not.toHaveBeenCalled();
  });

  it('does NOT prompt when told not to and permission is missing', async () => {
    pushMocks.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    const { client } = fakeSupabase({});
    expect(await registerNativePush(client, { promptIfNeeded: false })).toBe(
      'permission-denied',
    );
    expect(pushMocks.requestPermissions).not.toHaveBeenCalled();
  });
});
