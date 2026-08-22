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
 * Automatic progression PAUSES on long-press, while the tagged-people sheet is
 * open, and whenever keyboard or assistive focus is on the chrome. It resumes
 * only when that ends.
 *
 * THERE IS NO REPLY FIELD. It wrote to `localStorage` and nothing ever
 * delivered it, so the control promised a message the product never sent. It
 * comes back with real delivery and a surface where the author can read it.
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
  startId,
  youId,
  onClose,
  onExhausted,
  onMarkSeen,
  onUntagMe,
}: {
  /** Rail order, already filtered to groups that have at least one item. */
  groups: readonly StoryGroup[];
  /** Profile id of the author whose queue opens first. */
  startId: string;
  /** The viewer's own profile id, or null when signed out. */
  youId: string | null;
  /** ✕ or Escape — the caller leaves the sub-tab where it was. */
  onClose: () => void;
  /** Queue ran out — the caller lands on Social · Tonight. */
  onExhausted: () => void;
  onMarkSeen: (itemId: string) => void;
  /**
   * Real backend tag withdrawal. Resolves with a message when it did NOT
   * happen — a consent control that reports success it did not achieve is
   * worse than one that visibly refused.
   */
  onUntagMe: (itemId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
}): JSX.Element | null {
  // Keyed by PROFILE ID, resolved to an index at render. A numeric index is a
  // claim about a queue that is still live underneath the viewer: expire a
  // story or unfollow someone in another tab and the same number now names a
  // DIFFERENT person, so the viewer either shows the wrong author's story or
  // points past the end. Key by id, resolve at render — the same rule the rest
  // of this surface follows.
  const [position, setPosition] = useState(() => ({
    id:
      groups.find((group) => group.id === startId)?.id ??
      groups[0]?.id ??
      startId,
    item: 0,
  }));
  const [elapsed, setElapsed] = useState(0);
  const [held, setHeld] = useState(false);
  const [chromeFocused, setChromeFocused] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saveFailed, setSaveFailed] = useState<string | null>(null);
  const [venueOpen, setVenueOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Escape and the Tab cycle, off while a sheet or the venue lightbox is open
  // above this dialog — each installs its own trap, and two armed at once
  // fight over focus.
  const dialogRef = useModalDialog<HTMLDivElement>(
    onClose,
    !sheetOpen && !venueOpen,
  );

  const groupIndex = groups.findIndex((entry) => entry.id === position.id);
  const group = groupIndex === -1 ? undefined : groups[groupIndex];
  const item = group?.items[position.item];

  const paused =
    held ||
    sheetOpen ||
    venueOpen ||
    chromeFocused;

  const advance = useCallback(() => {
    setElapsed(0);
    setPosition((current) => {
      const index = groups.findIndex((entry) => entry.id === current.id);
      if (index === -1) return current;
      const currentGroup = groups[index];
      if (current.item + 1 < currentGroup.items.length) {
        return { id: current.id, item: current.item + 1 };
      }
      // Person-to-person handoff: author, avatar, chips and progress all
      // change together, in rail order, with nothing in between.
      const next = groups[index + 1];
      if (next !== undefined) return { id: next.id, item: 0 };
      return current;
    });
  }, [groups]);

  const atEnd =
    group !== undefined &&
    groupIndex === groups.length - 1 &&
    position.item === group.items.length - 1;

  const back = useCallback(() => {
    setElapsed(0);
    setPosition((current) => {
      if (current.item > 0) return { id: current.id, item: current.item - 1 };
      const index = groups.findIndex((entry) => entry.id === current.id);
      if (index <= 0) return current;
      const previous = groups[index - 1];
      return {
        id: previous.id,
        item: Math.max(0, previous.items.length - 1),
      };
    });
  }, [groups]);

  // Scroll lock. Focus entry, the Tab cycle and focus restore are the shared
  // modal contract and live in useModalDialog above.
  useEffect(() => lockBodyScroll(), []);

  // The person being watched can leave the live queue while the viewer is open
  // — their last story expires, or a cross-tab unfollow drops them from the
  // rail. Rendering null in that case leaves this component MOUNTED, so the
  // scroll lock above never releases: the page stays locked under a dialog
  // nobody can see. Close instead, which unmounts and runs the cleanup.
  useEffect(() => {
    if (group === undefined || item === undefined) onClose();
  }, [group, item, onClose]);

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
  }, [paused, position.id, position.item]);

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
    (person) => person.isYou === true || person.id === youId,
  );

  /**
   * Criterion 6's "accessibility focus is on the chrome" is every control in
   * this dialog, the two tap zones included: they are buttons with their own
   * labels, so Tab lands on them, and the queue used to advance underneath a
   * focused control. One pair of handlers, spread on each container, rather
   * than three copies that can drift apart again.
   */
  const chromeFocus = {
    onFocus: () => setChromeFocused(true),
    onBlur: () => setChromeFocused(false),
  };

  const startPress = (): void => {
    pressTimer.current = setTimeout(() => setHeld(true), LONG_PRESS_MS);
  };
  const endPress = (
    event: React.PointerEvent<HTMLButtonElement>,
    onTap: () => void,
  ): void => {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    // A POINTER tap is not accessibility focus. Chromium focuses a button on
    // pointer-down and WebKit does not, so without this the same tap paused
    // the queue on one engine and not the other; blurring makes the two agree
    // and leaves keyboard focus (which never fires these) pausing as it should.
    event.currentTarget.blur();
    if (held) {
      setHeld(false);
      return;
    }
    onTap();
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
        {...chromeFocus}
      >
        <ProgressStrip count={group.items.length} index={position.item} elapsed={elapsed} />

        <div className="flex items-center gap-3 mt-3">
          <Avatar initials={group.initials} seed={group.id} size="sm" />
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
      <div className="relative flex-1 mt-3" {...chromeFocus}>
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
          onPointerUp={(event) => endPress(event, back)}
          onPointerCancel={(event) => endPress(event, () => undefined)}
          className="absolute left-0 top-0 bottom-0 w-1/3"
        />
        <button
          type="button"
          data-testid="story-forward-zone"
          aria-label="Next story item"
          onPointerDown={startPress}
          onPointerUp={(event) => endPress(event, atEnd ? onExhausted : advance)}
          onPointerCancel={(event) => endPress(event, () => undefined)}
          className="absolute right-0 top-0 bottom-0 w-2/3"
        />
      </div>

      {saveFailed !== null ? (
        <p
          data-testid="story-viewer-save-failed"
          role="alert"
          className="px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] text-sm text-center leading-relaxed"
        >
          {saveFailed}
        </p>
      ) : null}

      {venueOpen && bar ? (
        <BarLightbox bar={bar} onClose={() => setVenueOpen(false)} />
      ) : null}

      {sheetOpen ? (
        <TaggedPeopleSheet
          people={item.tagged.map((person) =>
            person.id === youId ? { ...person, isYou: true } : person,
          )}
          posterName={group.name}
          onRemoveMe={
            youAreTagged
              ? () => {
                  // The sheet closes only after the BACKEND confirms. Closing
                  // first and reporting nothing is how a consent control ends
                  // up claiming a removal that never reached the server.
                  void onUntagMe(item.id).then((result) => {
                    if (result.ok) {
                      setSaveFailed(null);
                      setSheetOpen(false);
                      return;
                    }
                    setSaveFailed(result.message);
                  });
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
