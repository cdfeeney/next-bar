'use client';

import { useState } from 'react';
import Avatar from '@/components/Avatar';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  addFeedComment,
  deleteFeedComment,
  FEED_COMMENTS_PER_POST,
  MAX_FEED_COMMENT_LENGTH,
  type FeedAuthor,
  type FeedComment,
} from '@/lib/feed.server';
import { ageLabel } from '@/components/story/storyStore';

/**
 * The visible comment thread on one Feed post — V8-R-FEED-003, and the surface
 * "Reply" opens (V8-R-FEED-005).
 *
 * "ANYONE AUTHORIZED TO VIEW a Feed post may comment on it. Comments are visible
 * to that same audience — the first comment surface in V8."
 *
 * NOTHING HERE IS THE GATE. The right to read this thread and the right to write
 * to it are both decided by migration 0069's `can_view_feed_post`: the RLS policy
 * on `feed_comments` refuses a row the caller may not see, and `add_feed_comment`
 * refuses a write the caller may not make. This component renders what the
 * database returned and reports what it refused. A client-side audience check
 * would be a second opinion, and the one that loses is always the one users see.
 *
 * THE DELETE AFFORDANCE RENDERS ONLY WHERE IT WOULD WORK. V8-R-FEED-008 gives
 * the right to the commenter and to the post author and to nobody else, and its
 * accessibility clause is explicit: "the delete affordance renders only where the
 * viewer is authorized to use it". A button that exists to be refused is worse
 * than no button.
 *
 * FAILURE IS STATED, never swallowed: "a failed comment write must not report
 * success" and "a failed deletion must not report success". Every refusal from
 * the server lands in a live region beside the composer.
 */
/**
 * What a confirmed write did, handed up so the parent can hold it if the re-read
 * that follows fails.
 *
 * THIS LIVES IN THE PARENT, not here. Held locally it was lost the moment the
 * thread was closed — `FeedSection` unmounts this component on toggle — so
 * reopening Reply after a failed refresh resurrected a deleted reply from the
 * stale thread the parent still held. The confirmed fact has to outlive the
 * component that observed it.
 */
export type ConfirmedWrite = { added?: FeedComment; removedId?: string };

export default function FeedComments({
  postId,
  postAuthorId,
  viewerId,
  comments,
  unreadBaseline,
  authors,
  onChanged,
}: {
  postId: string;
  postAuthorId: string;
  /** Null when signed out — the composer is not offered at all. */
  viewerId: string | null;
  /**
   * The thread, or NULL when it has not been read yet — opened before the first
   * comment read resolved, or that read failed. "No replies yet." is a claim
   * about the database, and this component may only make it about a thread that
   * actually came back.
   */
  comments: readonly FeedComment[] | null;
  /**
   * True while the thread itself has never been read successfully.
   *
   * Separate from `comments` because the two are separate facts: a reply this
   * viewer just sent is KNOWN even when the surrounding thread is not, and
   * rendering that one reply on its own would otherwise read as "this is the
   * whole thread".
   */
  unreadBaseline: boolean;
  /** Display identities for commenters, keyed by profile id. */
  authors: ReadonlyMap<string, FeedAuthor>;
  /**
   * Called after a CONFIRMED write, so the parent re-reads the thread — and, when
   * the write produced or removed a row, told WHICH so it can hold that fact if
   * the re-read fails.
   */
  onChanged: (confirmed?: ConfirmedWrite) => void;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const visible = comments;

  const submit = async (): Promise<void> => {
    if (busy) return;
    const supabase = getBrowserSupabase();
    if (supabase === null) {
      setNotice('Replies are unavailable right now.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await addFeedComment(supabase, postId, draft);
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      // Cleared only on a CONFIRMED write. Clearing first would throw away the
      // user's words on a refusal they now have to retype.
      setDraft('');
      onChanged({ added: result.value });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (commentId: string): Promise<void> => {
    if (busy) return;
    const supabase = getBrowserSupabase();
    if (supabase === null) {
      setNotice('Replies are unavailable right now.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await deleteFeedComment(supabase, commentId);
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      // Confirmed by the server, so it leaves the screen NOW and stays gone even
      // if the re-read below fails. Immutable update: a new Set, never a mutation
      // of the one React is holding.
      onChanged({ removedId: commentId });
    } finally {
      setBusy(false);
    }
  };

  // README §3 / Interactions: the Send button is `border`/`muted` while the
  // draft is empty and accent-outlined once there is text; "N left" appears
  // only inside the last 200 characters of the 2000 ceiling.
  const draftLength = draft.trim().length;
  const remaining = MAX_FEED_COMMENT_LENGTH - draft.length;
  const showCounter = remaining <= 200;

  return (
    <section data-testid="feed-comments" data-post={postId} className="mt-3 border-t border-border pt-3">
      <h3 className="sr-only">Replies</h3>

      {/*
        THREE STATES, NOT TWO. "We have not read this thread" is not "this thread
        is empty", and rendering them the same way is the false-ready-state class
        this lane has now hit in three separate places: an outage, or a network
        round-trip the viewer opened Reply during, told them a commented post had
        no replies. `comments === null` is the unread case and says so.
      */}
      {/* Stated whenever the thread itself has not been read, WHETHER OR NOT a
          confirmed reply of the viewer's own is showing beneath it. Those are two
          different facts and collapsing them is how a staged reply would come to
          stand for a thread nobody has seen. */}
      {unreadBaseline ? (
        <p
          data-testid="feed-comments-unavailable"
          role="status"
          className="text-[11px] text-muted"
        >
          Replies could not be loaded yet.
        </p>
      ) : null}

      {visible === null ? null : visible.length === 0 ? (
        <p data-testid="feed-comments-empty" className="text-[11px] text-muted">
          No replies yet.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((comment) => (
            <li key={comment.id} data-testid="feed-comment" data-comment={comment.id}>
              <CommentRow
                comment={comment}
                author={authors.get(comment.authorId) ?? null}
                canDelete={
                  viewerId !== null
                  && (comment.authorId === viewerId || postAuthorId === viewerId)
                }
                busy={busy}
                onDelete={() => void remove(comment.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* THE CEILING SAYS SO. `fetchFeedComments` reads the newest
          FEED_COMMENTS_PER_POST replies and drops the tail, and a thread sitting
          exactly at that bound is the one case where "these are the replies" is
          not the whole truth. Saying it is the difference between a bounded read
          and a silent one; there is no pagination behind this yet, and inventing
          a pager nothing can page would be worse than the honest sentence. */}
      {visible !== null && visible.length >= FEED_COMMENTS_PER_POST ? (
        <p data-testid="feed-comments-truncated" className="mt-2 text-[11px] text-muted">
          Showing the most recent {FEED_COMMENTS_PER_POST} replies.
        </p>
      ) : null}

      {viewerId === null ? null : (
        <>
          <form
            className="mt-2.5 flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="flex-1 min-w-0">
              <span className="sr-only">Write a reply</span>
              <textarea
                data-testid="feed-comment-input"
                value={draft}
                rows={1}
                maxLength={MAX_FEED_COMMENT_LENGTH}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Reply…"
                className="w-full min-h-[44px] rounded-2xl border border-border bg-bg px-3.5 py-2.5 text-sm resize-none"
              />
            </label>
            {/*
              `aria-disabled`, not `disabled`, while a write is in flight: a
              disabled button loses focus to <body>. The guard in `submit` is what
              actually prevents a double write. Same treatment TonightPresence's
              pin control carries.
            */}
            <button
              type="submit"
              data-testid="feed-comment-submit"
              data-ready={draftLength > 0 ? 'true' : 'false'}
              aria-disabled={busy || draftLength === 0}
              className={[
                'min-h-[44px] min-w-[44px] shrink-0 rounded-2xl border px-4 text-[11px] font-label font-bold uppercase tracking-[0.12em] touch-manipulation transition-colors',
                draftLength > 0 ? 'border-accent text-accent' : 'border-border text-muted',
              ].join(' ')}
            >
              Send
            </button>
          </form>
          {showCounter ? (
            <p data-testid="feed-comment-remaining" className="mt-1.5 text-right text-[11px] text-muted">
              {remaining} left
            </p>
          ) : null}
        </>
      )}

      {/* The failure the server reported, in the user's own reading order. */}
      <p
        data-testid="feed-comment-notice"
        role="status"
        aria-live="polite"
        className="mt-2 text-[11px] text-muted empty:hidden"
      >
        {notice ?? ''}
      </p>
    </section>
  );
}

function CommentRow({
  comment,
  author,
  canDelete,
  busy,
  onDelete,
}: {
  comment: FeedComment;
  author: FeedAuthor | null;
  canDelete: boolean;
  busy: boolean;
  onDelete: () => void;
}): JSX.Element {
  // README §3 reply row: 36px avatar, name 13px/600 with the age beside it,
  // body 13px/1.45, and a × that renders ONLY where the viewer may delete. The
  // visible mark is 28px; the hit area stays 44px (HIG), drawn as padding.
  const name = displayName(author);
  return (
    <div className="flex items-start gap-2.5">
      <Avatar initials={initialsOf(name)} seed={author?.id ?? comment.authorId} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold truncate">{name}</span>
          <span className="text-[11px] text-muted shrink-0">{ageLabel(comment.createdAt)}</span>
        </span>
        <span className="block text-[13px] leading-[1.45] break-words mt-0.5">{comment.body}</span>
      </span>
      {canDelete ? (
        <button
          type="button"
          data-testid="feed-comment-delete"
          aria-label="Delete reply"
          aria-disabled={busy}
          onClick={onDelete}
          className="-m-2 p-2 shrink-0 flex items-center justify-center min-h-[44px] min-w-[44px] text-muted hover:text-accent transition-colors touch-manipulation"
        >
          <span aria-hidden="true" className="w-7 h-7 flex items-center justify-center text-[17px] leading-none">
            ×
          </span>
        </button>
      ) : null}
    </div>
  );
}

/** "Claire R." → "CR"; "@handle" → "H"; "Someone" → "S". Never empty. */
function initialsOf(name: string): string {
  const words = name.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}

/**
 * A commenter's name. An unread profile is "Someone" rather than a blank line or
 * a raw uuid: the thread is still readable, and nothing claims to know who it
 * could not look up.
 */
function displayName(author: FeedAuthor | null): string {
  if (author === null) return 'Someone';
  if (author.displayName !== null && author.displayName.length > 0) {
    return author.displayName;
  }
  return author.handle !== null ? `@${author.handle}` : 'Someone';
}
