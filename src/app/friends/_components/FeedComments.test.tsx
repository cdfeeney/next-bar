import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MAX_FEED_COMMENT_LENGTH } from '@/lib/feed.server';
import type { FeedAuthor, FeedComment } from '@/lib/feed.server';

/**
 * S-04 (Social redesign, README §3 + Interactions › Reply thread). The thread's
 * three states are covered in FeedSection.test.tsx; this file pins the rules
 * that live in the composer and the rows themselves.
 */

const addFeedComment = vi.fn();
const deleteFeedComment = vi.fn();

vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }));
vi.mock('@/components/Avatar', () => ({
  default: ({ initials }: { initials: string }) => <span data-testid="avatar">{initials}</span>,
}));
vi.mock('@/lib/feed.server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/feed.server')>('@/lib/feed.server');
  return {
    ...actual,
    addFeedComment: (...args: unknown[]) => addFeedComment(...args),
    deleteFeedComment: (...args: unknown[]) => deleteFeedComment(...args),
  };
});

import FeedComments from './FeedComments';

const VIEWER = 'viewer-1';
const AUTHOR = 'author-1';
const OTHER = 'other-1';

const comment = (id: string, authorId: string): FeedComment => ({
  id,
  postId: 'post-1',
  authorId,
  body: `body ${id}`,
  createdAt: '2026-09-13T22:00:00.000Z',
});
const authors: ReadonlyMap<string, FeedAuthor> = new Map([
  [VIEWER, { id: VIEWER, handle: 'me', displayName: 'Me Myself' }],
  [AUTHOR, { id: AUTHOR, handle: 'host', displayName: 'Host H.' }],
  [OTHER, { id: OTHER, handle: 'other', displayName: 'Other O.' }],
]);

function mount(over: Partial<Parameters<typeof FeedComments>[0]> = {}) {
  const onChanged = vi.fn();
  render(
    <FeedComments
      postId="post-1"
      postAuthorId={AUTHOR}
      viewerId={VIEWER}
      comments={[]}
      unreadBaseline={false}
      authors={authors}
      onChanged={onChanged}
      {...over}
    />,
  );
  return { onChanged };
}

describe('FeedComments — rows', () => {
  beforeEach(() => {
    addFeedComment.mockReset();
    deleteFeedComment.mockReset();
  });

  test('the × renders only where the viewer is the commenter or the post author', () => {
    mount({ comments: [comment('c1', VIEWER), comment('c2', OTHER)] });
    const rows = screen.getAllByTestId('feed-comment');
    expect(rows).toHaveLength(2);
    // c1: viewer is the commenter → deletable. c2: another person's reply on a
    // post the viewer does not own → no control at all, not a disabled one.
    expect(rows[0].querySelector('[data-testid="feed-comment-delete"]')).not.toBeNull();
    expect(rows[1].querySelector('[data-testid="feed-comment-delete"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete reply' })).toBeTruthy();
  });

  test('the post author may delete anyone’s reply', () => {
    mount({ viewerId: AUTHOR, comments: [comment('c2', OTHER)] });
    expect(screen.getAllByTestId('feed-comment-delete')).toHaveLength(1);
  });

  test('a row names the commenter and carries an avatar', () => {
    mount({ comments: [comment('c2', OTHER)] });
    expect(screen.getByText('Other O.')).toBeTruthy();
    expect(screen.getByTestId('avatar').textContent).toBe('OO');
  });
});

describe('FeedComments — composer', () => {
  beforeEach(() => {
    addFeedComment.mockReset();
    deleteFeedComment.mockReset();
  });

  test('Send is muted while the draft is empty and accent once there is text', async () => {
    mount();
    const user = userEvent.setup();
    const send = screen.getByTestId('feed-comment-submit');
    expect(send.getAttribute('data-ready')).toBe('false');
    expect(send.getAttribute('aria-disabled')).toBe('true');
    await user.type(screen.getByTestId('feed-comment-input'), 'hey');
    expect(send.getAttribute('data-ready')).toBe('true');
    expect(send.getAttribute('aria-disabled')).toBe('false');
  });

  test('a refused write keeps the draft and states the refusal; a confirmed write clears it', async () => {
    addFeedComment.mockResolvedValueOnce({ ok: false, reason: 'refused', message: 'You cannot reply here.' });
    addFeedComment.mockResolvedValueOnce({ ok: true, value: comment('c9', VIEWER) });
    const { onChanged } = mount();
    const user = userEvent.setup();
    const input = screen.getByTestId('feed-comment-input') as HTMLTextAreaElement;

    await user.type(input, 'first try');
    await user.click(screen.getByTestId('feed-comment-submit'));
    await waitFor(() => expect(screen.getByTestId('feed-comment-notice').textContent).toBe('You cannot reply here.'));
    expect(input.value).toBe('first try');
    expect(onChanged).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('feed-comment-submit'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ added: comment('c9', VIEWER) }));
    expect(input.value).toBe('');
  });

  test('"N left" appears only inside the last 200 characters of the ceiling', async () => {
    mount();
    const input = screen.getByTestId('feed-comment-input') as HTMLTextAreaElement;
    const user = userEvent.setup();
    // userEvent typing 1800 characters is slow; paste instead.
    await user.click(input);
    await user.paste('x'.repeat(MAX_FEED_COMMENT_LENGTH - 201));
    expect(screen.queryByTestId('feed-comment-remaining')).toBeNull();
    await user.paste('x');
    expect(screen.getByTestId('feed-comment-remaining').textContent).toBe('200 left');
  });
});
