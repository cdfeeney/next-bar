'use client';

import Avatar from '@/components/Avatar';
import type { StoryGroup } from './storyStore';

/**
 * The STORIES rail, across the top of Social · Tonight and again on Feed
 * (`next-bar-social-v2-core.png`). Your own avatar leads and carries the
 * small accent plus that opens Add to Story (`next-bar-add-story-flow.png`,
 * screen 1).
 *
 * TWO SIGNALS, NEVER MERGED — the rule both canvases state in the same words:
 *   ring       = an unseen story (a circular stroke around the avatar)
 *   pin badge  = shared bar presence tonight (a SQUARED map-pin mark)
 * They differ in shape as well as colour, and each carries its own screen-
 * reader text, so neither is conveyed by colour alone.
 *
 * Target size: the visible plus badge is 18px, but the own-avatar cell and
 * its overhanging badge resolve as one target well past 44x44 — the cell is
 * 56px and the badge hangs off its lower-right corner.
 */

export const RAIL_ADD_LABEL = 'Add to your story';

export default function StoriesRail({
  groups,
  pinnedHandles,
  onOpen,
  onAddStory,
}: {
  /** Rail order — your group first. This is also the story-queue order. */
  groups: readonly StoryGroup[];
  /** Handles that have pinned a spot tonight (server presence, not stories). */
  pinnedHandles: readonly string[];
  onOpen: (handle: string) => void;
  onAddStory: () => void;
}): JSX.Element {
  const you = groups.find((group) => group.isYou);
  const friends = groups.filter((group) => !group.isYou && group.items.length > 0);

  return (
    <section aria-labelledby="stories-heading" data-testid="stories-rail">
      <h2
        id="stories-heading"
        className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3"
      >
        Stories
      </h2>
      <ul className="flex gap-4 overflow-x-auto pb-1 -mx-6 px-6">
        {you ? (
          <YourCell
            group={you}
            pinned={pinnedHandles.includes(you.handle)}
            onOpen={() => onOpen(you.handle)}
            onAddStory={onAddStory}
          />
        ) : null}
        {friends.map((group) => (
          <FriendCell
            key={group.handle}
            group={group}
            pinned={pinnedHandles.includes(group.handle)}
            onOpen={() => onOpen(group.handle)}
          />
        ))}
      </ul>
    </section>
  );
}

function Cell({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}): JSX.Element {
  return (
    <li className="shrink-0 w-16 flex flex-col items-center gap-1.5">
      {children}
      <span className="text-[11px] text-muted truncate max-w-full">{label}</span>
    </li>
  );
}

/**
 * Your cell. With no live story the whole 56px avatar opens Add to Story, so
 * the only affordance present is a full-size target; with a live story the
 * avatar body opens your story and the plus adds another to it — "adding is
 * never hidden behind viewing".
 */
function YourCell({
  group,
  pinned,
  onOpen,
  onAddStory,
}: {
  group: StoryGroup;
  pinned: boolean;
  onOpen: () => void;
  onAddStory: () => void;
}): JSX.Element {
  const hasStory = group.items.length > 0;
  return (
    <Cell label="You">
      <span data-testid="story-rail-you" className="relative block w-14 h-14">
        <button
          type="button"
          data-testid={hasStory ? 'story-rail-your-story' : 'add-story'}
          onClick={hasStory ? onOpen : onAddStory}
          className="block w-14 h-14 rounded-full touch-manipulation"
          aria-label={hasStory ? 'Your story' : RAIL_ADD_LABEL}
        >
          <Ring active={hasStory}>
            <Avatar initials={group.initials} seed={group.handle} size="md" />
          </Ring>
        </button>
        {hasStory ? (
          <button
            type="button"
            data-testid="add-story"
            onClick={onAddStory}
            aria-label={RAIL_ADD_LABEL}
            className="absolute -bottom-1 -right-1 w-7 h-7 flex items-center justify-center rounded-full touch-manipulation"
          >
            <PlusBadge />
          </button>
        ) : (
          <span className="absolute -bottom-1 -right-1 w-7 h-7 flex items-center justify-center pointer-events-none">
            <PlusBadge />
          </span>
        )}
        {pinned ? <PinBadge /> : null}
      </span>
    </Cell>
  );
}

function FriendCell({
  group,
  pinned,
  onOpen,
}: {
  group: StoryGroup;
  pinned: boolean;
  onOpen: () => void;
}): JSX.Element {
  return (
    <Cell label={group.name.split(/\s+/)[0]}>
      <span className="relative block w-14 h-14">
        <button
          type="button"
          data-testid="story-rail-item"
          data-handle={group.handle}
          data-unseen={group.hasUnseen ? 'true' : 'false'}
          onClick={onOpen}
          className="block w-14 h-14 rounded-full touch-manipulation"
          aria-label={
            group.hasUnseen
              ? `${group.name} — unseen story`
              : `${group.name} — story, already seen`
          }
        >
          <Ring active={group.hasUnseen}>
            <Avatar initials={group.initials} seed={group.handle} size="md" />
          </Ring>
        </button>
        {pinned ? <PinBadge /> : null}
      </span>
    </Cell>
  );
}

/** The unseen ring. Absent, not merely dimmer, once the story is watched. */
function Ring({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <span
      data-testid="story-ring"
      data-active={active ? 'true' : 'false'}
      className={[
        'w-14 h-14 rounded-full flex items-center justify-center',
        active ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg' : '',
      ].join(' ')}
    >
      {children}
    </span>
  );
}

/** 18px visible badge; its target is the 28px button that wraps it. */
function PlusBadge(): JSX.Element {
  return (
    <span
      data-testid="add-story-badge"
      aria-hidden="true"
      className="w-[18px] h-[18px] rounded-full bg-accent text-bg border-2 border-bg flex items-center justify-center text-[11px] leading-none font-display"
    >
      +
    </span>
  );
}

/**
 * Shared bar presence. SQUARED, not circular, and it sits top-right — the
 * opposite corner from the plus — so the two marks can never be read as one
 * affordance.
 */
function PinBadge(): JSX.Element {
  return (
    <span
      data-testid="story-pin-badge"
      className="absolute -top-0.5 -right-0.5 w-[14px] h-[14px] rounded-[3px] bg-accent border-2 border-bg"
    >
      <span className="sr-only">Pinned a spot tonight</span>
    </span>
  );
}
