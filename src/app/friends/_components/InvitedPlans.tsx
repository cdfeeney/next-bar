'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  fetchNightOutInvitationNotifications,
  markInvitationNotificationRead,
  type NightOutInvitationNotification,
} from '@/lib/groups.server';

/**
 * Plans → the night-out INVITATION NOTIFICATIONS (V8-R-GRP-008's inclusion
 * half). Moved here from Groups & people by the Social redesign (2026-09-13,
 * README §2.3): "invitations you've been sent land here too". The RPCs, the
 * unread-only filter and the confirm-before-remove rule are exactly what
 * GroupsAndPeople carried; only the home and the styling changed.
 *
 * A FAILED read is its own state: an empty list would say "nobody invited you"
 * to someone whose invitations could not be loaded. UNREAD ONLY: the RPC also
 * returns read rows (durable record), so filtering is the caller's job — without
 * it, dismissing wrote read_at, the row left optimistically, and the next load
 * put it straight back.
 */
export default function InvitedPlans(): JSX.Element | null {
  const auth = useAuth();
  const client = useMemo(() => getBrowserSupabase(), []);
  const isSignedIn = auth.status === 'signed-in';
  const [invites, setInvites] = useState<NightOutInvitationNotification[]>([]);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!isSignedIn || client === null) return;
    const notifications = await fetchNightOutInvitationNotifications(client);
    setInvites(notifications.ok ? notifications.value.filter((n) => n.readAt === null) : []);
    setFailed(!notifications.ok);
  }, [client, isSignedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Seeing the invitation IS the in-app notification, so dismissing it is what
   * writes `read_at`. The row leaves the list only after the server confirms —
   * a notification that vanishes on a failed write is a notification never
   * delivered.
   */
  const onDismiss = async (id: number): Promise<void> => {
    if (client === null) return;
    const result = await markInvitationNotificationRead(client, id);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setInvites((current) => current.filter((invite) => invite.id !== id));
  };

  if (!isSignedIn) return null;
  if (!failed && invites.length === 0 && notice === null) return null;

  return (
    <div className="space-y-2" data-testid="invited-notifications">
      {notice !== null ? (
        <p role="status" className="text-sm rounded-2xl border border-border bg-surface px-4 py-3">
          {notice}
        </p>
      ) : null}
      {failed ? (
        <p data-testid="group-invites-failed" role="status" className="text-sm text-muted">
          Your night out invitations could not be loaded.
        </p>
      ) : null}
      {invites.length > 0 ? (
        <ul data-testid="group-invite-notifications" className="space-y-2">
          {invites.map((invite) => (
            <li
              key={invite.id}
              data-testid="group-invite-notification"
              className="flex items-center justify-between gap-3 rounded-3xl border border-accent bg-surface px-4 py-3"
            >
              <span className="min-w-0 text-sm">
                You are invited to {invite.title ?? 'a night out'} on {invite.night}
                {invite.groupName !== null ? ` via ${invite.groupName}` : ''}.
              </span>
              <button
                type="button"
                onClick={() => void onDismiss(invite.id)}
                data-testid="group-invite-seen"
                className="shrink-0 min-h-[44px] px-3 rounded-full border border-border text-sm font-display touch-manipulation"
              >
                Got it
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
