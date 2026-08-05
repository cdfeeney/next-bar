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
 *   - the page is running as an installed app (see isInstalledAppDisplay);
 *   - auth has resolved to signed-out — never during 'loading' (which would
 *     flash the window at a signed-in user on every cold open) and never on
 *     'unavailable' (no Supabase configured = local mode, where there is no
 *     account to sign into at all);
 *   - the 21+ age gate has been acknowledged, so the legal gate is answered
 *     first and this never renders on top of it;
 *   - the route is not one of EXCLUDED_PREFIXES — above all /auth, which this
 *     window's own button navigates to and would otherwise cover;
 *   - it has not already been dismissed in this app session.
 *
 * NOT a blocking wall: it offers "Sign in" and "Not now". The requirement is
 * that the app SHOWS a login window on unauthenticated open — not that it
 * denies anonymous use. Dismissal is sessionStorage-scoped, so it reappears on
 * the next cold open rather than being silenced forever. If the product later
 * wants a hard wall, remove the dismiss control — the surrounding conditions
 * stay the same.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { AGE_ACK_EVENT } from '@/lib/appEvents';

/**
 * UI preference only — deliberately NOT registered in accountCache ALL_KEYS,
 * for the same reason as the age-gate ack and the onboarding flag: it holds no
 * account data, so the account wipe has no business touching it.
 *
 * It IS cleared explicitly on a signed-in → signed-out transition (see below).
 * That is not a contradiction: staying out of ALL_KEYS means "not account
 * data", while the explicit clear answers a different question — the person
 * who dismissed this may not be the person holding the phone after a
 * sign-out (santa round-2/3).
 */
export const SIGNIN_GATE_DISMISSED_KEY = 'next-bar:signin-gate-dismissed:v1';
const AGE_ACK_KEY = 'next-bar:age-ack:v1';

// AGE_ACK_EVENT lives in @/lib/appEvents so the legal gate does not import
// this feature gate's module graph just to name a string (santa round-2).

/** Never cover these flows; /auth is where this window's own button sends you. */
const EXCLUDED_PREFIXES = ['/auth', '/onboarding', '/privacy', '/terms'];

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

/**
 * True when the document is being displayed as an installed application.
 *
 * Three signals, because the shells differ (santa round-1, Codex):
 *  - Capacitor native — the iOS shell. Today's internal TestFlight build is
 *    architecture "A" in docs/TESTFLIGHT-ARCH-DECISION-g-39169b3b: a
 *    WKWebView on a remote `server.url`. That ADR REJECTS A for release and
 *    adopts "C" (UI shipped as local assets, data via hosted APIs). Keying
 *    off `window.Capacitor` is correct for BOTH, because both are Capacitor —
 *    whereas in neither is `navigator.standalone` set (that is Safari-only)
 *    and under A display-mode reports `browser`. Checking only the two PWA
 *    signals would have meant this window never appeared in the shell it was
 *    written for.
 *  - display-mode: standalone — installed PWA (Android/desktop).
 *  - navigator.standalone — iOS Safari home-screen web app.
 */
export function isInstalledAppDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (cap) {
    try {
      if (cap.isNativePlatform?.() === true) return true;
      const platform = cap.getPlatform?.();
      if (platform && platform !== 'web') return true;
    } catch {
      // Malformed/partial Capacitor global — fall through to the PWA signals.
    }
  }
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    // matchMedia unavailable/throwing: fall through to the iOS flag.
  }
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

function readFlag(read: () => string | null): boolean {
  try {
    return read() === '1';
  } catch {
    // Storage unavailable (private mode / webview quirks).
    return false;
  }
}

export default function SignInGate(): JSX.Element | null {
  const { status } = useAuth();
  const pathname = usePathname();
  // 'unknown' until the client-only display check resolves, so SSR and the
  // first client frame agree and the window never flashes.
  const [installed, setInstalled] = useState<'unknown' | 'yes' | 'no'>('unknown');
  const [ageAcked, setAgeAcked] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const signInRef = useRef<HTMLAnchorElement | null>(null);
  const dismissRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setInstalled(isInstalledAppDisplay() ? 'yes' : 'no');
    setAgeAcked(readFlag(() => window.localStorage.getItem(AGE_ACK_KEY)));
    setDismissed(
      readFlag(() => window.sessionStorage.getItem(SIGNIN_GATE_DISMISSED_KEY)),
    );
  }, []);

  // React to the age gate being answered DURING this session, rather than
  // latching its value at mount.
  useEffect(() => {
    const onAcked = (): void => setAgeAcked(true);
    window.addEventListener(AGE_ACK_EVENT, onAcked);
    return () => window.removeEventListener(AGE_ACK_EVENT, onAcked);
  }, []);

  /**
   * A real sign-out re-arms the window (santa round-2, Fable).
   *
   * Dismissal is a session preference, but "I dismissed this" was answered by
   * whoever was using the app BEFORE the sign-out. Without this, one person
   * dismissing, signing in, then signing out left the gate suppressed for the
   * rest of the session — on a shared device the next person got exactly the
   * no-way-to-sign-in surface this feature exists to remove.
   */
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (status === 'signed-in') {
      wasSignedIn.current = true;
      return;
    }
    if (status === 'signed-out' && wasSignedIn.current) {
      wasSignedIn.current = false;
      try {
        window.sessionStorage.removeItem(SIGNIN_GATE_DISMISSED_KEY);
      } catch {
        // Best-effort; the state reset below is what actually re-arms it.
      }
      setDismissed(false);
    }
  }, [status]);

  const dismiss = useCallback((): void => {
    try {
      window.sessionStorage.setItem(SIGNIN_GATE_DISMISSED_KEY, '1');
    } catch {
      // Best-effort: the window still closes for this render. Never let a
      // storage throw trap the user.
    }
    setDismissed(true);
  }, []);

  const excluded = EXCLUDED_PREFIXES.some(
    (p) => pathname === p || pathname?.startsWith(`${p}/`),
  );
  const open =
    installed === 'yes' &&
    status === 'signed-out' &&
    ageAcked &&
    !dismissed &&
    !excluded;

  /**
   * Dialog keyboard contract — the same opener-capture pattern InstallPrompt
   * and BarLightbox use. `aria-modal` must not promise inertness the DOM does
   * not deliver (santa: this repo already learned that in g-43d6da5f).
   */
  useEffect(() => {
    if (!open) return;
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    signInRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        dismiss();
        return;
      }
      if (event.key !== 'Tab') return;
      // Exactly two focusable elements: keep Tab cycling between them.
      event.preventDefault();
      const active = document.activeElement;
      if (active === signInRef.current) dismissRef.current?.focus();
      else signInRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [open, dismiss]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-gate-title"
      aria-describedby="signin-gate-body"
      // INLINE zIndex, deliberately. With the `z-[1600]` utility class the
      // computed z-index was observed as `auto`, so BottomNav (z-1000)
      // painted ON TOP and swallowed taps on "Not now" — caught by the
      // dismiss e2e and pinned by hit-testing (elementFromPoint returned the
      // nav's link). The exact reason the class did not apply was NOT
      // established (Tailwind does scan src/**, so "JIT missed it" is not a
      // supported explanation — santa round-2, Codex); an inline value
      // removes the class-generation variable from a control the user must be
      // able to tap. 1600 = above BarLightbox (1500) so a lightbox opened
      // while auth was still resolving cannot cover this, above BottomNav
      // (1000), and below AgeGate (2000) because the 21+ gate is the legal
      // one and must always win.
      style={{ zIndex: 1600 }}
      // Backdrop dismiss, matching InstallPrompt's dialog convention; the
      // card below stops propagation so taps inside never close it.
      onClick={dismiss}
      // Vertically CENTERED, never bottom-anchored: bottom-anchoring put the
      // dismiss control within a pixel of the fixed nav's hit area — the
      // same bottom-crowded failure cancel-bottomnav and vibe-tweak-reachable
      // exist to prevent. Centring removes the collision by construction.
      className="fixed inset-0 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="signin-gate-title" className="text-xl font-semibold">
          Sign in to Next Bar
        </h2>
        <p id="signin-gate-body" className="mt-2 text-sm text-muted">
          Sign in to sync your ratings, see friends&apos; picks, and plan nights
          out together.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Link
            ref={signInRef}
            href="/auth"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-accent px-4 font-medium text-black"
          >
            Sign in
          </Link>
          <button
            ref={dismissRef}
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
