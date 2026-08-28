'use client';

import { useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  addFeedComment,
  deleteFeedComment,
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
export default function FeedComments({
  postId,
  postAuthorId,
  viewerId,
  comments,
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
  /** Display identities for commenters, keyed by profile id. */
  authors: ReadonlyMap<string, FeedAuthor>;
  /** Called after a CONFIRMED write, so the parent re-reads the thread. */
  onChanged: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
      onChanged();
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
      onChanged();
    } finally {
      setBusy(false);
    }
  };

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
      {comments === null ? (
        <p
          data-testid="feed-comments-unavailable"
          role="status"
          className="text-[11px] text-muted"
        >
          Replies could not be loaded yet.
        </p>
      ) : comments.length === 0 ? (
        <p data-testid="feed-comments-empty" className="text-[11px] text-muted">
          No replies yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {comments.map((comment) => (
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

      {viewerId === null ? null : (
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="flex-1">
            <span className="sr-only">Write a reply</span>
            <textarea
              data-testid="feed-comment-input"
              value={draft}
              rows={2}
              maxLength={MAX_FEED_COMMENT_LENGTH}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Reply…"
              className="w-full min-h-[44px] rounded-2xl border border-border bg-surface px-3 py-2 text-sm"
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
            aria-disabled={busy || draft.trim().length === 0}
            className="min-h-[44px] min-w-[44px] shrink-0 rounded-2xl border border-border px-4 text-xs font-display uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
          >
            Send
          </button>
        </form>
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
  return (
    <div className="flex items-start gap-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-muted">
          {displayName(author)} · {ageLabel(comment.createdAt)}
        </span>
        <span className="block text-sm leading-relaxed break-words">{comment.body}</span>
      </span>
      {canDelete ? (
        <button
          type="button"
          data-testid="feed-comment-delete"
          aria-disabled={busy}
          onClick={onDelete}
          className="min-h-[44px] min-w-[44px] shrink-0 text-[11px] text-muted hover:text-accent transition-colors touch-manipulation"
        >
          Remove
        </button>
      ) : null}
    </div>
  );
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
