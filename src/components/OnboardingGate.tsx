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

/** Never yank the user out of these flows into onboarding. */
const EXCLUDED_PREFIXES = ['/onboarding', '/auth', '/privacy', '/terms'];

export default function OnboardingGate(): null {
  const auth = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (auth.status !== 'signed-in') return;
    if (EXCLUDED_PREFIXES.some((p) => pathname.startsWith(p))) return;
    if (window.sessionStorage.getItem(ONBOARDING_PROMPTED_KEY) === '1') return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    let cancelled = false;
    // Epoch guard (accountCache convention): a sign-out mid-fetch must
    // abandon the redirect, not fire it for the next identity.
    const epoch = getCacheEpoch();
    fetchOwnProfile(supabase).then((profile) => {
      if (cancelled || getCacheEpoch() !== epoch) return;
      // null = unknown (fetch failed / no row yet) — fail open, no prompt.
      if (profile === null || profile.handle !== null) return;
      window.sessionStorage.setItem(ONBOARDING_PROMPTED_KEY, '1');
      router.replace('/onboarding');
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status, pathname, router]);

  return null;
}
