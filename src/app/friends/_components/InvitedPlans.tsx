'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
export default function InvitedPlans({
  cardedNightOutIds,
  answeredNightOutIds,
  showHeading = false,
}: {
  /**
   * Plans whose membership row already renders as a PlanInvites card. A group
   * invitation writes BOTH a pending member row and a notification (0067
   * `invite_one_to_night_out`), so without this the same invitation showed
   * twice under one heading (S-03 panel, HIGH). The card is the richer
   * surface; its notification row is hidden while the card is on the page.
   */
  cardedNightOutIds?: ReadonlySet<string>;
  /**
   * Plans the viewer has ANSWERED (I'm in / Not tonight). `respond_night_out`
   * only changes night_out_members, so the notification is marked read here —
   * after the server confirms, never optimistically.
   */
  answeredNightOutIds?: ReadonlySet<string>;
  /**
   * PlanInvites owns the "Invited" heading while it has a card on the page;
   * when it has none, these rows are the whole INVITED section and carry the
   * heading themselves (R-02) — never an unlabelled list.
   */
  showHeading?: boolean;
} = {}): JSX.Element | null {
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
  // Ids with a mark-read write IN FLIGHT. The auto-mark effect below re-runs
  // whenever the list changes, which is exactly when a sibling write has just
  // been confirmed — without this, every still-pending id is written again.
  const marking = useRef(new Set<number>());
  const markRead = useCallback(
    async (id: number): Promise<boolean> => {
      if (client === null || marking.current.has(id)) return false;
      marking.current.add(id);
      const result = await markInvitationNotificationRead(client, id);
      marking.current.delete(id);
      if (!result.ok) {
        setNotice(result.message);
        return false;
      }
      setNotice(null);
      setInvites((current) => current.filter((invite) => invite.id !== id));
      return true;
    },
    [client],
  );

  // An answered card settles its notification: mark read, then drop the row.
  // Runs when the ANSWERED set changes AND when the notifications load (R-02:
  // a plan answered before this list arrived was never settled), and again on
  // any later list change, which is what retries a mark that failed.
  // A confirmed mark removes its row, so a successful pass never re-runs; a
  // failed one leaves the row, and `invites` does not change on failure.
  const answeredKey = answeredNightOutIds ? Array.from(answeredNightOutIds).sort().join(',') : '';
  useEffect(() => {
    if (!answeredNightOutIds || answeredNightOutIds.size === 0) return;
    for (const invite of invites) {
      if (answeredNightOutIds.has(invite.nightOutId)) void markRead(invite.id);
    }
    // `answeredKey` stands in for the set so a same-content Set does not re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answeredKey, invites, markRead]);

  const visible = invites.filter(
    (invite) => !(cardedNightOutIds?.has(invite.nightOutId) ?? false),
  );

  if (!isSignedIn) return null;
  if (!failed && visible.length === 0 && notice === null) return null;

  return (
    <div className="space-y-2" data-testid="invited-notifications">
      {showHeading && visible.length > 0 ? (
        <h2 className="font-label text-xs font-bold uppercase tracking-[0.25em] text-muted mt-[30px] mb-3">
          Invited
        </h2>
      ) : null}
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
      {visible.length > 0 ? (
        <ul data-testid="group-invite-notifications" className="space-y-3">
          {/* README §2.3 card shape: 24px radius, surface, name over a muted
              meta line, then one 44px action. */}
          {visible.map((invite) => (
            <li
              key={invite.id}
              data-testid="group-invite-notification"
              className="rounded-3xl border border-border bg-surface p-4"
            >
              <p className="text-[15px] font-semibold truncate">
                You are invited to {invite.title ?? 'a night out'}
              </p>
              <p className="text-xs text-muted truncate mt-px">
                {invite.night}
                {invite.groupName !== null ? ` · via ${invite.groupName}` : ''}
              </p>
              <button
                type="button"
                onClick={() => void markRead(invite.id)}
                data-testid="group-invite-seen"
                className="mt-3.5 w-full min-h-[44px] rounded-full border border-border text-sm font-display touch-manipulation"
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
