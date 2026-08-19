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

import { useEffect, useLayoutEffect, useRef } from 'react';
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

// (No sentinel origin. See isSafeReturnPath — introducing one was a defect.)

/**
 * Only a same-origin ABSOLUTE PATH may be returned to. This value reaches the
 * router from the URL bar, so it is untrusted input.
 *
 * Round 2 (Claude, HIGH) broke the first version of this, which rejected
 * `//evil` and `/\evil` by inspecting `value[1]`. Character checks lose to the
 * URL parser: `?next=/%09/evil.example` decodes to `/\t/evil.example`, whose
 * second character is a tab, so it passed — and the WHATWG parser STRIPS ASCII
 * tab, LF and CR before parsing, turning it back into `//evil.example` and
 * navigating off-origin. `%0A` and `%0D` did the same.
 *
 * So do not guess which characters the parser ignores. Resolve the value with
 * the same parser the browser will use and require the origin to survive. A
 * hostile value has to reach a different origin to be worth anything, and this
 * asks exactly that question.
 *
 * Round 3 (Codex) then broke the FIRST version of that idea, which resolved
 * against a fixed sentinel origin so the check would behave identically on the
 * server and in jsdom. That made the sentinel itself a passable target:
 * `?next=//return-path-check.invalid/evil` starts with `/`, resolves to the
 * sentinel's own origin, compared equal, and navigated off-origin for real.
 * Convenience in the check became a hole in it.
 *
 * The comparison is against `window.location.origin` — the origin that actually
 * matters. A protocol-relative URL naming the REAL host is genuinely same-origin
 * and harmless; naming anything else is caught. There is no third host left for
 * an attacker to aim at.
 */
export function isSafeReturnPath(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || !value.startsWith('/')) return false;
  // No window means no origin to be same as. Fail closed rather than guess.
  if (typeof window === 'undefined') return false;
  const origin = window.location.origin;
  try {
    return new URL(value, origin).origin === origin;
  } catch {
    return false;
  }
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
  /**
   * The route on screen RIGHT NOW, readable from inside a settled fetch.
   *
   * Round-8 panel (Codex): the effect's `cancelled` flag is cleared by a passive
   * cleanup, which runs in a task after the new route commits. A profile fetch
   * started on route A and settling in that window saw `cancelled === false` and
   * an unchanged cache epoch — the identity did not change, only the route — so
   * it redirected the freshly committed route B to onboarding carrying
   * `next=A`, sending the user somewhere they had already left.
   *
   * A layout effect commits this synchronously, so no settling task can observe
   * it stale. Same mechanism as the plan page's view epoch and this file's
   * sibling components.
   */
  const livePathname = useRef(pathname);
  useLayoutEffect(() => {
    livePathname.current = pathname;
  });

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
      // ...and the ROUTE is the other half of this effect's identity.
      if (livePathname.current !== pathname) return;
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
      //
      // `pathname` plus ONE named marker. Dropping the query entirely was the
      // original rule — "a query string is not part of any flow this gate
      // interrupts, and forwarding one would widen the redirect surface for
      // nothing" — and that stopped being true when password recovery started
      // carrying `?from=recovery` (round-7 panel, Codex). A handle-less account
      // recovering its password was sent to /onboarding?next=/settings, came
      // back to an UNMARKED /settings, and PendingInviteRedirect then pulled it
      // to the plan before the password could be set.
      //
      // Only that one literal marker is forwarded, reconstructed rather than
      // passed through, so the original concern still holds: nothing
      // attacker-shaped rides back on the return path.
      const isRecovery =
        typeof window !== 'undefined'
        && new URLSearchParams(window.location.search).get('from') === 'recovery';
      const returnTo = isRecovery ? `${pathname}?from=recovery` : pathname;
      router.replace(
        isSafeReturnPath(pathname)
          ? `/onboarding?next=${encodeURIComponent(returnTo)}`
          : '/onboarding',
      );
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status, pathname, router]);

  return null;
}
