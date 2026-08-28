'use client';

/**
 * One group's persistent thread, and its administration (V8-R-GRP-001 … 008).
 *
 * WHAT THIS COMPONENT DOES NOT DECIDE. Every rule that matters is the server's:
 * membership, the single administrator, who may delete a message, who may be
 * added, the reporter's hide and the block. This file renders what the database
 * returned and shows the failure it returned; it never re-derives an
 * authorization. The administrative controls render only for an administrator —
 * that is V8-R-GRP-005's accessibility clause — but rendering them for the
 * wrong person would be a cosmetic bug, not a security one, because
 * `rename_group` and friends refuse the caller anyway.
 *
 * NO PUSH IS SENT FROM HERE, and none from `groups.server.ts` or 0067.
 * V8-R-GRP-008: "V8 DOES NOT SEND A PUSH NOTIFICATION FOR EVERY ORDINARY GROUP
 * MESSAGE." Opening the thread marks it read; unread state is carried in-app.
 *
 * FAILURES ARE STATED IN WORDS. Each requirement in this lane says so
 * separately — a failed send is "stated and retryable", a failed administrative
 * write "must not report success", a failed leave likewise. So every action
 * resolves into one `notice` line rather than a silent no-op, and nothing is
 * applied optimistically: the thread re-reads from the server after a write.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  addGroupMember,
  deleteGroupMessage,
  fetchGroupMembers,
  fetchGroupMessages,
  fetchInvitableNightOuts,
  inviteGroupToNightOut,
  inviteNightOutMember,
  leaveGroup,
  markGroupRead,
  removeGroupMember,
  renameGroup,
  sendGroupMessage,
  GROUP_THREAD_PAGE,
  MAX_GROUP_MESSAGE_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  type GroupInviteOutcome,
  type GroupMember,
  type InvitableNightOut,
  type GroupMessage,
} from '@/lib/groups.server';
import { reportContent } from '@/lib/moderation/reports';

/** A mutual friend offered to the administrator's add control. */
export type AddableFriend = {
  id: string;
  handle: string;
  displayName: string | null;
};

type Props = {
  client: SupabaseClient | null;
  accessToken: string | null;
  groupId: string;
  groupName: string;
  viewerId: string;
  /** Mutual friends, for the administrator's add control (V8-R-GRP-005). */
  addable: readonly AddableFriend[];
  /** Unread count for this group, from group_unread_counts. See the watermark note. */
  unreadCount?: number;
  onClose: () => void;
  /** The group list re-reads: a rename, a leave or a deletion changed it. */
  onChanged: () => void;
};

type Status = 'loading' | 'ready' | 'failed';

export default function GroupThread({
  client,
  accessToken,
  groupId,
  groupName,
  viewerId,
  addable,
  unreadCount = 0,
  onClose,
  onChanged,
}: Props): JSX.Element {
  const [status, setStatus] = useState<Status>('loading');
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  // TWO NAMES, DELIBERATELY, and the round-1 finding is what separated them.
  //
  // `name` is the CANONICAL group name — what the server last confirmed, and the only thing the
  // heading may render. `nameDraft` is what the administrator is typing. They used to be one
  // state, so typing renamed the group on screen before the server agreed, and a REJECTED
  // `rename_group` left the uncommitted name in the heading: a failed administrative write that
  // looked applied. The draft is promoted into `name` only after the RPC confirms.
  const [name, setName] = useState(groupName);
  const [nameDraft, setNameDraft] = useState(groupName);
  // The per-person outcomes of the LAST whole-group invite, kept so each failure can carry its
  // own Resend (V8-R-GRP-003). Null means no invite has been attempted in this session.
  const [inviteOutcomes, setInviteOutcomes] = useState<GroupInviteOutcome[] | null>(null);
  // The plan those outcomes belong to — a Resend has to name the same plan the invite used.
  const [invitePlanId, setInvitePlanId] = useState('');
  // The plans this viewer may invite to (V8-R-GRP-003's picker).
  //
  // ITS OWN STATE, NOT PART OF `load()`. The thread is the primary content and a plans read that
  // fails must not blank a conversation that loaded fine — so this never touches `status`.
  // `null` is "not loaded yet", `[]` is "genuinely none", and `plansFailed` is the third case the
  // other two must not be allowed to impersonate.
  const [plans, setPlans] = useState<InvitableNightOut[] | null>(null);
  const [plansFailed, setPlansFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const viewerIsAdmin = useMemo(
    () => members.some((m) => m.profileId === viewerId && m.isAdmin),
    [members, viewerId],
  );

  const load = useCallback(async (): Promise<void> => {
    const [thread, roster] = await Promise.all([
      fetchGroupMessages(client, groupId),
      fetchGroupMembers(client, groupId),
    ]);

    // A FAILED LOAD IS ITS OWN STATE. Falling back to an empty thread would
    // render "no messages yet" for a conversation that exists and could not be
    // reached — the collapse Social's feed refuses by name.
    if (!thread.ok) {
      setStatus('failed');
      setNotice(thread.message);
      return;
    }
    if (!roster.ok) {
      setStatus('failed');
      setNotice(roster.message);
      return;
    }

    setMessages(thread.value);
    setMembers(roster.value);
    setStatus('ready');
  }, [client, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load the invitable plans once per viewer/client. Separate from `load()` on purpose: see the
  // state declaration above. A failure here degrades the invite control alone.
  useEffect(() => {
    let live = true;
    void fetchInvitableNightOuts(client).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setPlansFailed(true);
        return;
      }
      setPlansFailed(false);
      setPlans(result.value);
    });
    return () => {
      live = false;
    };
  }, [client]);

  // V8-R-GRP-008. Opening the thread IS reading it — but only once it has actually BEEN read.
  //
  // Round-1 finding: this fired from its own mount effect, independent of the load. When
  // `get_group_thread` failed while `mark_group_read` succeeded, the viewer saw "the conversation
  // could not be loaded" while every prior message was marked read and the unread badge cleared.
  // Read state advanced past messages that were never shown, and nothing could bring it back.
  // Gated on `ready` so the claim "you have seen these" is only ever made once they are on screen.
  //
  // The ref keeps it to one call per group: `status` flips loading -> ready, and without it a
  // re-render or a re-read from `run()` would mark read again on every pass.
  //
  // A FAILURE here is still deliberately silent: an unread badge that stays up is a cosmetic
  // inaccuracy, and an error line above someone's conversation would be worse than the bug.
  const readMarkedFor = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'ready') return;
    if (readMarkedFor.current === groupId) return;
    readMarkedFor.current = groupId;
    // Read up to the NEWEST MESSAGE ACTUALLY LOADED, not the clock — see markGroupRead. A message
    // that arrives between the fetch and this call was never on screen and must stay unread.
    //
    // ROUND 5, and the third attempt at this boundary. The first two each fixed one half and broke
    // the other, so both halves are now pinned as a PAIR in GroupThread.test.tsx.
    //
    // ROUND 3 marked through the newest RETURNED row. get_group_thread caps at GROUP_THREAD_PAGE,
    // so on a longer thread that also marked every OLDER message read — including ones beyond the
    // page the viewer never saw — because unread is "newer than last_read_at".
    //
    // ROUND 4 refused to mark at all on a full page. Safe in direction, but any group that ever
    // reached GROUP_THREAD_PAGE messages then froze last_read_at FOREVER: the badge never cleared
    // again and grew without bound on exactly the active groups unread state exists for, which
    // degrades the whole in-app half of V8-R-GRP-008.
    //
    // WHAT ACTUALLY DECIDES IT: unread messages are a NEWEST-SUFFIX of the thread, and the page is
    // the newest GROUP_THREAD_PAGE rows. So if the unread COUNT fits inside the page, every unread
    // message was rendered and the watermark may advance — however long the thread is. Only when
    // unread meets or exceeds the page can unread messages exist above what was shown, and only
    // then is marking unsafe. Page length ALONE can never tell those apart, which is why rounds 3
    // and 4 both got it wrong with only the page in hand.
    const wholeThreadShown = messages.length < GROUP_THREAD_PAGE;
    const unreadFitsInPage = unreadCount < GROUP_THREAD_PAGE;
    if (!wholeThreadShown && !unreadFitsInPage) return;
    const watermark = messages.length > 0 ? messages[messages.length - 1].createdAt : null;
    void markGroupRead(client, groupId, watermark).then((result) => {
      if (result.ok) onChanged();
    });
  }, [client, groupId, onChanged, status, messages]);

  /** Run one write, state its outcome, and re-read rather than guess. */
  const run = useCallback(
    async (
      action: () => Promise<{ ok: boolean; message?: string }>,
      success: string | null,
    ): Promise<boolean> => {
      setBusy(true);
      setNotice(null);
      try {
        const result = await action();
        if (!result.ok) {
          setNotice(result.message ?? 'That did not work. Try again.');
          return false;
        }
        if (success !== null) setNotice(success);
        await load();
        onChanged();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [load, onChanged],
  );

  const onSend = async (): Promise<void> => {
    const text = draft.trim();
    if (text.length === 0) return;
    // The draft is cleared ONLY on a confirmed send. Clearing first loses what
    // someone typed the moment the network does, and "never silently drops" is
    // the requirement's own wording.
    const sent = await run(
      () => sendGroupMessage(client, groupId, text),
      null,
    );
    if (sent) setDraft('');
  };

  /**
   * Send a photo (V8-R-GRP-002).
   *
   * TWO STEPS, AND BOTH ARE THE BOUNDARY. The bytes go to
   * `POST /api/media/upload`, which is the ONLY way anything reaches the media
   * bucket: it decodes and re-encodes them server-side, so EXIF and GPS have no
   * carrier in what is stored (V8-R-STO-014). What comes back is a media
   * REGISTRY ID, and that id — never a storage path — is what
   * `send_group_message` attaches. A path would be a string this component could
   * invent, which is exactly what the requirement refuses to treat as a trust
   * boundary.
   */
  const onPickPhoto = async (file: File): Promise<void> => {
    if (accessToken === null) {
      setNotice('Sign in to send a photo.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/media/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; mediaId?: string }
        | null;

      if (!response.ok || payload?.ok !== true || typeof payload.mediaId !== 'string') {
        setNotice(
          response.status === 413
            ? 'That photo is too large.'
            : 'That photo could not be sent. Try again.',
        );
        return;
      }

      const sent = await sendGroupMessage(client, groupId, null, payload.mediaId);
      if (!sent.ok) {
        setNotice(sent.message);
        return;
      }
      await load();
      onChanged();
    } catch {
      setNotice('That photo could not be sent. Try again.');
    } finally {
      setBusy(false);
      // Cleared so picking the SAME file again still fires a change event.
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section
      data-testid="group-thread"
      aria-labelledby="group-thread-heading"
      className="space-y-4"
    >
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="group-thread-heading"
            data-testid="group-thread-name"
            className="font-display text-base truncate"
          >
            {name}
          </h3>
          {/* V8-R-GRP-001: "the group name and member count are stated on the
              thread." */}
          <p data-testid="group-member-count" className="text-xs text-muted mt-1">
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          data-testid="group-thread-close"
          className="shrink-0 min-h-[44px] px-4 rounded-full border border-border bg-surface text-sm font-display touch-manipulation"
        >
          Back
        </button>
      </header>

      {notice !== null ? (
        <p
          data-testid="group-notice"
          role="status"
          className="text-sm rounded-2xl border border-border bg-surface px-4 py-3"
        >
          {notice}
        </p>
      ) : null}

      {status === 'loading' ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : null}

      {status === 'failed' ? (
        <div className="rounded-2xl border border-border bg-surface p-4 space-y-3">
          <p className="text-sm">That conversation could not be loaded.</p>
          <button
            type="button"
            onClick={() => void load()}
            data-testid="group-thread-retry"
            className="min-h-[44px] px-4 rounded-full bg-accent text-bg text-sm font-display touch-manipulation"
          >
            Try again
          </button>
        </div>
      ) : null}

      {status === 'ready' ? (
        <>
          <ol data-testid="group-messages" className="space-y-3">
            {messages.length === 0 ? (
              <li className="text-sm text-muted">
                No messages yet. Say something.
              </li>
            ) : (
              messages.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  accessToken={accessToken}
                  canDelete={message.senderId === viewerId || viewerIsAdmin}
                  busy={busy}
                  onDelete={() =>
                    void run(
                      () => deleteGroupMessage(client, message.id),
                      'That message was deleted.',
                    )
                  }
                  onReport={() =>
                    void run(
                      async () => {
                        const result = await reportContent(
                          client,
                          'group_message',
                          message.id,
                        );
                        return result.ok
                          ? { ok: true }
                          : { ok: false, message: result.message };
                      },
                      'Reported. You will not see that message again.',
                    )
                  }
                />
              ))
            )}
          </ol>

          <Composer
            draft={draft}
            busy={busy}
            fileRef={fileRef}
            onDraft={setDraft}
            onSend={() => void onSend()}
            onPickPhoto={(file) => void onPickPhoto(file)}
          />

          {viewerIsAdmin ? (
            <Administration
              name={nameDraft}
              members={members}
              viewerId={viewerId}
              addable={addable}
              busy={busy}
              onName={setNameDraft}
              onRename={(next) =>
                void run(
                  () => renameGroup(client, groupId, next),
                  'Group renamed.',
                ).then((ok) => {
                  // ONLY a confirmed rename moves the heading. On failure the draft keeps what
                  // was typed (so it can be corrected and retried) and `name` is untouched.
                  if (ok) setName(next);
                })
              }
              onAdd={(profileId) =>
                void run(
                  () => addGroupMember(client, groupId, profileId),
                  'They were added to the group.',
                )
              }
              onRemove={(profileId) =>
                void run(
                  () => removeGroupMember(client, groupId, profileId),
                  'They were removed from the group.',
                )
              }
            />
          ) : null}

          <NightOutInvite
            busy={busy}
            memberCount={members.length}
            members={members}
            plans={plans}
            plansFailed={plansFailed}
            outcomes={inviteOutcomes}
            onInvite={(nightOutId) => {
              setInvitePlanId(nightOutId);
              void run(async () => {
                const result = await inviteGroupToNightOut(
                  client,
                  nightOutId,
                  groupId,
                );
                if (!result.ok) {
                  setInviteOutcomes(null);
                  return { ok: false, message: result.message };
                }
                // THE PER-PERSON RESULT IS KEPT, not counted and thrown away.
                //
                // Round-1 finding: the returned profile ids were discarded and a mixed result
                // became "N of M invites did not go through", whose only offered recovery was
                // inviting the WHOLE GROUP again. V8-R-GRP-003 is explicit — "a failed invite
                // shows a per-person Resend invite; other successful invites are unaffected" —
                // and re-inviting everyone is exactly what "unaffected" forbids.
                setInviteOutcomes(result.value);
                const failed = result.value.filter((row) => !row.invited);
                // PARTIAL SUCCESS IS REPORTED AS PARTIAL. Rounding a mixed
                // result up to "invited" is what the requirement's per-person
                // Resend clause exists to prevent.
                return failed.length === 0
                  ? { ok: true }
                  : {
                      ok: false,
                      message: `${failed.length} of ${result.value.length} invites did not go through. Resend the ones below.`,
                    };
              }, 'The group was invited.');
            }}
            onResend={(profileId) =>
              void run(async () => {
                const result = await inviteNightOutMember(
                  client,
                  invitePlanId,
                  profileId,
                  groupId,
                );
                if (!result.ok) return { ok: false, message: result.message };
                // ONE person's outcome replaces ONE row. Everyone else's stands, which is the
                // "other successful invites are unaffected" half of the requirement.
                setInviteOutcomes((prev) =>
                  (prev ?? []).map((row) =>
                    row.profileId === profileId
                      ? { ...row, invited: result.value }
                      : row,
                  ),
                );
                return result.value
                  ? { ok: true }
                  : { ok: false, message: 'That invite still did not go through.' };
              }, 'Invite resent.')
            }
          />

          <LeaveGroup
            busy={busy}
            viewerIsAdmin={viewerIsAdmin}
            memberCount={members.length}
            onLeave={() =>
              void run(async () => {
                const result = await leaveGroup(client, groupId);
                if (result.ok) onClose();
                return result.ok
                  ? { ok: true }
                  : { ok: false, message: result.message };
              }, null)
            }
          />
        </>
      ) : null}
    </section>
  );
}

/**
 * One message.
 *
 * The photo is fetched through `/api/media/:mediaId/url`, which decides the
 * signed lifetime SERVER-SIDE (V8-R-STO-015). This component never calls
 * `createSignedUrl` and never names a storage path — it only ever holds a
 * registry id.
 */
function MessageRow({
  message,
  accessToken,
  canDelete,
  busy,
  onDelete,
  onReport,
}: {
  message: GroupMessage;
  accessToken: string | null;
  canDelete: boolean;
  busy: boolean;
  onDelete: () => void;
  onReport: () => void;
}): JSX.Element {
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    if (message.mediaId === null || accessToken === null) return;
    let live = true;

    void fetch(`/api/media/${message.mediaId}/url`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { ok?: boolean; url?: string } | null) => {
        if (!live) return;
        if (payload?.ok === true && typeof payload.url === 'string') {
          setPhoto(payload.url);
        } else {
          setPhotoFailed(true);
        }
      })
      .catch(() => {
        if (live) setPhotoFailed(true);
      });

    return () => {
      live = false;
    };
  }, [message.mediaId, accessToken]);

  // X5. A null sender is not an anonymous sender — it is a DEPARTED one, and the difference is
  // worth naming. The message survives account deletion (V8-R-GRP-007 does not list that as a
  // removal cause), so the thread stays whole and says plainly who is no longer there. 'Someone'
  // still covers the different case of a present account with neither display name nor handle.
  const who = message.senderId === null
    ? 'A departed member'
    : message.senderDisplayName
      ?? (message.senderHandle !== null ? `@${message.senderHandle}` : 'Someone');

  return (
    <li
      data-testid="group-message"
      className="rounded-2xl border border-border bg-surface p-3 space-y-2"
    >
      <p className="text-xs text-muted">{who}</p>

      {message.body !== null ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
          {message.body}
        </p>
      ) : null}

      {message.mediaId !== null ? (
        photo !== null ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={`Photo from ${who}`}
            data-testid="group-message-photo"
            className="w-full rounded-xl"
          />
        ) : (
          // AN HONEST MISSING STATE, never a decorative placeholder — the same
          // rule the media boundary states for a failed signing.
          <p data-testid="group-message-photo-missing" className="text-xs text-muted">
            {photoFailed ? 'That photo is no longer available.' : 'Loading photo…'}
          </p>
        )
      ) : null}

      <div className="flex items-center gap-2">
        {canDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            data-testid="group-message-delete"
            className="min-h-[44px] px-3 rounded-full border border-border text-xs font-display uppercase tracking-widest touch-manipulation disabled:opacity-50"
          >
            Delete
          </button>
        ) : null}
        <button
          type="button"
          onClick={onReport}
          disabled={busy}
          data-testid="group-message-report"
          className="min-h-[44px] px-3 rounded-full border border-border text-xs font-display uppercase tracking-widest touch-manipulation disabled:opacity-50"
        >
          Report
        </button>
      </div>
    </li>
  );
}

function Composer({
  draft,
  busy,
  fileRef,
  onDraft,
  onSend,
  onPickPhoto,
}: {
  draft: string;
  busy: boolean;
  fileRef: React.RefObject<HTMLInputElement>;
  onDraft: (value: string) => void;
  onSend: () => void;
  onPickPhoto: (file: File) => void;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <label htmlFor="group-composer" className="sr-only">
        Write a message
      </label>
      <textarea
        id="group-composer"
        data-testid="group-composer"
        value={draft}
        maxLength={MAX_GROUP_MESSAGE_LENGTH}
        onChange={(event) => onDraft(event.target.value)}
        placeholder="Write a message…"
        rows={2}
        className="w-full bg-surface border border-border rounded-2xl px-4 py-3 text-base text-text placeholder:text-muted focus:outline-none focus:border-accent"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSend}
          disabled={busy || draft.trim().length === 0}
          data-testid="group-send"
          className="min-h-[44px] px-4 rounded-full bg-accent text-bg text-sm font-display touch-manipulation disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send'}
        </button>

        <label
          data-testid="group-photo-label"
          className="min-h-[44px] px-4 rounded-full border border-border bg-surface text-sm font-display flex items-center touch-manipulation cursor-pointer"
        >
          Photo
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            data-testid="group-photo"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onPickPhoto(file);
            }}
          />
        </label>
      </div>
    </div>
  );
}

/** Administrative controls — rendered only for the single administrator. */
function Administration({
  name,
  members,
  viewerId,
  addable,
  busy,
  onName,
  onRename,
  onAdd,
  onRemove,
}: {
  name: string;
  members: readonly GroupMember[];
  viewerId: string;
  addable: readonly AddableFriend[];
  busy: boolean;
  onName: (value: string) => void;
  onRename: (name: string) => void;
  onAdd: (profileId: string) => void;
  onRemove: (profileId: string) => void;
}): JSX.Element {
  const memberIds = useMemo(
    () => new Set(members.map((m) => m.profileId)),
    [members],
  );
  const candidates = useMemo(
    () => addable.filter((friend) => !memberIds.has(friend.id)),
    [addable, memberIds],
  );

  return (
    <div
      data-testid="group-admin"
      className="rounded-2xl border border-border bg-surface p-4 space-y-4"
    >
      <h4 className="font-display text-xs uppercase tracking-[0.25em] text-muted">
        Administration
      </h4>

      <div className="space-y-2">
        <label htmlFor="group-rename" className="sr-only">
          Group name
        </label>
        <input
          id="group-rename"
          data-testid="group-rename-input"
          value={name}
          maxLength={MAX_GROUP_NAME_LENGTH}
          onChange={(event) => onName(event.target.value)}
          className="w-full bg-bg border border-border rounded-2xl px-4 py-3 text-base min-h-[44px]"
        />
        <button
          type="button"
          onClick={() => onRename(name)}
          disabled={busy || name.trim().length === 0}
          data-testid="group-rename"
          className="min-h-[44px] px-4 rounded-full bg-accent text-bg text-sm font-display touch-manipulation disabled:opacity-50"
        >
          Rename
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted">Members</p>
        {members.map((member) => (
          <div
            key={member.profileId}
            className="flex items-center justify-between gap-3 min-h-[44px]"
          >
            <span className="min-w-0 text-sm truncate">
              {member.displayName ?? (member.handle !== null ? `@${member.handle}` : 'Someone')}
              {member.isAdmin ? (
                <span className="text-muted text-xs"> · admin</span>
              ) : null}
            </span>
            {/* Leaving is its own action with its own consequence, so the
                administrator does not get a Remove on themselves — 0067 refuses
                it too. */}
            {member.profileId !== viewerId ? (
              <button
                type="button"
                onClick={() => onRemove(member.profileId)}
                disabled={busy}
                data-testid="group-remove-member"
                className="shrink-0 min-h-[44px] px-3 rounded-full border border-border text-xs font-display uppercase tracking-widest touch-manipulation disabled:opacity-50"
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted">
          {/* V8-R-GRP-005: "Only mutual friends may be added." The list offered
              here is already mutuals-only; the server refuses anyone else. */}
          Add a mutual friend
        </p>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted">
            Everyone who follows you back is already here.
          </p>
        ) : (
          candidates.map((friend) => (
            <div
              key={friend.id}
              className="flex items-center justify-between gap-3 min-h-[44px]"
            >
              <span className="min-w-0 text-sm truncate">
                {friend.displayName ?? `@${friend.handle}`}
              </span>
              <button
                type="button"
                onClick={() => onAdd(friend.id)}
                disabled={busy}
                data-testid="group-add-member"
                className="shrink-0 min-h-[44px] px-3 rounded-full bg-accent text-bg text-xs font-display uppercase tracking-widest touch-manipulation disabled:opacity-50"
              >
                Add
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * V8-R-GRP-003 — reuse the CURRENT membership to invite the group to a Night
 * Out. ANY member, not only the administrator, so this sits outside
 * {@link Administration} deliberately.
 *
 * ROUND 5: THE PLAN IS PICKED, NOT TYPED. This used to be a text box asking for a
 * "Night out id", on the reasoning that choosing among the caller's plans belonged to the Night
 * Out surface. A raw uuid is not a choice a person can make, and the requirement is a group-invite
 * control, so the choice belongs here.
 *
 * The list comes from `get_my_invitable_night_outs`, defined in this lane's own 0067, which
 * carries the invite door's exact predicate — accepted membership, status draft or open. NOT
 * `get_my_night_outs`: 0053 narrowed that one to invitations RECEIVED, so it hides the plans the
 * viewer HOSTS, which are the ones a group most often gets invited to.
 */
/**
 * Name a plan the way its host would recognise it: its title if it has one, otherwise its date.
 * A plan the viewer owns is marked, because "my Friday" and "someone else's Friday" are otherwise
 * the same row.
 */
function planLabel(plan: InvitableNightOut): string {
  const name = plan.title !== null && plan.title.trim().length > 0
    ? plan.title
    : plan.night;
  return plan.myRole === 'owner' ? `${name} (yours)` : name;
}

function NightOutInvite({
  busy,
  memberCount,
  members,
  plans,
  plansFailed,
  outcomes,
  onInvite,
  onResend,
}: {
  busy: boolean;
  memberCount: number;
  members: readonly GroupMember[];
  /** Plans the viewer may invite to; null while loading, [] when there genuinely are none. */
  plans: readonly InvitableNightOut[] | null;
  /** True when the plans read FAILED — which is not the same as having none. */
  plansFailed: boolean;
  /** Per-person results of the last whole-group invite, or null if none has run. */
  outcomes: readonly GroupInviteOutcome[] | null;
  onInvite: (nightOutId: string) => void;
  onResend: (profileId: string) => void;
}): JSX.Element {
  const [planId, setPlanId] = useState('');

  // Name the person, not the uuid. A Resend row that says "b3f1…" is not a per-person recovery
  // in any sense a member could act on.
  const labelFor = (profileId: string): string => {
    const member = members.find((m) => m.profileId === profileId);
    return member?.displayName ?? (member?.handle ? `@${member.handle}` : 'That member');
  };

  const failed = (outcomes ?? []).filter((row) => !row.invited);

  return (
    <div
      data-testid="group-invite"
      className="rounded-2xl border border-border bg-surface p-4 space-y-2"
    >
      <label
        htmlFor="group-invite-plan"
        className="block font-display text-xs uppercase tracking-[0.25em] text-muted"
      >
        Invite this group to a night out
      </label>
      <p className="text-xs text-muted">
        Invites the {memberCount === 1 ? 'member' : `${memberCount} members`} in
        this group right now. The group itself is unchanged.
      </p>
      {/*
        THREE STATES, RENDERED AS THREE. A failed read and an empty list are different facts:
        "you have no plans" sends someone off to create a plan they already have, which is the
        exact collapse fetchMyGroups and the feed both refuse by name.
      */}
      {plansFailed ? (
        <p data-testid="group-invite-plans-failed" className="text-xs text-muted">
          Your night out plans could not be loaded, so there is nothing to pick from yet.
        </p>
      ) : plans === null ? (
        <p data-testid="group-invite-plans-loading" className="text-xs text-muted">
          Loading your night out plans…
        </p>
      ) : plans.length === 0 ? (
        <p data-testid="group-invite-plans-empty" className="text-xs text-muted">
          You have no open night out plans to invite this group to.
        </p>
      ) : (
        <select
          id="group-invite-plan"
          data-testid="group-invite-plan"
          value={planId}
          onChange={(event) => setPlanId(event.target.value)}
          className="w-full bg-bg border border-border rounded-2xl px-4 py-3 text-base min-h-[44px]"
        >
          <option value="">Pick a night out…</option>
          {plans.map((plan) => (
            <option key={plan.nightOutId} value={plan.nightOutId}>
              {planLabel(plan)}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={() => onInvite(planId.trim())}
        disabled={busy || planId.trim().length === 0}
        data-testid="group-invite-send"
        className="min-h-[44px] px-4 rounded-full bg-accent text-bg text-sm font-display touch-manipulation disabled:opacity-50"
      >
        Invite the group
      </button>

      {/*
        V8-R-GRP-003: "a failed invite shows a per-person Resend invite; other successful invites
        are unaffected". Only the people who did NOT get in are listed — someone already invited
        must not be offered a resend, both because it is noise and because re-inviting them is
        the notification volume V8-R-GRP-008 exists to hold down.
      */}
      {failed.length > 0 ? (
        <div data-testid="group-invite-failures" className="space-y-2 pt-1">
          <p className="text-xs text-muted">
            These invites did not go through. Everyone else is already invited.
          </p>
          <ul className="space-y-2">
            {failed.map((row) => (
              <li
                key={row.profileId}
                className="flex items-center justify-between gap-3 min-h-[44px]"
              >
                <span className="text-sm truncate">{labelFor(row.profileId)}</span>
                <button
                  type="button"
                  onClick={() => onResend(row.profileId)}
                  disabled={busy}
                  data-testid={`group-invite-resend-${row.profileId}`}
                  aria-label={`Resend invite to ${labelFor(row.profileId)}`}
                  className="min-h-[44px] px-4 rounded-full border border-border text-sm font-display touch-manipulation disabled:opacity-50"
                >
                  Resend
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * V8-R-GRP-006 — "the action states its consequence before it is taken."
 *
 * So the consequence is rendered as text next to the control, not revealed in a
 * confirmation afterwards, and it is the CORRECT consequence for this member:
 * the last member out deletes the group, and an administrator hands
 * administration to the longest-standing member left (D-C-38).
 */
function LeaveGroup({
  busy,
  viewerIsAdmin,
  memberCount,
  onLeave,
}: {
  busy: boolean;
  viewerIsAdmin: boolean;
  memberCount: number;
  onLeave: () => void;
}): JSX.Element {
  const consequence = memberCount <= 1
    ? 'You are the last member, so leaving deletes this group and its messages.'
    : viewerIsAdmin
      ? 'You administer this group. Leaving hands administration to the longest-standing member.'
      : 'Your messages stay in the group.';

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 space-y-2">
      <p data-testid="group-leave-consequence" className="text-xs text-muted">
        {consequence}
      </p>
      <button
        type="button"
        onClick={onLeave}
        disabled={busy}
        data-testid="group-leave"
        className="min-h-[44px] px-4 rounded-full border border-border text-sm font-display touch-manipulation disabled:opacity-50"
      >
        Leave group
      </button>
    </div>
  );
}
