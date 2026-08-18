import type { SupabaseClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

/**
 * Native APNs device-token registration (V8-4, migration 0060).
 *
 * DELIBERATELY separate from the DARK web-push module in push.ts — this
 * targets the Capacitor iOS shell only, stores into native_device_tokens,
 * and never reads or references a VAPID key.
 *
 * `@capacitor/core` is safe to import at the top level: it initializes
 * against `globalThis` (not `window`), so it no-ops harmlessly under SSR and
 * in the Vitest/jsdom environment. `@capacitor/push-notifications` is NOT —
 * it assumes a native runtime is present, so it is imported dynamically,
 * inside the functions that need it, and only after isNativePushAvailable()
 * has confirmed we're on a Capacitor iOS shell. This keeps the plain web
 * build and the test environment from ever needing the native module to
 * exist at load time.
 */

const INSTALLATION_ID_KEY = 'next-bar:native-push-installation:v1';
const PROMPTED_KEY = 'next-bar:native-push-prompted:v1';

// Mirrors the CHECK constraints on native_device_tokens (0060) — validating
// client-side before an RPC round trip is a courtesy, not the boundary; the
// database still enforces its own copy of both regexes.
const INSTALLATION_RE = /^[0-9a-zA-Z-]{8,64}$/;
const TOKEN_HEX_RE = /^[0-9a-fA-F]{32,512}$/;

// ponytail: fixed timeout rather than a cancellable registration handle —
// good enough for one register() call; revisit if a caller ever needs to
// abort mid-flight.
const REGISTRATION_TIMEOUT_MS = 15_000;

export type NativePushResult =
  | 'registered'
  | 'unsupported'
  | 'permission-denied'
  | 'failed';

/** True only on a Capacitor native iOS build. Safe during SSR and in a plain browser — never throws. */
export function isNativePushAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  } catch {
    return false;
  }
}

/** Stable per-install id, created once and persisted — this is what token rotation updates in place and what sign-out revokes. */
export function getInstallationId(): string {
  if (typeof window === 'undefined') return crypto.randomUUID();
  try {
    const existing = window.localStorage.getItem(INSTALLATION_ID_KEY);
    if (existing !== null && INSTALLATION_RE.test(existing)) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(INSTALLATION_ID_KEY, created);
    return created;
  } catch {
    // Private mode / quota — a per-call id still satisfies the shape callers
    // need; it just won't survive a reload.
    return crypto.randomUUID();
  }
}

export function hasPromptedForNativePush(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PROMPTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markPromptedForNativePush(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROMPTED_KEY, '1');
  } catch {
    // best-effort — worst case the prompt fires again next launch
  }
}

/** Strips anything that isn't a hex digit and lowercases — defensive against a token wrapped in the odd log-style `<...>`/whitespace formatting. */
function normalizeTokenToHex(raw: string): string {
  return raw.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

// Module state for the persistent registration listeners. Attached ONCE
// (native `addListener` calls stack if repeated) and kept alive for the
// life of the app, because APNs can hand the OS a rotated token at any time,
// not only in direct response to register() — a listener scoped to a single
// registerNativePush() call would miss that rotation entirely.
let listenersAttached = false;
let activeSupabase: SupabaseClient | null = null;
let pendingResolve: ((result: NativePushResult) => void) | null = null;

/** Test-only: module state would otherwise leak between vitest cases (useAuth.ts convention). */
export function __resetNativePushStateForTests(): void {
  listenersAttached = false;
  activeSupabase = null;
  pendingResolve = null;
}

/** Normalizes, validates, and persists one token under the caller's installation id. Runs on every 'registration' event, including rotations that fire long after the call that first attached the listener. */
async function saveToken(rawToken: string): Promise<NativePushResult> {
  const hex = normalizeTokenToHex(rawToken);
  if (!TOKEN_HEX_RE.test(hex) || activeSupabase === null) return 'failed';
  try {
    const { data, error } = await activeSupabase.rpc('save_native_device_token', {
      p_token: hex,
      p_platform: 'ios',
      p_installation: getInstallationId(),
    });
    // false covers both a missing RPC (pre-0060) and a device-cap refusal —
    // neither is a crash, both are simply "not registered".
    return !error && data === true ? 'registered' : 'failed';
  } catch {
    return 'failed';
  }
}

type PushNotificationsPlugin =
  typeof import('@capacitor/push-notifications')['PushNotifications'];

async function ensureListeners(plugin: PushNotificationsPlugin): Promise<void> {
  if (listenersAttached) return;
  listenersAttached = true;
  await plugin.addListener('registration', (token) => {
    void saveToken(token.value).then((result) => {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve?.(result);
    });
  });
  await plugin.addListener('registrationError', () => {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve?.('failed');
  });
}

/**
 * Full opt-in flow: permission -> register() -> the 'registration' listener
 * yields a token -> save via the 0060 RPC. Any failure is a plain result
 * string; this never throws.
 */
/**
 * `promptIfNeeded: false` REGISTERS without ever showing the OS permission
 * dialog: it checks the existing permission and gives up if it is not already
 * granted.
 *
 * The distinction is the whole point (cold panel, Codex, HIGH). The
 * once-per-install latch is a rule about PROMPTING, and it was gating
 * registration itself — so after the single prompt, the token was never
 * re-registered. APNs rotates tokens whenever it likes, a reinstall issues a
 * new one, and a user who grants permission later in iOS Settings never had one
 * saved at all. In each case the server kept a stale or absent token and the
 * notifications this feature exists to send went nowhere, silently.
 *
 * Prompting stays once. Registering happens whenever we are already allowed.
 */
export async function registerNativePush(
  supabase: SupabaseClient,
  { promptIfNeeded = true }: { promptIfNeeded?: boolean } = {},
): Promise<NativePushResult> {
  if (!isNativePushAvailable()) return 'unsupported';

  let plugin: PushNotificationsPlugin;
  try {
    ({ PushNotifications: plugin } = await import('@capacitor/push-notifications'));
  } catch {
    return 'unsupported';
  }

  activeSupabase = supabase;

  try {
    const existing = await plugin.checkPermissions();
    if (existing.receive !== 'granted') {
      if (!promptIfNeeded) return 'permission-denied';
      const permission = await plugin.requestPermissions();
      if (permission.receive !== 'granted') return 'permission-denied';
    }

    await ensureListeners(plugin);

    return await new Promise<NativePushResult>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const settle = (result: NativePushResult): void => {
        clearTimeout(timer);
        resolve(result);
      };
      timer = setTimeout(() => {
        if (pendingResolve === settle) {
          pendingResolve = null;
          settle('failed');
        }
      }, REGISTRATION_TIMEOUT_MS);
      pendingResolve = settle;
      void plugin.register();
    });
  } catch {
    return 'failed';
  }
}

/** Sign-out / "disable on this device" — revokes only THIS installation's token. */
export async function revokeNativePushForThisInstallation(
  supabase: SupabaseClient,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('revoke_native_device_token', {
      p_installation: getInstallationId(),
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Account deletion — revokes every device this account ever registered. */
export async function revokeAllNativePush(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('revoke_all_native_device_tokens');
    // The RPC returns a count (0 is a legitimate success — nothing to revoke).
    return !error && typeof data === 'number';
  } catch {
    return false;
  }
}
