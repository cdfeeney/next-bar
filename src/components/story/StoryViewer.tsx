'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useModalDialog } from '@/hooks/useModalDialog';
import Avatar from '@/components/Avatar';
import { lockBodyScroll } from '@/lib/bodyScrollLock';
import { getBarById } from '@/lib/catalog';
import { displayHood } from '@/lib/hoodDisplay';
import BarLightbox from '@/components/BarLightbox';
import StoryFrame from './StoryFrame';
import TaggedPeopleSheet from './TaggedPeopleSheet';
import { ageLabel, taggedLabel, type StoryGroup } from './storyStore';

/**
 * The story viewer and the story QUEUE — Option A, the top metadata strip,
 * per `next-bar-story-tag-placement.png`. Placement is settled there and is
 * not reopened here: the venue chip and the people chip sit in one strip
 * directly under the author row, below the status area and above the image,
 * so nothing is ever drawn across a face and the metadata never enters the
 * system status area.
 *
 * Queue behaviour, locked by the same canvas:
 *  - progress segments EQUAL the current person's item count; there is no
 *    fixed 4- or 5-segment chrome;
 *  - items advance automatically, and the left/right tap zones still step
 *    backward and forward by hand at any moment;
 *  - after the final item the viewer opens the next person who has a story,
 *    in story-rail order, with no interstitial and no confirmation;
 *  - when the queue is exhausted the viewer closes and returns to
 *    Social · Tonight — there is no "all caught up" screen;
 *  - ✕ closes early and returns to the surface it was opened from.
 *
 * Automatic progression PAUSES on long-press, while a reply is being
 * composed, while the tagged-people sheet is open, and whenever keyboard or
 * assistive focus is on the chrome. It resumes only when that ends.
 */

/** How long one item holds the screen. */
const ITEM_DURATION_MS = 5_000;
/** Progress resolution. Coarse on purpose — this is a bar, not an animation. */
const TICK_MS = 100;
/** Press-and-hold threshold before a tap becomes a pause. */
const LONG_PRESS_MS = 350;

/**
 * Overlay stacking: the bottom nav is `z-[1000]`, so every full-screen
 * surface in this lane sits at `z-[1100]` — the same rung PairwiseSheet,
 * QuickAddBar and SuggestBarDialog already use. Below it the nav sits ON TOP
 * of the overlay and swallows taps on the controls in the bottom strip.
 */

export default function StoryViewer({
  groups,
  startHandle,
  youHandle,
  onClose,
  onExhausted,
  onMarkSeen,
  onUntagMe,
  onReply,
}: {
  /** Rail order, already filtered to groups that have at least one item. */
  groups: readonly StoryGroup[];
  startHandle: string;
  youHandle: string;
  /** ✕ or Escape — the caller leaves the sub-tab where it was. */
  onClose: () => void;
  /** Queue ran out — the caller lands on Social · Tonight. */
  onExhausted: () => void;
  onMarkSeen: (itemId: string) => void;
  onUntagMe: (itemId: string) => void;
  onReply: (itemId: string, text: string) => void;
}): JSX.Element | null {
  const startIndex = Math.max(
    0,
    groups.findIndex((group) => group.handle === startHandle),
  );
  const [position, setPosition] = useState({ group: startIndex, item: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [held, setHeld] = useState(false);
  const [chromeFocused, setChromeFocused] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [replyFocused, setReplyFocused] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [venueOpen, setVenueOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyRef = useRef<HTMLInputElement | null>(null);
  // Escape and the Tab cycle, off while a sheet or the venue lightbox is open
  // above this dialog — each installs its own trap, and two armed at once
  // fight over focus.
  const dialogRef = useModalDialog<HTMLDivElement>(
    onClose,
    !sheetOpen && !venueOpen,
  );

  const group = groups[position.group];
  const item = group?.items[position.item];

  const paused =
    held ||
    sheetOpen ||
    venueOpen ||
    replyFocused ||
    reply.length > 0 ||
    chromeFocused;

  const advance = useCallback(() => {
    setElapsed(0);
    setPosition((current) => {
      const currentGroup = groups[current.group];
      if (currentGroup && current.item + 1 < currentGroup.items.length) {
        return { group: current.group, item: current.item + 1 };
      }
      // Person-to-person handoff: author, avatar, chips and progress all
      // change together, in rail order, with nothing in between.
      if (current.group + 1 < groups.length) {
        return { group: current.group + 1, item: 0 };
      }
      return current;
    });
  }, [groups]);

  const atEnd =
    group !== undefined &&
    position.group === groups.length - 1 &&
    position.item === group.items.length - 1;

  const back = useCallback(() => {
    setElapsed(0);
    setPosition((current) => {
      if (current.item > 0) return { group: current.group, item: current.item - 1 };
      if (current.group === 0) return current;
      const previous = groups[current.group - 1];
      return {
        group: current.group - 1,
        item: Math.max(0, previous.items.length - 1),
      };
    });
  }, [groups]);

  // Scroll lock. Focus entry, the Tab cycle and focus restore are the shared
  // modal contract and live in useModalDialog above.
  useEffect(() => lockBodyScroll(), []);

  useEffect(() => {
    if (item === undefined) return;
    onMarkSeen(item.id);
  }, [item, onMarkSeen]);

  // The clock. Ticking is the ONLY thing pausing suspends — nothing else in
  // the viewer depends on it, so a pause cannot strand the surface.
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => setElapsed((ms) => ms + TICK_MS), TICK_MS);
    return () => clearInterval(timer);
  }, [paused, position.group, position.item]);

  useEffect(() => {
    if (elapsed < ITEM_DURATION_MS) return;
    if (atEnd) {
      onExhausted();
      return;
    }
    advance();
  }, [elapsed, atEnd, advance, onExhausted]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (sheetOpen || venueOpen) return;
      // Arrows are QUEUE navigation, so they must not fire while the caret is
      // in the reply field: ArrowLeft to fix a typo used to step the queue
      // underneath a half-typed reply, which then submitted against whichever
      // item had taken the screen.
      if (event.target === replyRef.current) return;
      if (event.key === 'ArrowRight') {
        if (atEnd) onExhausted();
        else advance();
      }
      if (event.key === 'ArrowLeft') back();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sheetOpen, venueOpen, onExhausted, advance, back, atEnd]);

  if (group === undefined || item === undefined) return null;

  const bar = item.barId !== null ? getBarById(item.barId) : undefined;
  const people = taggedLabel(item.tagged);
  const youAreTagged = item.tagged.some(
    (person) => person.isYou === true || person.handle === youHandle,
  );

  const startPress = (): void => {
    pressTimer.current = setTimeout(() => setHeld(true), LONG_PRESS_MS);
  };
  const endPress = (onTap: () => void): void => {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    if (held) {
      setHeld(false);
      return;
    }
    onTap();
  };

  const submitReply = (event: React.FormEvent): void => {
    event.preventDefault();
    const text = reply.trim();
    if (text === '') return;
    onReply(item.id, text);
    setReply('');
    setSent(group.name.split(/\s+/)[0]);
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${group.name} — story`}
      data-testid="story-viewer"
      data-paused={paused ? 'true' : 'false'}
      tabIndex={-1}
      className="fixed inset-0 z-[1100] bg-bg flex flex-col"
    >
      {/* Top chrome: progress, author, then the metadata strip. Nothing above
          it but the safe area — metadata never enters the status area. */}
      <div
        className="px-4 pt-[env(safe-area-inset-top)] shrink-0"
        onFocus={() => setChromeFocused(true)}
        onBlur={() => setChromeFocused(false)}
      >
        <ProgressStrip count={group.items.length} index={position.item} elapsed={elapsed} />

        <div className="flex items-center gap-3 mt-3">
          <Avatar initials={group.initials} seed={group.handle} size="sm" />
          <span className="min-w-0 flex-1 text-sm truncate">
            {group.name}
            <span className="text-muted"> · {ageLabel(item.postedAt)}</span>
          </span>
          <button
            type="button"
            data-testid="story-close"
            onClick={onClose}
            aria-label="Close story"
            className="w-11 h-11 -mr-2 flex items-center justify-center rounded-full text-muted touch-manipulation"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {bar ? (
            <button
              type="button"
              data-testid="story-venue-chip"
              onClick={() => setVenueOpen(true)}
              className="inline-flex items-center gap-2 min-h-[44px] px-3 rounded-2xl border border-border bg-surface text-xs touch-manipulation hover:border-accent transition-colors"
            >
              <span
                aria-hidden="true"
                className="w-[10px] h-[10px] rounded-[3px] bg-accent"
              />
              {bar.name}
              <span className="text-muted">· {displayHood(bar.neighborhood)}</span>
            </button>
          ) : null}
          {people !== null ? (
            <button
              type="button"
              data-testid="story-people-chip"
              onClick={() => setSheetOpen(true)}
              className="inline-flex items-center gap-2 min-h-[44px] px-3 rounded-2xl border border-border bg-surface text-xs touch-manipulation hover:border-accent transition-colors"
            >
              {people}
            </button>
          ) : null}
        </div>
      </div>

      {/* The photo, and the two tap zones over it. */}
      <div className="relative flex-1 mt-3">
        <StoryFrame
          photo={item.photo}
          barId={item.barId}
          className="absolute inset-0"
          insetClassName="w-28"
        />
        <button
          type="button"
          data-testid="story-back-zone"
          aria-label="Previous story item"
          onPointerDown={startPress}
          onPointerUp={() => endPress(back)}
          onPointerCancel={() => endPress(() => undefined)}
          className="absolute left-0 top-0 bottom-0 w-1/3"
        />
        <button
          type="button"
          data-testid="story-forward-zone"
          aria-label="Next story item"
          onPointerDown={startPress}
          onPointerUp={() => endPress(atEnd ? onExhausted : advance)}
          onPointerCancel={() => endPress(() => undefined)}
          className="absolute right-0 top-0 bottom-0 w-2/3"
        />
      </div>

      <form
        onSubmit={submitReply}
        className="shrink-0 flex items-center gap-2 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]"
        onFocus={() => setChromeFocused(true)}
        onBlur={() => setChromeFocused(false)}
      >
        <input
          ref={replyRef}
          data-testid="story-reply-input"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          onFocus={() => setReplyFocused(true)}
          onBlur={() => setReplyFocused(false)}
          aria-label={`Reply to ${group.name}`}
          placeholder={`Reply to ${group.name.split(/\s+/)[0]}…`}
          className="flex-1 min-h-[44px] rounded-2xl border border-border bg-surface px-4 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          data-testid="story-reply-send"
          aria-label="Send reply"
          className="w-11 h-11 shrink-0 rounded-full border border-border flex items-center justify-center touch-manipulation hover:border-accent transition-colors"
        >
          ↑
        </button>
      </form>
      {sent !== null ? (
        <p role="status" className="sr-only">
          Reply sent to {sent}
        </p>
      ) : null}

      {venueOpen && bar ? (
        <BarLightbox bar={bar} onClose={() => setVenueOpen(false)} />
      ) : null}

      {sheetOpen ? (
        <TaggedPeopleSheet
          people={item.tagged.map((person) =>
            person.handle === youHandle ? { ...person, isYou: true } : person,
          )}
          posterName={group.name}
          onRemoveMe={
            youAreTagged
              ? () => {
                  onUntagMe(item.id);
                  setSheetOpen(false);
                }
              : null
          }
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * One segment per item of the CURRENT person's story. The count is data, so
 * a handoff visibly re-draws the strip.
 */
function ProgressStrip({
  count,
  index,
  elapsed,
}: {
  count: number;
  index: number;
  elapsed: number;
}): JSX.Element {
  return (
    <div
      className="flex gap-1 pt-2"
      data-testid="story-progress"
      data-segments={count}
      role="group"
      aria-label={`Item ${index + 1} of ${count}`}
    >
      {Array.from({ length: count }, (_unused, i) => (
        <span
          key={i}
          data-testid="story-progress-segment"
          className="h-[3px] flex-1 rounded-full bg-border overflow-hidden"
        >
          <span
            className="block h-full bg-text"
            style={{
              width:
                i < index
                  ? '100%'
                  : i > index
                    ? '0%'
                    : `${Math.min(100, (elapsed / ITEM_DURATION_MS) * 100)}%`,
            }}
          />
        </span>
      ))}
    </div>
  );
}
