'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { peekPendingInvite } from '@/lib/pendingInvite';

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
    // Already on the plan — the page consumes the token itself.
    if (pathname?.startsWith('/night-out/')) return;
    // PEEK, never consume, before navigating (review round 1, Codex): a
    // fresh account's onboarding gate can hijack the navigation after a
    // consume, losing the context for good. Leaving the key in place makes
    // the redirect self-healing — it simply fires again after whatever
    // interrupted it, and the destination page performs the single consume.
    router.replace(`/night-out/${pending}`);
  }, [auth.status, pathname, router]);

  return null;
}
