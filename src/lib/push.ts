import type { SupabaseClient } from '@supabase/supabase-js';
import { isWeekendNight } from '@/lib/cadence';

/**
 * Web Push subscription client (P1). SHIPS DARK: both env flags below are
 * unset in every current deployment, so isPushEnabled() is false, no UI
 * calls into this module, and nothing here executes. The wiring exists so
 * flipping the flags (+ applying migration 0009 + VAPID keys, both in the
 * escalation queue) turns the feature on without new code.
 *
 * Cadence gate (blueprint C1): push is a weekly "Time for your Next Bar"
 * nudge, Thu–Sat nights only — the OPT-IN prompt follows the same cadence
 * so users are asked in the moment the feature is about, not on a random
 * Tuesday (cadence.ts owns that predicate).
 */

/** Both must be present: the flag to arm, the key to actually subscribe. */
export function isPushEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_PUSH_ENABLED === '1' &&
    typeof process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY === 'string' &&
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY.length > 0
  );
}

/**
 * Null when the opt-in prompt should not render: feature dark, wrong night
 * (cadence), notifications unsupported, or permission already denied.
 */
export function getPushOptInPrompt(now: Date): string | null {
  if (!isPushEnabled()) return null;
  if (!isWeekendNight(now)) return null;
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  if (Notification.permission === 'denied') return null;
  return 'Get a nudge when it’s time for your next bar?';
}

/** VAPID public key (base64url) → the Uint8Array subscribe() wants. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export type PushSubscribeResult =
  | 'subscribed'
  | 'disabled'
  | 'unsupported'
  | 'permission-denied'
  | 'failed';

/**
 * Full opt-in flow: permission → SW pushManager.subscribe → persist via
 * the 0009 save_push_subscription RPC. Any failure is a plain result
 * string — callers render copy, nothing throws.
 */
export async function subscribeToPush(
  supabase: SupabaseClient,
): Promise<PushSubscribeResult> {
  if (!isPushEnabled()) return 'disabled';
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return 'unsupported';
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'permission-denied';

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
      ),
    });

    const json = subscription.toJSON();
    const p256dh = json.keys?.p256dh;
    const authKey = json.keys?.auth;
    if (!json.endpoint || !p256dh || !authKey) return 'failed';

    const { data, error } = await supabase.rpc('save_push_subscription', {
      sub_endpoint: json.endpoint,
      sub_p256dh: p256dh,
      sub_auth: authKey,
    });
    if (error || data !== true) {
      // Server refused (cap, validation, missing 0009) — don't keep a
      // browser subscription the backend will never send to.
      await subscription.unsubscribe().catch(() => {});
      return 'failed';
    }
    return 'subscribed';
  } catch {
    return 'failed';
  }
}

/**
 * Tear down: browser unsubscribe + row removal. Best-effort on both
 * sides; true when the browser side is gone (the row cascade-dies with
 * the account anyway).
 *
 * DELIBERATELY not gated by isPushEnabled (unlike subscribe): teardown
 * must keep working after the operator turns the flag OFF, or disabling
 * the feature would strand live browser subscriptions forever.
 */
export async function unsubscribeFromPush(
  supabase: SupabaseClient,
): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return false;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return true;
    const endpoint = subscription.endpoint;
    const removed = await subscription.unsubscribe();
    await supabase
      .rpc('delete_push_subscription', { sub_endpoint: endpoint })
      .then(
        () => undefined,
        () => undefined,
      );
    return removed;
  } catch {
    return false;
  }
}
