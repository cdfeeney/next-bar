'use client';

import { useState } from 'react';
import Link from 'next/link';
import Avatar from '@/components/Avatar';
import StoryFrame from '@/components/story/StoryFrame';
import { ageLabel, type FeedEntry, type FeedMemory, type FeedRankingEvent } from '@/components/story/storyStore';
import { getBarById } from '@/lib/catalog';
import { displayHood } from '@/lib/hoodDisplay';

/**
 * Social → Feed, per `next-bar-social-v2-core.png` (screen C, "photo-first").
 *
 * "Feed = photo memories. A familiar photo-post hierarchy — author, place,
 * time, image, caption, tags, actions — without borrowing another app's
 * identity. NO PUBLIC LIKE COUNTS and no follower metrics: the two actions
 * are View night and Reply."
 *
 * A ranking event appears as a compact secondary row and never competes with
 * a photo — it carries no image and sits between cards, not inside one.
 *
 * There is no aspect-ratio or crop step anywhere in this flow, so the photo
 * area keeps the shape the capture produced.
 */
export default function FeedSection({
  entries,
  onReply,
}: {
  entries: readonly FeedEntry[];
  onReply: (memoryId: string, text: string) => void;
}): JSX.Element {
  return (
    <section data-testid="friends-feed" aria-labelledby="feed-heading">
      <h2
        id="feed-heading"
        className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3"
      >
        Tonight &amp; this week
      </h2>
      <ul className="space-y-4">
        {entries.map((entry) =>
          entry.kind === 'memory' ? (
            <li key={entry.memory.id}>
              <MemoryCard memory={entry.memory} onReply={onReply} />
            </li>
          ) : (
            <li key={entry.event.id}>
              <RankingRow event={entry.event} />
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function MemoryCard({
  memory,
  onReply,
}: {
  memory: FeedMemory;
  onReply: (memoryId: string, text: string) => void;
}): JSX.Element {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const bar = memory.barId !== null ? getBarById(memory.barId) : undefined;

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed === '') return;
    onReply(memory.id, trimmed);
    setText('');
    setReplying(false);
  };

  return (
    <article
      data-testid="feed-memory"
      className="rounded-2xl border border-border bg-surface overflow-hidden"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar initials={memory.initials} seed={memory.handle} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm truncate">{memory.name}</span>
          <span className="block text-[11px] text-muted truncate">
            {bar ? `${bar.name} · ${displayHood(bar.neighborhood)}` : 'A night out'}
          </span>
        </span>
        <span className="text-[11px] text-muted shrink-0">
          {ageLabel(memory.postedAt)}
        </span>
      </div>

      <StoryFrame
        photo={{ kind: 'single', main: null }}
        barId={memory.barId}
        className="aspect-[4/5]"
      />

      <div className="px-4 py-3">
        <p className="text-sm leading-relaxed">{memory.caption}</p>
        {memory.tagged.length > 0 ? (
          <p className="text-[11px] text-muted mt-1">
            Tagged · {memory.tagged.map((person) => person.name).join(', ')}
          </p>
        ) : null}

        <div className="flex items-center gap-3 mt-3">
          <Link
            href={`/u/${memory.handle}/night/${memory.shareId}`}
            data-testid="feed-view-night"
            className="flex-1 min-h-[44px] flex items-center justify-center rounded-2xl border border-border text-xs font-display uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
          >
            View night
          </Link>
          <button
            type="button"
            data-testid="feed-reply"
            aria-expanded={replying}
            onClick={() => setReplying((open) => !open)}
            className="flex-1 min-h-[44px] rounded-2xl border border-border text-xs font-display uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
          >
            Reply
          </button>
        </div>

        {replying ? (
          <form onSubmit={submit} className="flex items-center gap-2 mt-3">
            <input
              data-testid="feed-reply-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-label={`Reply to ${memory.name}`}
              placeholder={`Reply to ${memory.name.split(/\s+/)[0]}…`}
              className="flex-1 min-h-[44px] rounded-2xl border border-border bg-bg px-4 text-sm outline-none focus:border-accent"
            />
            <button
              type="submit"
              data-testid="feed-reply-send"
              aria-label="Send reply"
              className="w-11 h-11 shrink-0 rounded-full border border-border flex items-center justify-center touch-manipulation hover:border-accent transition-colors"
            >
              ↑
            </button>
          </form>
        ) : null}
      </div>
    </article>
  );
}

/** The compact secondary row. No photo, no actions — it cannot compete. */
function RankingRow({ event }: { event: FeedRankingEvent }): JSX.Element {
  const bar = getBarById(event.barId);
  if (!bar) return <></>;
  return (
    <div
      data-testid="feed-ranking-row"
      className="flex items-center gap-3 rounded-2xl border border-border px-4 min-h-[56px]"
    >
      <Avatar initials={event.initials} seed={event.handle} size="sm" />
      <span className="min-w-0 flex-1 text-sm truncate">
        {event.name.split(/\s+/)[0]} ranked{' '}
        <span className="text-text">{bar.name}</span>{' '}
        <span className="tabular-nums">{event.score.toFixed(1)}</span>
      </span>
      <span className="text-[11px] text-muted shrink-0">
        {ageLabel(event.at)}
      </span>
    </div>
  );
}
