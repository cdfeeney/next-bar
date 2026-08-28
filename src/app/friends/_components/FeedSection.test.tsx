import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { FEED_COMMENTS_PER_POST } from '@/lib/feed.server';
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
    nightTokenComplete: true,
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

/**
 * A spy standing in for the card's avatar, so a COMMIT carrying a post can be
 * observed rather than inferred.
 *
 * `rerender` runs inside `act()`, which flushes passive effects before it
 * returns, so a queryBy* assertion straight after it cannot tell a render-time
 * reset from an effect-time one — both look clean by then, and the effect version
 * has already painted a frame of the previous account's Feed in a real browser.
 * A child records what was actually RENDERED: React re-runs a component that sets
 * state during its own render BEFORE rendering children, so with the reset in
 * render this spy is never called with the old account's post, while an effect
 * lets the whole card render and commit first.
 */
const { avatarRenders } = vi.hoisted(() => ({ avatarRenders: vi.fn<(seed: string) => void>() }));
vi.mock('@/components/Avatar', () => ({
  default: ({ seed }: { seed: string }) => {
    avatarRenders(seed);
    return null;
  },
}));

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
  // Deliberately tiny. The component compares a thread's length against this
  // constant, so the BOUNDARY is what the test is about — building two hundred
  // fixtures would prove the same thing slower.
  FEED_COMMENTS_PER_POST: 3,
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
  // A DISTINCT body, because a confirmed addition is now staged into the thread
  // until a successful read supersedes it — reusing the existing reply's text
  // would make every assertion about "the reply already on screen" ambiguous.
  addResult = { ok: true, value: makeComment({ id: 'comment-2', body: 'just sent' }) };
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
    avatarRenders.mockClear();
    view.rerender(<FeedSection entries={[]} onOpenStory={() => {}} />);

    // NOT a queryBy* assertion, and not waitFor. Round 4 (HIGH, codex): the clear
    // used to live in the passive effect, and React runs those AFTER the browser
    // paints — so the commit carrying account B's viewerId painted with A's posts
    // still in state, and the clear arrived a frame later. `rerender` flushes
    // effects inside act(), so BOTH versions look clean to a DOM query taken
    // afterwards; the first version of this assertion passed against the defect.
    // What separates them is whether A's card was ever RENDERED under B.
    expect(
      avatarRenders,
      "the previous account's card was rendered and committed under the new account",
    ).not.toHaveBeenCalled();

    // And it is gone from the DOM too, once B's stalled read has had its chance.
    await waitFor(() => expect(screen.queryByText('account A memory')).toBeNull());
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
    // Scoped to the RETAINED reply. The confirmed addition is now staged into the
    // thread as well, so it has a byline too and an unscoped query matches both;
    // what this case is about is the reply that was already on screen keeping its
    // name through the failed read.
    expect(
      screen.getByText('first reply').closest('li')?.textContent,
      'the retained reply lost its byline',
    ).toContain('Commenter');
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

describe('FeedSection — the viewer bookkeeping is state, not a ref', () => {
  /**
   * A SOURCE-SHAPE ASSERTION, and the reason it is one is worth stating.
   *
   * The defect this pins (round 5, HIGH) only appears when React ABANDONS an
   * interruptible render: a ref write survives the discarded work while the
   * render-phase state updates beside it do not, so the retry sees "already
   * handled" and commits the previous account's Feed. Testing Library renders
   * synchronously and never abandons a render, so no behavioural test in this
   * suite can distinguish the two — the ref version passes every case above.
   *
   * Rather than claim coverage this suite cannot give, the requirement itself is
   * pinned: the value that records whose Feed is on screen must be STATE. That
   * is React's own rule for adjusting state during render, and it is the thing a
   * future edit would undo.
   */
  const SOURCE = readFileSync(
    path.join(__dirname, 'FeedSection.tsx'),
    'utf8',
  ).replace(/\r\n/g, '\n');

  test('paintedFor is held in state so an abandoned render discards it with the clears', () => {
    expect(SOURCE).toMatch(
      /const \[paintedFor, setPaintedFor\] = useState<string \| null>\(viewerId\)/,
    );
  });

  test('the ONLY ref written anywhere in this file is the request sequence', () => {
    // Round 6 (MEDIUM, codex): the previous version of this test forbade only ref
    // names beginning with `paintedFor`, so keeping the state declaration and
    // gating the reset through a differently named ref left it green while
    // restoring the defect exactly. Naming the one write that is allowed, rather
    // than the names that are not, is what closes that.
    //
    // `requestSeq.current += 1` is legitimate: it is inside `refresh`, a callback,
    // not the render pass. Any OTHER ref write in this file is either a render-
    // phase mutation — which does not survive an abandoned render the way the
    // state beside it does — or a new one that has to justify itself here first.
    const writes = SOURCE.match(/\w+\.current\s*(?:\+=|-=|=[^=])/g) ?? [];
    expect(
      writes,
      'a ref is being written somewhere new in FeedSection; if it is in render, an abandoned render keeps it',
    ).toEqual(['requestSeq.current +=']);
  });
});

describe('FeedComments — a confirmed write is not undone by a failed read', () => {
  test('a deleted reply stays gone even when the follow-up thread read fails', async () => {
    const user = userEvent.setup();
    // The viewer authored the comment, so the Remove affordance renders.
    commentPlan = [{ ok: true, value: new Map([['post-1', [makeComment({ authorId: VIEWER })]]]) }];
    render(<FeedSection entries={[]} onOpenStory={() => {}} />);

    await user.click(await screen.findByTestId('feed-reply'));
    expect(await screen.findByText('first reply')).toBeTruthy();

    // The delete is CONFIRMED by the server, and the re-read it triggers fails.
    commentPlan = [FAILED];
    await user.click(screen.getByTestId('feed-comment-delete'));

    await waitFor(() =>
      expect(
        screen.queryByText('first reply'),
        'a reply the server confirmed deleted came back because the re-read failed',
      ).toBeNull(),
    );

    // AND IT SURVIVES CLOSING THE THREAD. Round 6 (MEDIUM, codex): held inside
    // FeedComments, the confirmed deletion died with the component the moment
    // Reply was toggled shut, and reopening rendered the deleted row again from
    // the stale thread the parent still held.
    await user.click(screen.getByTestId('feed-reply')); // close
    await user.click(screen.getByTestId('feed-reply')); // reopen

    expect(
      screen.queryByText('first reply'),
      'closing and reopening the thread resurrected a confirmed deletion',
    ).toBeNull();
  });

  test('deleting a reply that is itself still staged removes it', async () => {
    const user = userEvent.setup();
    // Round 7 (MEDIUM, codex): only the BASELINE rows were filtered by the
    // confirmed-deletion set, so a reply that was still staged from a failed
    // add-refresh was appended straight back after being deleted.
    commentPlan = [{ ok: true, value: new Map([['post-1', []]]) }];
    addResult = { ok: true, value: makeComment({ id: 'staged', body: 'staged reply', authorId: VIEWER }) };
    render(<FeedSection entries={[]} onOpenStory={() => {}} />);

    await user.click(await screen.findByTestId('feed-reply'));
    commentPlan = [FAILED];
    await user.type(screen.getByTestId('feed-comment-input'), 'staged reply');
    await user.click(screen.getByTestId('feed-comment-submit'));
    expect(await screen.findByText('staged reply')).toBeTruthy();

    // Now delete the staged reply, with that refresh failing too.
    await user.click(screen.getByTestId('feed-comment-delete'));

    await waitFor(() =>
      expect(
        screen.queryByText('staged reply'),
        'a confirmed deletion did not reach a reply that was still staged',
      ).toBeNull(),
    );
  });

  test('a reply added to a thread that never loaded is shown, and the thread still says it is unread', async () => {
    const user = userEvent.setup();
    // Round 7 (MEDIUM, codex): withPending returned null the moment the baseline
    // was unread, so a confirmed reply was discarded — the composer cleared and
    // nothing showed it had landed. Both facts are true at once and both are said.
    commentPlan = [FAILED];
    addResult = { ok: true, value: makeComment({ id: 'staged', body: 'landed anyway', authorId: VIEWER }) };
    render(<FeedSection entries={[]} onOpenStory={() => {}} />);

    await user.click(await screen.findByTestId('feed-reply'));
    await user.type(screen.getByTestId('feed-comment-input'), 'landed anyway');
    await user.click(screen.getByTestId('feed-comment-submit'));

    expect(
      await screen.findByText('landed anyway'),
      'a confirmed reply was dropped because the thread around it had never loaded',
    ).toBeTruthy();
    expect(
      screen.getByTestId('feed-comments-unavailable'),
      'the staged reply was allowed to stand for the whole thread',
    ).toBeTruthy();
  });

  test('a reply the server confirmed added is not lost when the follow-up read fails', async () => {
    const user = userEvent.setup();
    render(<FeedSection entries={[]} onOpenStory={() => {}} />);

    await user.click(await screen.findByTestId('feed-reply'));
    await screen.findByText('first reply');

    // The write is CONFIRMED and the re-read it triggers fails.
    commentPlan = [FAILED];
    await user.type(screen.getByTestId('feed-comment-input'), 'just sent');
    await user.click(screen.getByTestId('feed-comment-submit'));

    expect(
      await screen.findByText('just sent'),
      'a reply the server accepted vanished because the read after it failed',
    ).toBeTruthy();
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

  test('a thread sitting at the read ceiling says so, rather than implying it is all of them', async () => {
    const user = userEvent.setup();
    const full = Array.from({ length: FEED_COMMENTS_PER_POST }, (_, i) =>
      makeComment({ id: `c-${i}`, body: `reply ${i}` }));
    commentPlan = [{ ok: true, value: new Map([['post-1', full]]) }];
    render(<FeedSection entries={[]} onOpenStory={() => {}} />);

    await user.click(await screen.findByTestId('feed-reply'));

    expect(
      await screen.findByTestId('feed-comments-truncated'),
      'a thread read at its ceiling was presented as the whole thread',
    ).toBeTruthy();
  });

  test('a short thread claims nothing about a ceiling', async () => {
    const user = userEvent.setup();
    render(<FeedSection entries={[]} onOpenStory={() => {}} />);

    await user.click(await screen.findByTestId('feed-reply'));
    await screen.findByText('first reply');

    expect(screen.queryByTestId('feed-comments-truncated')).toBeNull();
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
