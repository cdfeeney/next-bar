'use client';

import { useState } from 'react';
import type { PublicProfile } from '@/lib/follows.server';

/**
 * The presence feature's shared pieces for the pin sequence. Until S-05b this
 * file held two MODAL dialogs (the bar step and the recipient picker); the
 * Social redesign draws the sequence as three PUSHED screens (README §4–§5,
 * owner decision 2026-09-14), so the screens now live in
 * `app/friends/_components/PinSteps.tsx` and this file keeps what they share:
 * the pure rules and the inline friends picker.
 */

/**
 * README §5 / Interactions › Search fields: filter on display name or @handle,
 * case-insensitive; a leading @ is ignored; an empty query is the whole list.
 * Pure, so the rule is unit-tested once and shared by every people picker.
 */
export function filterFriends<T extends { handle: string; displayName: string | null }>(
  friends: readonly T[],
  query: string,
): readonly T[] {
  const needle = query.trim().toLowerCase().replace(/^@/, '');
  if (needle.length === 0) return friends;
  return friends.filter(
    (friend) =>
      friend.handle.toLowerCase().includes(needle)
      || (friend.displayName ?? '').toLowerCase().includes(needle),
  );
}

/** README §5: "Custom" with nobody picked holds the confirm. */
export function isAudienceHeld(audience: 'friends' | 'close' | 'people', recipientCount: number): boolean {
  return audience === 'people' && recipientCount === 0;
}

/**
 * V8-R-PRE-002 — "Choose who sees this pin", the Custom branch, INLINE under the
 * audience rows (README §5). Controlled: the caller owns the selection because
 * the selection is part of the pending pin, and "Pin it" is the one confirm.
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
 * somebody tap a person who then silently vanished from the audience.
 */
export function FriendPicker({
  friends,
  friendsLoading,
  friendsFailed,
  selected,
  busy,
  onToggle,
}: {
  friends: readonly PublicProfile[];
  /**
   * True while the friends read is still in flight. An empty list that is
   * merely loading is NOT "you have no friends to pick" — offering the empty
   * state early is the same class of lie as reporting an empty circle for a
   * failed presence read (V8-R-OPS-005).
   */
  friendsLoading: boolean;
  /**
   * True when the circle read FAILED. The third state: a failed `get_following`
   * leaves `loading` false and `mutuals` empty, which is indistinguishable here
   * from a real empty circle — so a network failure would tell the pinner they
   * have no mutual friends, a claim we have no evidence for.
   */
  friendsFailed: boolean;
  selected: readonly string[];
  busy: boolean;
  onToggle: (id: string) => void;
}): JSX.Element {
  // README §5: a name / @handle filter, case-insensitive, over a bounded
  // scroller — the whole-list picker broke at 70+ friends.
  const [query, setQuery] = useState('');
  const matching = filterFriends(friends, query);
  const picked = new Set(selected);

  return (
    <div data-testid="pin-friend-picker" className="space-y-2.5">
      <p className="text-muted text-xs">
        Only friends who follow you back can be picked. This applies to
        tonight&apos;s pin only.
      </p>
      <label className="block">
        <span className="sr-only">Search friends</span>
        <input
          type="search"
          inputMode="text"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search friends…"
          data-testid="pin-audience-search"
          className="w-full min-h-[44px] rounded-[14px] border border-border bg-surface px-3.5 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent"
        />
      </label>

      <div className="overflow-y-auto max-h-[260px] scrollbar-none">
        {friendsLoading ? (
          <p className="text-muted text-sm" role="status">
            Loading your friends…
          </p>
        ) : friendsFailed ? (
          <p className="text-muted text-sm" role="status" data-testid="pin-audience-error">
            Couldn&apos;t load your friends. Try again in a moment — Close
            friends or Friends will still work.
          </p>
        ) : friends.length === 0 ? (
          <p className="text-muted text-sm" data-testid="pin-audience-none">
            You don&apos;t have any mutual friends yet, so there&apos;s nobody
            to pick. Close friends or Friends will still work.
          </p>
        ) : matching.length === 0 ? (
          <p className="text-muted text-[13px] px-0.5 py-2" data-testid="pin-audience-no-match">
            Nobody matches &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="pin-audience-list">
            {matching.map((friend) => (
              <li key={friend.id}>
                <label
                  className={[
                    'flex items-center gap-3 min-h-[52px] px-3.5 rounded-2xl border touch-manipulation cursor-pointer transition-colors',
                    picked.has(friend.id) ? 'border-accent bg-accent/[0.10]' : 'border-border hover:bg-surface',
                  ].join(' ')}
                >
                  <input
                    type="checkbox"
                    checked={picked.has(friend.id)}
                    disabled={busy}
                    onChange={() => onToggle(friend.id)}
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
    </div>
  );
}
