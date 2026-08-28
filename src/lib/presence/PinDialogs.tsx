'use client';

import { useState } from 'react';
import type { Bar } from '@/types';
import type { PublicProfile } from '@/lib/follows.server';
import BarPicker from '@/components/BarPicker';
import { useModalDialog } from '@/hooks/useModalDialog';

/**
 * The two steps V8-R-PRE-002 and V8-R-PRE-003 name, as overlays.
 *
 * WHY THEY LIVE HERE rather than beside TonightPresence: `src/lib/presence/` is
 * the presence feature's own directory, and these are presence UI. They are two
 * screens of one flow — "Where are you tonight?" then "Who can see my pin
 * tonight?" — so keeping them together keeps the sequence readable in one file
 * instead of buried in the middle of the panel that opens them.
 *
 * NEITHER RE-DERIVES THE DIALOG CONTRACT. `useModalDialog` already owns focus
 * moving in, the Tab cycle, Escape, the scroll lock and `inert` on everything
 * behind — the contract that half the app's overlays used to implement
 * differently. A seventh hand-rolled trap is exactly what that hook exists to
 * stop.
 */

/**
 * V8-R-PRE-003 — "Search and select the bar you are at."
 *
 * "One question, one field: search plus a short recent-and-nearby list. Tapping
 * a result selects that bar and advances straight to the audience step. Back
 * returns to Tonight."
 *
 * `BarPicker` IS that field and that list; this is the question around it. The
 * advance is the caller's to make — `onPick` fires and the caller opens the
 * audience step — because only the caller knows whether the write landed, and
 * advancing past a pin that failed would ask who may see something that does not
 * exist.
 */
export function PinBarDialog({
  busy,
  onPick,
  onClose,
}: {
  busy: boolean;
  onPick: (bar: Bar) => void;
  onClose: () => void;
}): JSX.Element {
  const ref = useModalDialog<HTMLDivElement>(onClose);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Where are you tonight?"
      data-testid="pin-bar-dialog"
      className="fixed inset-0 z-[1100] flex flex-col bg-bg/95 backdrop-blur-sm overscroll-contain"
    >
      <div className="relative flex flex-1 flex-col max-w-2xl w-full mx-auto px-6 pt-8 pb-8 min-h-0">
        <header className="flex items-center justify-between gap-3 mb-2">
          <h2 className="font-display text-2xl leading-tight">
            Where are you tonight?
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation shrink-0"
          >
            Back
          </button>
        </header>
        {/* THE TRUST LINE STAYS IN PLACE THROUGHOUT (V8-R-PRE-001's
            accessibility clause). It is the answer to the question this screen
            raises by existing: why is the app asking where I am? */}
        <p className="text-muted text-xs mb-4">
          You choose the bar. Next Bar never tracks you automatically.
        </p>
        <div
          className={`flex-1 overflow-y-auto min-h-0 scrollbar-none ${
            busy ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          <BarPicker onPick={onPick} />
        </div>
      </div>
    </div>
  );
}

/**
 * V8-R-PRE-002 — "Choose who sees this pin", the "Other people" branch.
 *
 * SINGLE-SELECT IS A LABELLED RADIO GROUP, NOT COLOUR ALONE — that is the
 * requirement's accessibility clause, and it applies to this multi-select too:
 * every row here is a real checkbox with a label, so the selected state is
 * carried by the control rather than by a border colour.
 *
 * THE LIST IS MUTUAL FRIENDS ONLY, and that is not merely a convenience. D-C-37
 * resolves this audience to the selection INTERSECTED WITH the pinner's mutual
 * friends, and `set_night_presence` computes that intersection server-side and
 * fails the pin if nothing survives. Offering a non-mutual here would let
 * somebody tap a person who then silently vanished from the audience — the
 * client would be showing a recipient the server had already dropped.
 */
export function PinAudienceDialog({
  friends,
  friendsLoading,
  initialSelection,
  busy,
  onConfirm,
  onClose,
}: {
  friends: readonly PublicProfile[];
  /**
   * True while the friends read is still in flight. An empty list that is
   * merely loading is NOT "you have no friends to pick" — offering the empty
   * state early is the same class of lie as reporting an empty circle for a
   * failed presence read (V8-R-OPS-005).
   */
  friendsLoading: boolean;
  initialSelection: readonly string[];
  busy: boolean;
  onConfirm: (recipientIds: string[]) => void;
  onClose: () => void;
}): JSX.Element {
  const ref = useModalDialog<HTMLDivElement>(onClose);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(initialSelection),
  );

  const toggle = (id: string): void => {
    // A NEW SET EVERY TIME. Mutating the held one would leave React with the
    // same reference and no reason to re-render the checkbox that was tapped.
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Who can see my pin tonight?"
      data-testid="pin-audience-dialog"
      className="fixed inset-0 z-[1100] flex flex-col bg-bg/95 backdrop-blur-sm overscroll-contain"
    >
      <div className="relative flex flex-1 flex-col max-w-2xl w-full mx-auto px-6 pt-8 pb-8 min-h-0">
        <header className="flex items-center justify-between gap-3 mb-2">
          <h2 className="font-display text-2xl leading-tight">
            Who can see my pin tonight?
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation shrink-0"
          >
            Back
          </button>
        </header>
        <p className="text-muted text-xs mb-4">
          Only friends who follow you back can be picked. This applies to
          tonight&apos;s pin only.
        </p>

        <div className="flex-1 overflow-y-auto min-h-0 scrollbar-none">
          {friendsLoading ? (
            <p className="text-muted text-sm" role="status">
              Loading your friends…
            </p>
          ) : friends.length === 0 ? (
            <p className="text-muted text-sm" data-testid="pin-audience-none">
              You don&apos;t have any mutual friends yet, so there&apos;s nobody
              to pick. Close friends or Friends will still work.
            </p>
          ) : (
            <ul className="space-y-1" data-testid="pin-audience-list">
              {friends.map((friend) => (
                <li key={friend.id}>
                  <label className="flex items-center gap-3 min-h-[44px] px-2 rounded-2xl touch-manipulation cursor-pointer hover:bg-surface">
                    <input
                      type="checkbox"
                      checked={selected.has(friend.id)}
                      disabled={busy}
                      onChange={() => toggle(friend.id)}
                      className="h-5 w-5 accent-accent shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block font-display text-sm truncate">
                        {friend.displayName?.trim()
                          ? friend.displayName.trim()
                          : `@${friend.handle}`}
                      </span>
                      <span className="block text-muted text-xs truncate">
                        @{friend.handle}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          // DISABLED ON AN EMPTY SELECTION, matching the server. 'people' with
          // nobody in it is not "show it to nobody" and must never fall back to
          // Friends — the RPC raises on it, so an enabled button here would be
          // an action that can only fail.
          disabled={busy || selected.size === 0}
          onClick={() => onConfirm([...selected])}
          data-testid="pin-audience-confirm"
          className="mt-4 min-h-[44px] rounded-full border border-accent text-accent font-display text-sm touch-manipulation disabled:opacity-50 disabled:border-border disabled:text-muted"
        >
          {selected.size === 0
            ? 'Pick at least one person'
            : `Show my pin to ${selected.size} ${selected.size === 1 ? 'person' : 'people'}`}
        </button>
      </div>
    </div>
  );
}
