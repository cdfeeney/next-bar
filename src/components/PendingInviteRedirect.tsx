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
    // Already on the plan (the page consumes the token itself) — don't
    // double-navigate.
    if (pathname?.startsWith('/night-out/')) return;
    const token = consumePendingInvite();
    if (token !== null) {
      router.replace(`/night-out/${token}`);
    }
  }, [auth.status, pathname, router]);

  return null;
}
