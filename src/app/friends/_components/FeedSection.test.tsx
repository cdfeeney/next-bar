import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { FeedAuthor, FeedComment, FeedPostView } from '@/lib/feed.server';

/**
 * FeedSection's refresh state machine — the file that had NO test at all.
 *
 * Two review rounds found SIX distinct defects in this component, five of them
 * in the same ~40 lines of `refresh`, and one of those was a regression the
 * previous round's own fix introduced. The goal body's stop rule says that when
 * one root-cause family recurs twice you stop patching instances and fix the
 * cause. The cause is that nothing here was executed by any gate: typecheck,
 * the SQL text suites and a signed-out-only browser spec all stayed green
 * through every one of them.
 *
 * So this suite drives the component. Each case below is one of those findings,
 * and each was mutation-checked by reverting its fix and confirming the case
 * goes RED — a coverage fix that cannot fail is the same defect wearing the
 * repair, which is exactly what round 3 caught in the sibling suite.
 */

type Comments = ReadonlyMap<string, FeedComment[]>;
type Result<T> = { ok: true; value: T } | { ok: false; reason: string; message: string };

const VIEWER = '11111111-1111-4111-8111-111111111111';
const COMMENTER = '22222222-2222-4222-8222-222222222222';
const AUTHOR = '33333333-3333-4333-8333-333333333333';
const OTHER_VIEWER = '44444444-4444-4444-8444-444444444444';

const FAILED = {
  ok: false,
  reason: 'failed',
  message: 'no',
} as const satisfies Result<never>;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makePost(over: Partial<FeedPostView> = {}): FeedPostView {
  return {
    id: 'post-1',
    authorId: AUTHOR,
    mediaId: 'media-1',
    barId: null,
    caption: 'a caption',
    nightOutId: null,
    audience: 'friends',
    audienceGroupId: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    tagIds: [],
    author: { id: AUTHOR, handle: 'author', displayName: 'Author' },
    mediaUrl: 'https://example.test/photo.jpg',
    mediaState: 'ok',
    nightShareToken: null,
    tagsComplete: true,
    ...over,
  };
}

function makeComment(over: Partial<FeedComment> = {}): FeedComment {
  return {
    id: 'comment-1',
    postId: 'post-1',
    authorId: COMMENTER,
    body: 'first reply',
    createdAt: '2026-08-24T01:00:00.000Z',
    ...over,
  };
}

/** Answers handed to the mocks, in call order; the last one repeats. */
let postPlan: Array<Result<FeedPostView[]> | Promise<Result<FeedPostView[]>>> = [];
let commentPlan: Array<Result<Comments> | Promise<Result<Comments>>> = [];
let authorPlan: Array<Map<string, FeedAuthor>> = [];
let addResult: Result<FeedComment> = { ok: true, value: makeComment({ id: 'comment-2' }) };

let authStatus: 'signed-in' | 'signed-out' = 'signed-in';
/** Which account is signed in — a switch between two of them is its own case. */
let viewer = VIEWER;
let epoch = 1;

function next<T>(plan: T[]): T {
  return plan.length > 1 ? (plan.shift() as T) : plan[0];
}

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () =>
    authStatus === 'signed-in'
      ? { status: 'signed-in', user: { id: viewer } }
      : { status: 'signed-out', user: null },
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({}),
}));

vi.mock('@/lib/accountCache', () => ({
  getCacheEpoch: () => epoch,
}));

vi.mock('@/lib/feed.server', () => ({
  MAX_FEED_COMMENT_LENGTH: 2000,
  fetchFeedPosts: async () => next(postPlan),
  fetchFeedComments: async () => next(commentPlan),
  fetchFeedAuthors: async () => next(authorPlan),
  addFeedComment: async () => addResult,
  deleteFeedComment: async () => ({ ok: true, value: true }),
}));

import FeedSection from './FeedSection';

const NAMED = new Map<string, FeedAuthor>([
  [COMMENTER, { id: COMMENTER, handle: 'commenter', displayName: 'Commenter' }],
]);

beforeEach(() => {
  authStatus = 'signed-in';
  viewer = VIEWER;
  epoch = 1;
  postPlan = [{ ok: true, value: [makePost()] }];
  commentPlan = [{ ok: true, value: new Map([['post-1', [makeComment()]]]) }];
  authorPlan = [NAMED];
  addResult = { ok: true, value: makeComment({ id: 'comment-2' }) };
});

describe('FeedSection — the failure banner belongs to the session that failed', () => {
  test('signing out clears a load failure raised while signed in', async () => {
    postPlan = [FAILED];
    const view = render(<FeedSection entries={[]} onOpenStory={() => {}} />);
    expect(await screen.findByTestId('feed-load-failed')).toBeTruthy();

    authStatus = 'signed-out';
    view.rerender(<FeedSection entries={[]} onOpenStory={() => {}} />);

    await waitFor(() =>
      expect(
        screen.queryByTestId('feed-load-failed'),
        'a signed-out visitor was told the Feed they have no access to could not be loaded',
      ).toBeNull(),
    );
  });

  test('a real failure while signed in still says so', async () => {
    postPlan = [FAILED];
    render(<FeedSection entries={[]} onOpenStory={() => {}} />);
    expect(
      await screen.findByTestId('feed-load-failed'),
      'the banner stopped rendering for the case it exists for',
    ).toBeTruthy();
  });
});

describe('FeedSection — the Feed on screen belongs to the account that loaded it', () => {
  test('switching straight from one signed-in account to another clears the first one’s Feed', async () => {
    // Round 3 (HIGH, codex). Signing OUT was handled; a signed-in to signed-in
    // switch never passes through null, so viewerId went straight from A to B and
    // A's posts stayed painted until B's reads landed — or forever, if they
    // failed. The epoch guard rejects A's in-flight ANSWERS and cannot unrender
    // what is already on screen.
    postPlan = [{ ok: true, value: [makePost({ caption: 'account A memory' })] }];
    const view = render(<FeedSection entries={[]} onOpenStory={() => {}} />);
    expect(await screen.findByText('account A memory')).toBeTruthy();

    // Account B signs in directly. Its read never resolves.
    const held = deferred<Result<FeedPostView[]>>();
    postPlan = [held.promise];
    authStatus = 'signed-in';
    viewer = OTHER_VIEWER;
    epoch = 2;
    view.rerender(<FeedSection entries={[]} onOpenStory={() => {}} />);

    await waitFor(() =>
      expect(
        screen.queryByText('account A memory'),
        "one account's Feed was left on screen for the next account to read",
      ).toBeNull(),
    );
  });
});

describe('FeedSection — a failed comment read keeps the thread AND its names', () => {
  test('prior threads survive, the failure is stated, and bylines do not fall back to "Someone"', async () => {
    const user = userEvent.setup();
    render(<FeedSection entries={[]} onOpenStory={() => {}} />);

    await user.click(await screen.findByTestId('feed-reply'));
    expect(await screen.findByText('first reply')).toBeTruthy();
    expect(screen.getByText(/Commenter/)).toBeTruthy();

    // The next refresh reads posts fine and comments not at all. With no
    // commenter ids to ask for, the identity lookup returns only tagged people.
    commentPlan = [FAILED];
    authorPlan = [new Map()];
    epoch = 1;
    await user.click(screen.getByTestId('feed-reply')); // close
    await user.click(screen.getByTestId('feed-reply')); // reopen — no refetch
    // Drive a real refresh through the confirmed-write path.
    await user.type(screen.getByTestId('feed-comment-input'), 'hello');
    await user.click(screen.getByTestId('feed-comment-submit'));

    await waitFor(() => expect(screen.getByTestId('feed-load-failed')).toBeTruthy());
    expect(
      screen.getByText('first reply'),
      'a failed comment read discarded the thread already on screen',
    ).toBeTruthy();
    expect(
      screen.queryByText(/Someone/),
      'the retained reply lost its author identity and fell back to "Someone"',
    ).toBeNull();
    expect(screen.getByText(/Commenter/)).toBeTruthy();
  });
});

describe('FeedSection — a superseded refresh may not roll back a confirmed write', () => {
  test('a slower earlier read does not overwrite the thread a newer one delivered', async () => {
    const user = userEvent.setup();
    // The mount read hands back a thread only after we let it.
    const held = deferred<Result<Comments>>();
    commentPlan = [
      held.promise,
      { ok: true, value: new Map([['post-1', [makeComment(), makeComment({ id: 'comment-2', body: 'just sent' })]]]) },
    ];

    render(<FeedSection entries={[]} onOpenStory={() => {}} />);
    await user.click(await screen.findByTestId('feed-reply'));

    // Refresh B: a confirmed write, whose read answers first.
    await user.type(screen.getByTestId('feed-comment-input'), 'just sent');
    await user.click(screen.getByTestId('feed-comment-submit'));
    expect(await screen.findByText('just sent')).toBeTruthy();

    // Only now does refresh A — started FIRST — answer, with the older thread.
    held.resolve({ ok: true, value: new Map([['post-1', [makeComment()]]]) });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(
      screen.queryByText('just sent'),
      'a refresh that started before the write overwrote the thread it produced',
    ).toBeTruthy();
  });

  test('an account switch mid-flight still discards the previous account’s answer', async () => {
    // The epoch guard is the OTHER half and must survive the ordering rework.
    const held = deferred<Result<FeedPostView[]>>();
    postPlan = [held.promise];
    render(<FeedSection entries={[]} onOpenStory={() => {}} />);

    epoch = 2;
    held.resolve({ ok: true, value: [makePost({ caption: 'another account' })] });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(
      screen.queryByText('another account'),
      "a post read for the previous account was painted into this one's Feed",
    ).toBeNull();
  });
});

describe('FeedSection — "no replies" and "we have not read the replies" are different answers', () => {
  test('a thread whose comment read failed does not claim the post has no replies', async () => {
    const user = userEvent.setup();
    // Posts load; the very first comment read fails, so nothing is known about
    // this thread. Opening Reply must not assert an empty one.
    commentPlan = [FAILED];
    render(<FeedSection entries={[]} onOpenStory={() => {}} />);

    await user.click(await screen.findByTestId('feed-reply'));

    expect(
      await screen.findByTestId('feed-comments-unavailable'),
      'an unread thread was rendered as a settled empty thread',
    ).toBeTruthy();
    expect(
      screen.queryByTestId('feed-comments-empty'),
      'a post whose replies were never read was told it has none',
    ).toBeNull();
  });

  test('a thread that really is empty still says so', async () => {
    const user = userEvent.setup();
    // The read SUCCEEDS and returns an entry for this post with no comments —
    // which is what fetchFeedComments does for every post it was asked about.
    commentPlan = [{ ok: true, value: new Map([['post-1', []]]) }];
    render(<FeedSection entries={[]} onOpenStory={() => {}} />);

    await user.click(await screen.findByTestId('feed-reply'));

    expect(
      await screen.findByTestId('feed-comments-empty'),
      'a genuinely empty thread was reported as a failed read',
    ).toBeTruthy();
    expect(screen.queryByTestId('feed-comments-unavailable')).toBeNull();
  });
});

describe('FeedSection — "no tags" and "we could not read the tags" are different answers', () => {
  test('an incomplete tag read renders a stated failure, not a confidently untagged post', async () => {
    postPlan = [{ ok: true, value: [makePost({ tagIds: [], tagsComplete: false })] }];
    render(<FeedSection entries={[]} onOpenStory={() => {}} />);

    expect(
      await screen.findByTestId('feed-post-tags-unavailable'),
      'a failed feed_post_tags read rendered as a post with no tags',
    ).toBeTruthy();
  });

  test('a complete read with no tags says nothing at all', async () => {
    render(<FeedSection entries={[]} onOpenStory={() => {}} />);
    await screen.findByTestId('feed-post');
    expect(
      screen.queryByTestId('feed-post-tags-unavailable'),
      'an untagged post was reported as a tag-read failure',
    ).toBeNull();
    expect(screen.queryByTestId('feed-post-tags')).toBeNull();
  });
});
