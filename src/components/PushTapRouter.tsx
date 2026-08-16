'use client';

/**
 * PushTapRouter — connects a notification TAP to the app.
 *
 * `handlePushNavigation` and `routeForPushPayload` were fully written and fully
 * unit-tested, and imported by nothing but their own test file. No Capacitor
 * `pushNotificationActionPerformed` listener existed anywhere, so tapping a
 * delivered invitation opened the app at its default route and the plan never
 * appeared (cold panel, both lanes, HIGH). "Tapping opens that exact plan" is
 * an acceptance criterion of this goal, and it was dead code.
 *
 * Mounted in the root layout, like PendingInviteRedirect and OnboardingGate,
 * because a tap can arrive at ANY moment — including as a cold launch, where
 * the event is queued by the OS before React has rendered anything.
 *
 * Renders nothing. Attaches once; native `addListener` calls stack if repeated.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { handlePushNavigation } from '@/lib/pushDeepLink';
import { isNativePushAvailable } from '@/lib/nativePush';

let listenerAttached = false;

/** Test-only: module state would otherwise leak between vitest cases. */
export function __resetPushTapRouterForTests(): void {
  listenerAttached = false;
}

export default function PushTapRouter(): null {
  const auth = useAuth();
  const router = useRouter();

  /**
   * The listener is attached ONCE and outlives every auth transition, so it
   * cannot close over `auth.status` — that value would be frozen at attach
   * time and a tap arriving after sign-in would be routed as signed-out.
   * A ref updated every render is what makes "read at tap time" true rather
   * than merely claimed.
   */
  const signedInRef = useRef(auth.status === 'signed-in');
  signedInRef.current = auth.status === 'signed-in';
  // Same reasoning for the router: the listener outlives any single render, so
  // it must not close over a stale instance.
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!isNativePushAvailable() || listenerAttached) return;
    // Auth is still resolving: a tap handled now would be routed as signed-out
    // and would store a pending invite the user does not need. Wait — the OS
    // holds a cold-launch tap until a listener exists, so nothing is lost.
    if (auth.status === 'loading') return;

    listenerAttached = true;

    void (async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        await PushNotifications.addListener(
          'pushNotificationActionPerformed',
          (action) => {
            handlePushNavigation(action.notification?.data, {
              isSignedIn: signedInRef.current,
              navigate: (path) => routerRef.current.push(path),
            });
          },
        );
      } catch {
        // No plugin (web build) — nothing to attach, and nothing to report.
        listenerAttached = false;
      }
    })();

    // NO cleanup that disposes the listener. It is deliberately app-lifetime:
    // this effect re-runs whenever auth resolves, and a per-run `disposed` flag
    // (the first version of this) tore the listener down on that very first
    // transition while `listenerAttached` kept it from ever re-attaching — so
    // taps silently stopped working the moment a user signed in. React
    // double-invocation is already handled by `listenerAttached`.
  }, [auth.status]);

  return null;
}
