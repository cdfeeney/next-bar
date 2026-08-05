'use client';

/**
 * SignInGate — layout-mounted login window for the INSTALLED APP
 * (goal g-31c59158, operator decision 2026-08-05 (a)).
 *
 * Someone who opened a dedicated app icon has already chosen Next Bar; giving
 * them no way in was the reported gap — confirmed live on Staging 2026-08-05
 * on both mobile viewports, where an unauthenticated open showed the catalog
 * and no sign-in affordance anywhere.
 *
 * SCOPE — deliberately narrow, because the signed-out WEB surface is a real
 * product, not an oversight (local-mode ratings, /install marketing, anonymous
 * browsing). This renders ONLY when all of the following hold:
 *   - the page is running as an installed app (display-mode: standalone, or
 *     iOS Safari's non-standard navigator.standalone);
 *   - auth has resolved to signed-out — never during 'loading' (which would
 *     flash the window at a signed-in user on every cold open) and never on
 *     'unavailable' (no Supabase configured = local mode, where there is no
 *     account to sign into at all);
 *   - the 21+ age gate has been acknowledged, so the legal gate is answered
 *     first and this never renders on top of it;
 *   - it has not already been dismissed in this app session.
 *
 * NOT a blocking wall: it offers "Sign in" and "Not now". The requirement is
 * that the app SHOWS a login window on unauthenticated open — not that it
 * denies anonymous use. Dismissal is sessionStorage-scoped, so it reappears on
 * the next cold open rather than being silenced forever. If the product later
 * wants a hard wall, remove the dismiss control — the surrounding conditions
 * stay the same.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';

/**
 * UI preference only — deliberately NOT registered in accountCache ALL_KEYS,
 * for the same reason as the age-gate ack and the onboarding flag: it holds no
 * account data, and a sign-out must not resurrect a window the person already
 * dismissed in this session.
 */
export const SIGNIN_GATE_DISMISSED_KEY = 'next-bar:signin-gate-dismissed:v1';
const AGE_ACK_KEY = 'next-bar:age-ack:v1';

/** True when the document is being displayed as an installed application. */
export function isInstalledAppDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    // matchMedia unavailable/throwing: fall through to the iOS flag.
  }
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

export default function SignInGate(): JSX.Element | null {
  const { status } = useAuth();
  // 'unknown' until the client-only checks resolve, so SSR and the first
  // client frame agree and the window never flashes.
  const [eligible, setEligible] = useState<'unknown' | 'yes' | 'no'>('unknown');

  useEffect(() => {
    if (!isInstalledAppDisplay()) {
      setEligible('no');
      return;
    }
    let ageAcked = false;
    let dismissed = false;
    try {
      ageAcked = window.localStorage.getItem(AGE_ACK_KEY) === '1';
      dismissed = window.sessionStorage.getItem(SIGNIN_GATE_DISMISSED_KEY) === '1';
    } catch {
      // Storage unavailable (private mode / webview quirks): treat the age
      // gate as UNacknowledged so the legal gate keeps priority, and treat the
      // window as undismissed. Fail toward showing the legal gate first.
      ageAcked = false;
      dismissed = false;
    }
    setEligible(ageAcked && !dismissed ? 'yes' : 'no');
  }, []);

  const dismiss = (): void => {
    try {
      window.sessionStorage.setItem(SIGNIN_GATE_DISMISSED_KEY, '1');
    } catch {
      // Best-effort: the window still closes for this render; it may return on
      // the next navigation. Never let a storage throw trap the user.
    }
    setEligible('no');
  };

  // Only a RESOLVED signed-out state opens this. 'loading' and 'unavailable'
  // both render nothing.
  if (eligible !== 'yes' || status !== 'signed-out') return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-gate-title"
      aria-describedby="signin-gate-body"
      // z-[1500]: above BottomNav (z-[1000]) so the nav cannot be tapped
      // behind it, but BELOW AgeGate (z-[2000]) — the 21+ gate is the legal
      // one and must always win. The age-ack condition above means both are
      // never open at once anyway; the ordering is defence in depth.
      className="fixed inset-0 z-[1500] flex items-end justify-center bg-black/70 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center"
    >
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
        <h2 id="signin-gate-title" className="text-xl font-semibold">
          Sign in to Next Bar
        </h2>
        <p id="signin-gate-body" className="mt-2 text-sm text-muted">
          Sign in to sync your ratings, see friends&apos; picks, and plan nights
          out together.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/auth"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-accent px-4 font-medium text-black"
          >
            Sign in
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm text-muted"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
