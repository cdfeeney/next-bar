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
  inviteGroupToNightOut,
  leaveGroup,
  markGroupRead,
  removeGroupMember,
  renameGroup,
  sendGroupMessage,
  MAX_GROUP_MESSAGE_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  type GroupMember,
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
  onClose,
  onChanged,
}: Props): JSX.Element {
  const [status, setStatus] = useState<Status>('loading');
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [name, setName] = useState(groupName);
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

  // V8-R-GRP-008. Opening the thread IS reading it. A failure here is deliberately
  // silent: an unread badge that stays up is a cosmetic inaccuracy, and putting an
  // error line above someone's conversation for it would be worse than the bug.
  useEffect(() => {
    void markGroupRead(client, groupId).then((result) => {
      if (result.ok) onChanged();
    });
  }, [client, groupId, onChanged]);

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
              name={name}
              members={members}
              viewerId={viewerId}
              addable={addable}
              busy={busy}
              onName={setName}
              onRename={(next) =>
                void run(
                  () => renameGroup(client, groupId, next),
                  'Group renamed.',
                )
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
            onInvite={(nightOutId) =>
              void run(async () => {
                const result = await inviteGroupToNightOut(
                  client,
                  nightOutId,
                  groupId,
                );
                if (!result.ok) return { ok: false, message: result.message };
                const failed = result.value.filter((row) => !row.invited);
                // PARTIAL SUCCESS IS REPORTED AS PARTIAL. Rounding a mixed
                // result up to "invited" is what the requirement's per-person
                // Resend clause exists to prevent.
                return failed.length === 0
                  ? { ok: true }
                  : {
                      ok: false,
                      message: `${failed.length} of ${result.value.length} invites did not go through. Try those again.`,
                    };
              }, 'The group was invited.')
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

  const who = message.senderDisplayName
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
 * The plan is named by its id rather than picked from a list: choosing among
 * the caller's plans is the Night Out surface's job and that surface is not this
 * lane's to write. The membership reuse — the part this requirement is about —
 * is complete.
 */
function NightOutInvite({
  busy,
  memberCount,
  onInvite,
}: {
  busy: boolean;
  memberCount: number;
  onInvite: (nightOutId: string) => void;
}): JSX.Element {
  const [planId, setPlanId] = useState('');

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
      <input
        id="group-invite-plan"
        data-testid="group-invite-plan"
        value={planId}
        onChange={(event) => setPlanId(event.target.value)}
        placeholder="Night out id"
        className="w-full bg-bg border border-border rounded-2xl px-4 py-3 text-base min-h-[44px]"
      />
      <button
        type="button"
        onClick={() => onInvite(planId.trim())}
        disabled={busy || planId.trim().length === 0}
        data-testid="group-invite-send"
        className="min-h-[44px] px-4 rounded-full bg-accent text-bg text-sm font-display touch-manipulation disabled:opacity-50"
      >
        Invite the group
      </button>
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
