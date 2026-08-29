'use client';

import Link from 'next/link';
import Avatar from '@/components/Avatar';
import StoryFrame from '@/components/story/StoryFrame';
import { ageLabel, type FeedEntry } from '@/components/story/storyStore';
import { getBarById } from '@/lib/catalog';
import { displayHood } from '@/lib/hoodDisplay';

/**
 * Social → Feed — the SAME real, unexpired 24-hour stories the rail shows,
 * as a chronological photo-first stream (V8 amendment, item 8).
 *
 * WHAT CHANGED FROM CYCLE 1, and why each removal is a removal of a lie:
 *
 *  - There is no separate Feed-memory backend and no seeded memory. Every card
 *    here is a real `public.stories` row the database decided this viewer may
 *    read. Permanent Feed history and the multi-night recap archive are V9.
 *  - The heading no longer says "Tonight & this week". Nothing here survives
 *    24 hours, so a week was never on offer.
 *  - REPLY IS GONE. It wrote to `localStorage` and nothing ever delivered it,
 *    which made a reply button a promise the product could not keep. It returns
 *    when there is real delivery plus a surface where the author can read it.
 *  - "View night" is gone with the demo share id it depended on. A seeded
 *    memory pointed at `demo-<handle>`, a token no real night ever has; the
 *    honest action on a story is to OPEN THE STORY, which is what the card
 *    does now.
 *  - No ranking row: nothing in this build derives one from real data.
 *
 * No public like counts and no follower metrics, unchanged from the locked
 * canvas.
 */
export default function FeedSection({
  entries,
  onOpenStory,
}: {
  entries: readonly FeedEntry[];
  /** Opens the story viewer on this author's queue. Keyed by profile id. */
  onOpenStory: (authorId: string) => void;
}): JSX.Element {
  /**
   * READY-AND-EMPTY LIVES HERE, not in the caller (round-10 directive (c)).
   * `page.tsx` used to mount this component only when `entries` was non-empty
   * and draw the empty copy itself, which made the Feed's own emptiness decide
   * whether the Feed rendered at all. A component that cannot be reached when
   * it has nothing to show also cannot be reached when it has something the
   * caller's emptiness test does not see, so the test moved inside.
   */
  if (entries.length === 0) {
    return (
      <section data-testid="feed-empty" aria-labelledby="feed-empty-heading">
        <h2
          id="feed-empty-heading"
          className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3"
        >
          Feed
        </h2>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm leading-relaxed">
            Nothing here yet. Stories from you and the friends who follow you
            back show up here for 24 hours.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="friends-feed" aria-labelledby="feed-heading">
      <h2
        id="feed-heading"
        className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3"
      >
        Tonight
      </h2>
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
