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
 * Target size: the visible plus badge is 18px. With no live story the whole
 * 56px cell IS the add target and the badge is only a mark on it; once you
 * have a story the plus becomes its own control, and then it carries its own
 * 44x44 hit area rather than borrowing the avatar's.
 */

export const RAIL_ADD_LABEL = 'Add to your story';

export default function StoriesRail({
  groups,
  pinnedIds,
  onOpen,
  onAddStory,
}: {
  /** Rail order — your group first. This is also the story-queue order. */
  groups: readonly StoryGroup[];
  /**
   * PROFILE IDS that have pinned a spot tonight (server presence, not stories).
   * Ids, not handles: your own cell has no public handle, and matching it once
   * needed a placeholder constant on both sides.
   */
  pinnedIds: readonly string[];
  onOpen: (authorId: string) => void;
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
      {/* data-carousel: the rail is the deliberate sideways strip the native
          interaction contract allows, and it must announce itself rather than
          read as an accidental horizontal scroller (native-shell-contract).
          The other half of that contract — operable WITHOUT swiping — is met
          by construction here: every cell is a focusable button, so Tab walks
          the rail and the browser scrolls each cell into view. */}
      <ul
        data-carousel
        className="flex gap-4 overflow-x-auto pb-1 -mx-6 px-6"
      >
        {you ? (
          <YourCell
            group={you}
            pinned={pinnedIds.includes(you.id)}
            onOpen={() => onOpen(you.id)}
            onAddStory={onAddStory}
          />
        ) : null}
        {friends.map((group) => (
          <FriendCell
            key={group.id}
            group={group}
            pinned={pinnedIds.includes(group.id)}
            onOpen={() => onOpen(group.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function Cell({
  children,
  label,
  wide = false,
}: {
  children: React.ReactNode;
  label: string;
  /** Your cell once a story exists: it carries a second 44px target beside the
      avatar, so it needs the room. The label stays centred on the AVATAR
      rather than on the widened cell. */
  wide?: boolean;
}): JSX.Element {
  return (
    <li
      className={`shrink-0 flex flex-col gap-1.5 ${
        wide ? 'w-[100px] items-start' : 'w-16 items-center'
      }`}
    >
      {children}
      <span
        className={`text-[11px] text-muted truncate ${
          wide ? 'w-14 text-center' : 'max-w-full'
        }`}
      >
        {label}
      </span>
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
    <Cell label="You" wide={hasStory}>
      {/* Two 44px targets cannot both fit on one 56px avatar. The original
          shape put the add button at `left-3 top-3 w-11 h-11`, i.e. over
          (12,12)-(56,56) of the 56px cell — which contains the avatar's own
          centre (28,28), so tapping the middle of your ringed avatar opened
          CAPTURE and the view control was reduced to a 12px L-strip.
          The cell is widened instead once a story exists, and the add target
          begins exactly at the avatar's RIGHT EDGE (x=56): the two controls do
          not overlap at all, so every point of the avatar opens your story and
          every point of the plus adds to it. Anything less than full
          separation leaves a strip of the avatar that silently does the other
          thing, which is what the first attempt at this still had. Only the
          18px MARK is pulled back over the avatar's corner, by a negative
          margin, so the badge keeps the position the reference draws it in
          without extending the button's box. */}
      <span
        data-testid="story-rail-you"
        className={`relative block h-14 ${hasStory ? 'w-[100px]' : 'w-14'}`}
      >
        {/* The avatar keeps its own 56px positioning box so the pin badge
            stays anchored to the avatar's corner rather than to the widened
            cell. */}
        <span className="absolute left-0 top-0 block w-14 h-14">
          <button
            type="button"
            data-testid={hasStory ? 'story-rail-your-story' : 'add-story'}
            onClick={hasStory ? onOpen : onAddStory}
            className="block w-14 h-14 rounded-full touch-manipulation"
            aria-label={hasStory ? 'Your story' : RAIL_ADD_LABEL}
          >
            <Ring active={hasStory}>
              <Avatar initials={group.initials} seed={group.id} size="md" />
            </Ring>
          </button>
          {pinned ? <PinBadge /> : null}
        </span>
        {hasStory ? (
          // 44x44 starting at x=56 — the avatar's right edge — and inside the
          // cell's own 56px height, so the rail's horizontal scroller never
          // clips it. `-ml-2` pulls only the 18px mark back over the avatar's
          // lower-right corner; the button's own box stays clear of it.
          <button
            type="button"
            data-testid="add-story"
            onClick={onAddStory}
            aria-label={RAIL_ADD_LABEL}
            className="absolute left-14 top-3 w-11 h-11 flex items-end justify-start rounded-full touch-manipulation"
          >
            <span className="-ml-2 flex">
              <PlusBadge />
            </span>
          </button>
        ) : (
          <span className="absolute -bottom-1 -right-1 w-7 h-7 flex items-center justify-center pointer-events-none">
            <PlusBadge />
          </span>
        )}
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
          data-author={group.id}
          data-handle={group.handle ?? ''}
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
            <Avatar initials={group.initials} seed={group.id} size="md" />
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

/** The 18px visible mark. Its TARGET is the 44x44 button that wraps it. */
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
      // pointer-events-none, like the decorative plus wrapper above: this is a
      // STATUS mark, not a control, and as a positioned sibling over the
      // avatar button it was swallowing taps on its own 14px corner — a dead
      // region on the story-open target wherever a pin renders.
      className="pointer-events-none absolute -top-0.5 -right-0.5 w-[14px] h-[14px] rounded-[3px] bg-accent border-2 border-bg"
    >
      <span className="sr-only">Pinned a spot tonight</span>
    </span>
  );
}
