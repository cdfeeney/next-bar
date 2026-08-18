'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { consumePendingInvite, peekPendingInvite } from '@/lib/pendingInvite';

/**
 * Completes the invite-context handoff (V8-3 criterion 7): a share link
 * opened signed-out stored its token before sending the user to /auth; the
 * fixed post-auth redirect can land anywhere, so this component — mounted
 * once in the root layout — routes the first signed-in render back to that
 * exact plan. Renders nothing.
 */
export default function PendingInviteRedirect(): null {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (auth.status !== 'signed-in') return;
    const pending = peekPendingInvite();
    if (pending === null) return;
    // Already on THE PENDING plan — that page consumes the token itself.
    if (pathname?.startsWith(`/night-out/${pending}`)) return;
    // On a DIFFERENT plan: do not redirect, and spend the token (round-6 panel,
    // Codex). Matching only the exact token was deliberate — an earlier version
    // returned on any /night-out/* and left a stale token to fire a surprise
    // redirect later — but leaving it live is what produced the newer defect:
    // start signup from invite A, open invite B in another tab, and A's own
    // confirmation callback lands the new account on A only for this component
    // to replace it with B. The user is looking at a plan; whatever else was
    // pending has been superseded by that, so it is spent here rather than left
    // to fire.
    if (pathname?.startsWith('/night-out/')) {
      consumePendingInvite();
      return;
    }
    // Password RECOVERY passes through /settings on purpose (round-6 panel,
    // Codex): that page holds "Set a password", which is the entire point of a
    // recovery link. Without this the handoff fired the moment recovery signed
    // the user in and replaced /settings with the plan, so the password could
    // never be set. The marker rides one navigation and is not consumed, so the
    // invite still completes once the user leaves /settings themselves.
    if (typeof window !== 'undefined'
        && new URLSearchParams(window.location.search).get('from') === 'recovery') {
      return;
    }
    // Onboarding is the ONE interruption this must not undo (fix round 1). The
    // token deliberately survives until the plan page settles, so from
    // /onboarding this component would otherwise see a live pending invite and
    // replace the route — pulling a brand-new account out of the identity form
    // it was just sent to, and setting the prompted flag means nothing sends it
    // back. OnboardingGate already carries the plan as its `?next=`, so the trip
    // is not lost by waiting: it completes on the other side.
    if (pathname?.startsWith('/onboarding')) return;
    // PEEK, never consume, before navigating (review round 1, Codex): a
    // fresh account's onboarding gate can hijack the navigation after a
    // consume, losing the context for good. Leaving the key in place makes
    // the redirect self-healing — it simply fires again after whatever
    // interrupted it, and the destination page performs the single consume.
    router.replace(`/night-out/${pending}`);
  }, [auth.status, pathname, router]);

  return null;
}
