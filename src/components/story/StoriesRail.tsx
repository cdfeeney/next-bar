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
 *   "Pinned"   = shared bar presence tonight, as small text under the name (owner, 2026-09-17)
 * They differ in shape as well as colour, and each carries its own screen-
 * reader text, so neither is conveyed by colour alone.
 *
 * Target size: the visible plus badge is 18px. With no live story the whole
 * 56px cell IS the add target and the badge is only a mark on it; once you
 * have a story the plus becomes its own control, and then it carries its own
 * 44x44 hit area rather than borrowing the avatar's.
 */

export const RAIL_ADD_LABEL = 'Add to your story';

/**
 * Two sizes (Social redesign 2026-09-13, README §1.3 and §3): Tonight draws the
 * rail without a heading at 58px cells / 54px ring / 48px avatar, gap 14px;
 * Feed keeps the "STORIES" heading at 64px cells / 56px ring, gap 16px. Every
 * hit-test box stays 56px so the add-target geometry below is unchanged.
 */
export type RailSize = 'tonight' | 'feed';

export default function StoriesRail({
  groups,
  pinnedIds,
  pinnedBars,
  onOpen,
  onAddStory,
  size = 'feed',
}: {
  /** Rail order — your group first. This is also the story-queue order. */
  groups: readonly StoryGroup[];
  /**
   * PROFILE IDS that have pinned a spot tonight (server presence, not stories).
   * Ids, not handles: your own cell has no public handle, and matching it once
   * needed a placeholder constant on both sides.
   */
  pinnedIds: readonly string[];
  /** Profile id → the bar they pinned, when the catalog knows it (T-01e). */
  pinnedBars?: ReadonlyMap<string, string>;
  onOpen: (authorId: string) => void;
  onAddStory: () => void;
  size?: RailSize;
}): JSX.Element {
  // "at <Bar>" when the catalog resolves the pin; "Pinned" is the honest
  // fallback for an id the local catalog does not know.
  const pinText = (id: string): string => {
    const bar = pinnedBars?.get(id);
    return bar ? `at ${bar}` : 'Pinned';
  };
  const you = groups.find((group) => group.isYou);
  const friends = groups.filter((group) => !group.isYou && group.items.length > 0);

  return (
    <section
      aria-label={size === 'tonight' ? 'Stories' : undefined}
      aria-labelledby={size === 'feed' ? 'stories-heading' : undefined}
      data-testid="stories-rail"
      data-size={size}
    >
      {size === 'feed' ? (
        <h2
          id="stories-heading"
          className="font-label text-xs uppercase tracking-[0.25em] text-muted mb-3"
        >
          Stories
        </h2>
      ) : null}
      {/* data-carousel: the rail is the deliberate sideways strip the native
          interaction contract allows, and it must announce itself rather than
          read as an accidental horizontal scroller (native-shell-contract).
          The other half of that contract — operable WITHOUT swiping — is met
          by construction here: every cell is a focusable button, so Tab walks
          the rail and the browser scrolls each cell into view. */}
      <ul
        data-carousel
        // pt-1 IS LOAD-BEARING, not symmetry for its own sake. An active ring
        // is `ring-2 ring-offset-2`, i.e. 4px painted OUTSIDE the avatar's box
        // on every side, and `overflow-x-auto` makes this a scroll container on
        // BOTH axes — so it clips top and bottom too. With `pb-1` alone the
        // bottom 4px survived and the top 4px was cut, which is the cropped
        // circle the operator reported. Overflow clips at the padding box, so
        // the padding is the room the stroke paints into.
        className={[
          'flex overflow-x-auto pt-1 pb-1 -mx-6 px-6',
          size === 'tonight' ? 'gap-3.5' : 'gap-4',
        ].join(' ')}
      >
        {you ? (
          <YourCell
            group={you}
            pinned={pinnedIds.includes(you.id)}
            pinLabel={pinText(you.id)}
            onOpen={() => onOpen(you.id)}
            onAddStory={onAddStory}
            size={size}
          />
        ) : null}
        {friends.map((group) => (
          <FriendCell
            key={group.id}
            group={group}
            pinned={pinnedIds.includes(group.id)}
            pinLabel={pinText(group.id)}
            onOpen={() => onOpen(group.id)}
            size={size}
          />
        ))}
      </ul>
    </section>
  );
}

function Cell({
  children,
  label,
  pinned = false,
  pinLabel = 'Pinned',
  wide = false,
  size,
}: {
  children: React.ReactNode;
  label: string;
  /** Shared bar presence tonight: a second small line under the name. */
  pinned?: boolean;
  /** "at <Bar>" (owner, 2026-09-20) or "Pinned" when the bar is unknown. */
  pinLabel?: string;
  /** Your cell once a story exists: it carries a second 44px target beside the
      avatar, so it needs the room. The label stays centred on the AVATAR
      rather than on the widened cell. */
  wide?: boolean;
  size: RailSize;
}): JSX.Element {
  return (
    <li
      className={`shrink-0 flex flex-col gap-1.5 ${
        wide
          ? 'w-[6.25rem] items-start'
          : size === 'tonight'
            ? 'w-[58px] items-center'
            : 'w-16 items-center'
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
      {pinned ? (
        <span
          data-testid="story-pin-badge"
          className={`text-[10px] text-muted leading-none -mt-1 max-w-full truncate ${wide ? 'w-14 text-center' : ''}`}
        >
          {pinLabel}<span className="sr-only"> — pinned a spot tonight</span>
        </span>
      ) : null}
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
  pinLabel,
  onOpen,
  onAddStory,
  size,
}: {
  group: StoryGroup;
  pinned: boolean;
  pinLabel: string;
  onOpen: () => void;
  onAddStory: () => void;
  size: RailSize;
}): JSX.Element {
  const hasStory = group.items.length > 0;
  return (
    <Cell label="You" pinned={pinned} pinLabel={pinLabel} wide={hasStory} size={size}>
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
          thing, which is what the first attempt at this still had.

          NEITHER BUTTON IS ROUNDED-FULL, and that is a hit-test decision,
          not a visual one: both paint nothing, the visible circle is the Ring
          inside, and a circular hit area on a square box excludes its own
          corners — which is exactly where a badge sits. That cost the operator
          a working add control twice over, once per branch. */}
      <span
        data-testid="story-rail-you"
        className={`relative block h-14 ${hasStory ? 'w-[6.25rem]' : 'w-14'}`}
      >
        {/* The avatar keeps its own 56px positioning box inside the widened
            cell. */}
        <span className="absolute left-0 top-0 block w-14 h-14">
          <button
            type="button"
            data-testid={hasStory ? 'story-rail-your-story' : 'add-story'}
            onClick={hasStory ? onOpen : onAddStory}
            className="block w-14 h-14 touch-manipulation"
            aria-label={hasStory ? 'Your story' : RAIL_ADD_LABEL}
          >
            <Ring active={hasStory} size={size}>
              <Avatar initials={group.initials} seed={group.id} size="md" />
            </Ring>
          </button>
        </span>
        {hasStory ? (
          // 44x44 starting at x=56 — the avatar's right edge — and inside the
          // cell's own 56px height, so the rail's horizontal scroller never
          // clips it. The mark is drawn INSIDE this box, so the target and the
          // thing the user aims at are the same object.
          <button
            type="button"
            data-testid="add-story"
            onClick={onAddStory}
            aria-label={RAIL_ADD_LABEL}
            // NOT `rounded-full`. A circular hit area on a 44x44 box excludes
            // its own corners, and the mark sits in the bottom-left one — so
            // the badge was inside the button's BOX and outside its hit
            // region, and a tap on it fell through to the wrapper. Measured:
            // badge at (80,252), circle centre (102,248) r=22, distance 23.9.
            // The button paints nothing, so squaring it changes no pixel and
            // makes the whole 44x44 target real.
            className="absolute left-14 top-3 w-11 h-11 flex items-end justify-start touch-manipulation"
          >
            {/* THE MARK SITS INSIDE ITS OWN BUTTON. It used to be pulled 8px
                back over the avatar's lower-right corner, on the reasoning
                that the mark is decoration and the 44x44 box beside it is the
                target — which fixed the mark STEALING taps by making the thing
                you see and the thing you hit two different objects. That is
                the same bug pointing the other way, and the operator hit it:
                "I click the button and it doesn't let me post", because a tap
                aimed at the badge landed on the avatar and opened their story.
                No overhang, so every pixel of the mark adds and every pixel of
                the avatar opens. pointer-events-none stays: the mark is inside
                the button either way, and it keeps the button the single
                hit-testable object. */}
            <span className="flex pointer-events-none">
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
  pinLabel,
  onOpen,
  size,
}: {
  group: StoryGroup;
  pinned: boolean;
  pinLabel: string;
  onOpen: () => void;
  size: RailSize;
}): JSX.Element {
  return (
    <Cell label={group.name.split(/\s+/)[0]} pinned={pinned} pinLabel={pinLabel} size={size}>
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
          <Ring active={group.hasUnseen} size={size}>
            <Avatar initials={group.initials} seed={group.id} size="md" />
          </Ring>
        </button>
      </span>
    </Cell>
  );
}

/**
 * The unseen ring. Absent, not merely dimmer, once the story is watched.
 * Tonight paints it as a 54px 2px stroke inside the 56px box (README §1.3);
 * Feed keeps the outset ring around the 56px box.
 */
function Ring({
  active,
  size,
  children,
}: {
  active: boolean;
  size: RailSize;
  children: React.ReactNode;
}): JSX.Element {
  if (size === 'tonight') {
    return (
      <span
        data-testid="story-ring"
        data-active={active ? 'true' : 'false'}
        className={[
          'm-px w-[54px] h-[54px] rounded-full border-2 flex items-center justify-center',
          active ? 'border-accent' : 'border-transparent',
        ].join(' ')}
      >
        {children}
      </span>
    );
  }
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

