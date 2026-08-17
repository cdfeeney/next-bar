'use client';

/**
 * OnboardingGate — layout-mounted redirect into the identity onboarding
 * step (TikTok-style identity: every account gets a display name +
 * @username; email is login-only).
 *
 * Fires for a signed-in user whose profile fetch CONFIRMS handle IS NULL
 * (a failed fetch means "unknown" — never redirect on unknown), at most
 * once per browser session (sessionStorage flag, set before navigating so
 * a loop is impossible). Covers both fresh signups (both login paths land
 * on /settings) and existing handle-less accounts (the gate keys off the
 * missing handle, not account age).
 *
 * Renders nothing.
 */

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { fetchOwnProfile } from '@/lib/profile.server';
import { getCacheEpoch } from '@/lib/accountCache';

/**
 * Session flag: "this browser session was already prompted". UI preference
 * only — deliberately NOT in accountCache ALL_KEYS (same argument as the
 * handle-nudge flag: it holds no account data).
 */
export const ONBOARDING_PROMPTED_KEY = 'next-bar:onboarding-prompted:v1';

/**
 * Never yank the user out of these flows into onboarding.
 *
 * `/night-out` used to be here, to protect the invite handoff: the landing page
 * spends the pending-invite token as soon as it reaches a terminal state, and
 * this gate could then replace the route with /onboarding — token already
 * spent, nothing to bring the user back.
 *
 * That excluded the symptom and left criterion 1 unmet (fix round 1, Codex
 * HIGH): it only DEFERRED onboarding to the next navigation, which then lands
 * the user on `/` and never on the plan. "Signing up and completing onboarding
 * lands on that plan" was never true.
 *
 * The gate now carries WHERE IT INTERRUPTED as `?next=`, so the return trip no
 * longer depends on the invite token surviving a race it cannot win. That works
 * for every interrupted flow, not just invites, so the special case is gone.
 */
const EXCLUDED_PREFIXES = ['/onboarding', '/auth', '/privacy', '/terms'];

/**
 * Only a same-origin ABSOLUTE PATH may be returned to. This value reaches the
 * router from the URL bar, so it is untrusted input and "starts with /" alone is
 * not enough: `//evil.example` is a protocol-relative URL that browsers resolve
 * OFF-ORIGIN, and several normalise a backslash to a slash, so `/\evil.example`
 * is the same attack with one character changed.
 */
export function isSafeReturnPath(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || !value.startsWith('/')) return false;
  return value[1] !== '/' && value[1] !== '\\';
}

/**
 * Best-effort flag write: sessionStorage.setItem can throw (Safari private
 * mode at quota, some webviews). A missing flag just means the gate probes
 * again next session/navigation — never let the throw block navigation
 * (DeepSeek review).
 */
export function setPromptedFlag(): void {
  try {
    window.sessionStorage.setItem(ONBOARDING_PROMPTED_KEY, '1');
  } catch {
    // Fine — the flag is an optimization, not state.
  }
}

function isPromptedFlagSet(): boolean {
  try {
    return window.sessionStorage.getItem(ONBOARDING_PROMPTED_KEY) === '1';
  } catch {
    return false;
  }
}

export default function OnboardingGate(): null {
  const auth = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (auth.status !== 'signed-in') return;
    if (EXCLUDED_PREFIXES.some((p) => pathname.startsWith(p))) return;
    if (isPromptedFlagSet()) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    let cancelled = false;
    // Epoch guard (accountCache convention): a sign-out mid-fetch must
    // abandon the redirect, not fire it for the next identity.
    const epoch = getCacheEpoch();
    fetchOwnProfile(supabase).then((profile) => {
      if (cancelled || getCacheEpoch() !== epoch) return;
      // null = unknown (fetch failed / no row yet) — fail open, no prompt,
      // and no flag either so a later navigation retries.
      if (profile === null) return;
      if (profile.handle !== null) {
        // Already onboarded — cache that for the session (Opus review:
        // without this, every navigation re-pays a profile fetch).
        setPromptedFlag();
        return;
      }
      setPromptedFlag();
      // Carry the interrupted destination through onboarding (criterion 1).
      // `pathname` only — a query string is not part of any flow this gate
      // interrupts, and forwarding one would widen the redirect surface for
      // nothing.
      router.replace(
        isSafeReturnPath(pathname)
          ? `/onboarding?next=${encodeURIComponent(pathname)}`
          : '/onboarding',
      );
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status, pathname, router]);

  return null;
}
