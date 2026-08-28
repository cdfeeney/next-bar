'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Avatar from '@/components/Avatar';
import StoryFrame from '@/components/story/StoryFrame';
import { ageLabel, type FeedEntry } from '@/components/story/storyStore';
import { getBarById } from '@/lib/catalog';
import { displayHood } from '@/lib/hoodDisplay';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch } from '@/lib/accountCache';
import { useAuth } from '@/hooks/useAuth';
import {
  fetchFeedAuthors,
  fetchFeedComments,
  fetchFeedPosts,
  type FeedAuthor,
  type FeedComment,
  type FeedPostView,
} from '@/lib/feed.server';
import FeedComments from './FeedComments';

/**
 * Social → Feed.
 *
 * TWO KINDS OF CARD LIVE HERE, and they are different things rather than two
 * renderings of one:
 *
 *  - A FEED POST (migration 0069, V8-R-FEED-001) — the photo memory the global
 *    composer writes to. It has NO expiry (V8-R-FEED-002), its audience is
 *    mutual-friend scoped and never public (V8-R-FEED-006), and it carries
 *    exactly two actions: View night and Reply.
 *  - A STORY memory — the same real, unexpired 24-hour `public.stories` rows the
 *    rail shows, rendered chronologically. This is WP1's surface and it is
 *    unchanged below, testids included.
 *
 * WHY THIS COMPONENT LOADS ITS OWN POSTS. The parent (`src/app/friends/page.tsx`)
 * belongs to another lane's write scope and passes only the story entries. A
 * post surface that waited for that wiring would be a backend nothing reaches.
 * So the Feed read is issued here, and when it returns nothing — signed out,
 * unconfigured, or simply no posts — this renders exactly what it rendered
 * before, which is why the signed-out assertions in `e2e/social-feed.spec.ts`
 * still hold.
 *
 * WHAT IS DELIBERATELY NOT ON A CARD:
 *  - No like count and no follower metric, unchanged from the locked canvas.
 *  - NO THIRD ACTION, including delete. V8-R-FEED-001 fixes the card at "exactly
 *    two actions: View night and Reply". The author's deletion verb exists —
 *    `delete_feed_post` in 0069, and "remove from this destination" in WP1's
 *    media route — and its affordance belongs to the composer/media surface that
 *    owns media management, not to a card whose action count the contract pins.
 */
export default function FeedSection({
  entries,
  onOpenStory,
}: {
  entries: readonly FeedEntry[];
  /** Opens the story viewer on this author's queue. Keyed by profile id. */
  onOpenStory: (authorId: string) => void;
}): JSX.Element {
  const auth = useAuth();
  const viewerId = auth.status === 'signed-in' ? auth.user.id : null;

  const [posts, setPosts] = useState<readonly FeedPostView[]>([]);
  const [threads, setThreads] = useState<ReadonlyMap<string, FeedComment[]>>(
    () => new Map(),
  );
  const [people, setPeople] = useState<ReadonlyMap<string, FeedAuthor>>(
    () => new Map(),
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [openThread, setOpenThread] = useState<string | null>(null);

  /**
   * The sequence number of the most recently STARTED refresh.
   *
   * The epoch guard below catches an ACCOUNT SWITCH and nothing else, so two
   * refreshes for the same account — the mount read and the one `onChanged`
   * fires after a confirmed write — both passed it and both committed, in
   * whatever order they happened to resolve. When the older one landed last it
   * overwrote the newer thread and the just-sent reply vanished (or a deleted
   * one came back) until something refreshed again. Ordering is the missing
   * term: only the newest request may write, whoever answers first.
   */
  const requestSeq = useRef(0);

  /**
   * Whose Feed is currently ON SCREEN. `undefined` until the first refresh runs.
   *
   * Everything this component renders is audience-scoped to one account
   * (V8-R-FEED-006), so it belongs to the viewer who loaded it and to nobody
   * else.
   */
  const paintedFor = useRef<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    const seq = (requestSeq.current += 1);

    // THE FEED ON SCREEN BELONGS TO THE ACCOUNT THAT LOADED IT, and it is cleared
    // the moment the viewer changes rather than when the next account's read
    // happens to land.
    //
    // Signing OUT was already handled below. A signed-in to signed-in switch was
    // not, and it never passes through null: `viewerId` goes straight from A to
    // B, the effect re-runs, and until B's reads resolve — or forever, if they
    // fail — B is looking at A's posts, A's threads and A's names. The epoch
    // guard does not help: it rejects A's in-flight ANSWERS, and cannot unrender
    // what has already painted.
    if (paintedFor.current !== viewerId) {
      paintedFor.current = viewerId;
      setPosts([]);
      setThreads(new Map());
      setPeople(new Map());
      // AND THE FAILURE BANNER GOES WITH IT. Leaving `loadFailed` set told a
      // signed-out visitor that "the Feed could not be loaded" forever, about a
      // Feed there is nothing to load: the banner is not gated on auth, so a
      // read that failed while signed in outlived the session that issued it.
      setLoadFailed(false);
    }

    if (viewerId === null) {
      // Signed out there is no Feed to read at all: V8-R-FEED-006 makes the
      // audience mutual-friend scoped, so an anonymous read has no audience to
      // be inside and the database would refuse every row anyway.
      return;
    }
    const supabase = getBrowserSupabase();
    if (supabase === null) return;

    // An account switch mid-flight must not land another account's Feed, and a
    // superseded refresh must not land its own account's older one.
    const epoch = getCacheEpoch();
    const stale = (): boolean => seq !== requestSeq.current || getCacheEpoch() !== epoch;

    const loaded = await fetchFeedPosts(supabase);
    if (stale()) return;

    if (!loaded.ok) {
      // "a failed circle read must render an honest error, never an empty ready
      // state" (V8-R-FEED-001). The posts already on screen are kept: replacing
      // them with nothing would turn an outage into a claim that the Feed is
      // empty.
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setPosts(loaded.value);

    const ids = loaded.value.map((post) => post.id);
    const comments = await fetchFeedComments(supabase, ids);
    if (stale()) return;
    // A FAILED COMMENT READ IS NOT AN EMPTY THREAD. Substituting an empty map
    // here turned an outage into "No replies yet." — the same false ready state
    // the posts branch above refuses, one read further down, and it also
    // discarded threads already on screen so a just-posted reply looked deleted
    // (the refresh that follows onChanged is exactly when this fires). Keep what
    // we have and say the read failed, honouring the module contract in
    // feed.server.ts: a failure is never reported as a settled empty result.
    if (comments.ok) {
      setThreads(comments.value);
    } else {
      // The threads on screen are KEPT, not replaced, and the failure is stated.
      // Neither branch here may reach setThreads(new Map()): that turned an
      // outage into "No replies yet." — the same false ready state the posts
      // branch above refuses, one read further down — and it discarded threads
      // already loaded, so a just-posted reply looked deleted. The refresh that
      // follows onChanged is exactly when this fires.
      setLoadFailed(true);
    }

    // Identity resolution runs EITHER WAY, because the posts did load and their
    // tag chips are owed a name whatever the comment read did.
    //
    // Commenters are not necessarily post authors, and TAGGED PEOPLE are
    // neither: a tagged friend who wrote no post and left no comment in this
    // batch is the common case, not the corner. Asking only for commenters left
    // every such chip rendering the "Someone" fallback, which is the tag display
    // V8-R-FEED-001 requires failing quietly on real data. One lookup covers
    // both, because fetchFeedAuthors already de-duplicates its id list.
    const commenterIds = comments.ok
      ? [...comments.value.values()].flat().map((comment) => comment.authorId)
      : [];
    const taggedIds = loaded.value.flatMap((post) => post.tagIds);
    const named = await fetchFeedAuthors(supabase, [...commenterIds, ...taggedIds]);
    if (stale()) return;
    // A FAILED COMMENT READ MUST NOT RENAME THE THREADS IT LEFT ON SCREEN. With
    // no commenter ids to ask for, `named` covers only tagged people, so
    // REPLACING the map stripped the byline off every retained reply and the
    // thread we deliberately kept re-rendered as a wall of "Someone" — a
    // different lie from the empty thread the branch above refuses, in the same
    // place. A successful read already names everyone on screen, so it replaces;
    // a failed one merges, and the newly-read names still win.
    setPeople((prev) => (comments.ok ? named : new Map([...prev, ...named])));
  }, [viewerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Post authors and commenters in one lookup for the thread bylines. */
  const authors = useMemo(() => {
    const merged = new Map<string, FeedAuthor>(people);
    for (const post of posts) {
      if (post.author !== null) merged.set(post.author.id, post.author);
    }
    return merged;
  }, [people, posts]);

  return (
    <section data-testid="friends-feed" aria-labelledby="feed-heading">
      <h2
        id="feed-heading"
        className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3"
      >
        Tonight
      </h2>

      {loadFailed ? (
        <p
          data-testid="feed-load-failed"
          role="status"
          className="rounded-2xl border border-border bg-surface p-4 text-sm leading-relaxed mb-4"
        >
          The Feed could not be loaded. This is not an empty Feed — try again in a
          moment.
        </p>
      ) : null}

      {posts.length > 0 ? (
        <ul className="space-y-4 mb-4">
          {posts.map((post) => (
            <li key={post.id}>
              <FeedPostCard
                post={post}
                viewerId={viewerId}
                // `?? null`, never `?? []`: an absent entry means the comment read
                // has not landed, and substituting an empty array here is what
                // made FeedComments claim "No replies yet." for a thread nobody
                // had read. A post with a settled empty thread HAS an entry.
                comments={threads.get(post.id) ?? null}
                authors={authors}
                threadOpen={openThread === post.id}
                onToggleThread={() =>
                  setOpenThread((current) => (current === post.id ? null : post.id))
                }
                onChanged={() => void refresh()}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="space-y-4">
        {entries.map((entry) => (
          <li key={entry.story.id}>
            <MemoryCard entry={entry} onOpenStory={onOpenStory} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One Feed post (V8-R-FEED-001).
 *
 * "A card carries author, place, time, image, caption and tags, with exactly two
 * actions: View night and Reply."
 *
 * THE PHOTO KEEPS ITS SHAPE. The accessibility clause is explicit — "photos keep
 * their shape; there is no crop or aspect-ratio decision anywhere in the flow" —
 * so this renders the image at its natural ratio rather than inside the fixed
 * 4:5 frame the story rail uses.
 */
function FeedPostCard({
  post,
  viewerId,
  comments,
  authors,
  threadOpen,
  onToggleThread,
  onChanged,
}: {
  post: FeedPostView;
  viewerId: string | null;
  /** Null when this post's thread has not been read yet — see FeedComments. */
  comments: readonly FeedComment[] | null;
  authors: ReadonlyMap<string, FeedAuthor>;
  threadOpen: boolean;
  onToggleThread: () => void;
  onChanged: () => void;
}): JSX.Element {
  const bar = post.barId !== null ? getBarById(post.barId) : undefined;
  const author = post.author;
  const name = author === null
    ? 'Someone'
    : author.displayName ?? (author.handle !== null ? `@${author.handle}` : 'Someone');

  return (
    <article
      data-testid="feed-post"
      data-post={post.id}
      data-author={post.authorId}
      className="rounded-2xl border border-border bg-surface overflow-hidden"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar initials={initialsFor(name)} seed={post.authorId} size="sm" />
        <span className="min-w-0 flex-1">
          {author?.handle != null ? (
            <Link
              href={`/u/${author.handle}`}
              data-testid="feed-post-author"
              className="block text-sm truncate hover:text-accent transition-colors"
            >
              {name}
            </Link>
          ) : (
            <span data-testid="feed-post-author" className="block text-sm truncate">
              {name}
            </span>
          )}
          <span className="block text-[11px] text-muted truncate">
            {bar ? `${bar.name} · ${displayHood(bar.neighborhood)}` : 'A night out'}
          </span>
        </span>
        <span className="text-[11px] text-muted shrink-0">
          {ageLabel(post.createdAt)}
        </span>
      </div>

      {post.mediaState === 'ok' && post.mediaUrl !== null ? (
        // A short-lived server-signed URL is not a static asset, and next/image
        // would re-host it through the optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.mediaUrl}
          alt={post.caption ?? 'A photo from a night out'}
          data-testid="feed-post-photo"
          className="w-full h-auto"
        />
      ) : (
        // A signing failure is an OUTAGE, not an absent photo, and it says so
        // rather than rendering a decorative blank frame.
        <p
          data-testid="feed-post-photo-unavailable"
          className="px-4 py-6 text-center text-[11px] text-muted"
        >
          This photo could not be loaded.
        </p>
      )}

      <div className="px-4 py-3">
        {post.caption !== null ? (
          <p className="text-sm leading-relaxed">{post.caption}</p>
        ) : null}
        {post.tagIds.length > 0 ? (
          <p data-testid="feed-post-tags" className="text-[11px] text-muted mt-1">
            Tagged ·{' '}
            {post.tagIds
              .map((id) => authors.get(id)?.displayName ?? authors.get(id)?.handle ?? 'Someone')
              .join(', ')}
          </p>
        ) : null}
        {/* "NO TAGS" AND "WE COULD NOT READ THE TAGS" ARE DIFFERENT ANSWERS, and
            `FeedPostView.tagsComplete` exists precisely to keep them apart. It
            was never read here, so a failed `feed_post_tags` query rendered as a
            confidently untagged post — the tagged person losing their chip and
            the consent control behind it, with nothing on screen saying why. */}
        {!post.tagsComplete ? (
          <p
            data-testid="feed-post-tags-unavailable"
            role="status"
            className="text-[11px] text-muted mt-1"
          >
            Tags could not be loaded, so this post may have more.
          </p>
        ) : null}

        {/* EXACTLY TWO ACTIONS. "View night" is absent — not disabled — when
            there is no night, or when it is a night this viewer may not open;
            the server made that decision, not this component. */}
        <div className="flex items-center gap-3 mt-3">
          {post.nightShareToken !== null ? (
            <Link
              href={`/night-out/${post.nightShareToken}`}
              data-testid="feed-view-night"
              className="flex-1 min-h-[44px] flex items-center justify-center rounded-2xl border border-border text-xs font-display uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
            >
              View night
            </Link>
          ) : null}
          <button
            type="button"
            data-testid="feed-reply"
            aria-expanded={threadOpen}
            onClick={onToggleThread}
            className="flex-1 min-h-[44px] rounded-2xl border border-border text-xs font-display uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
          >
            Reply
          </button>
        </div>

        {threadOpen ? (
          <FeedComments
            postId={post.id}
            postAuthorId={post.authorId}
            viewerId={viewerId}
            comments={comments}
            authors={authors}
            onChanged={onChanged}
          />
        ) : null}
      </div>
    </article>
  );
}

function initialsFor(name: string): string {
  return name
    .replace(/^@/, '')
    .split(/[\s._-]+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * One STORY memory. WP1's card, unchanged.
 *
 * REPLY AND "VIEW NIGHT" ARE STILL ABSENT HERE, and that is not an oversight
 * this lane forgot to correct: a Story has no public comment thread (D-C-16),
 * and the demo share id "View night" once depended on is a token no real night
 * has. Both actions now exist on a FEED POST, where there is a real thread and a
 * real night behind them.
 */
function MemoryCard({
  entry,
  onOpenStory,
}: {
  entry: FeedEntry;
  onOpenStory: (authorId: string) => void;
}): JSX.Element {
  const { story, author } = entry;
  const bar = story.barId !== null ? getBarById(story.barId) : undefined;
  return (
    <article
      data-testid="feed-memory"
      data-author={author.id}
      className="rounded-2xl border border-border bg-surface overflow-hidden"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar initials={author.initials} seed={author.id} size="sm" />
        <span className="min-w-0 flex-1">
          {/* Your own row has no public profile handle, so it is not a link. */}
          {author.handle !== null ? (
            <Link
              href={`/u/${author.handle}`}
              data-testid="feed-author"
              className="block text-sm truncate hover:text-accent transition-colors"
            >
              {author.name}
            </Link>
          ) : (
            <span data-testid="feed-author" className="block text-sm truncate">
              {author.name}
            </span>
          )}
          <span className="block text-[11px] text-muted truncate">
            {bar ? `${bar.name} · ${displayHood(bar.neighborhood)}` : 'A night out'}
          </span>
        </span>
        <span className="text-[11px] text-muted shrink-0">
          {ageLabel(story.postedAt)}
        </span>
      </div>

      <StoryFrame
        photo={story.photo}
        barId={story.barId}
        className="aspect-[4/5]"
      />

      <div className="px-4 py-3">
        {story.caption !== null ? (
          <p className="text-sm leading-relaxed">{story.caption}</p>
        ) : null}
        {story.tagged.length > 0 ? (
          <p className="text-[11px] text-muted mt-1">
            Tagged · {story.tagged.map((person) => person.name).join(', ')}
          </p>
        ) : null}

        <div className="flex items-center gap-3 mt-3">
          <button
            type="button"
            data-testid="feed-open-story"
            onClick={() => onOpenStory(author.id)}
            className="flex-1 min-h-[44px] rounded-2xl border border-border text-xs font-display uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
          >
            Open story
          </button>
        </div>
      </div>
    </article>
  );
}
