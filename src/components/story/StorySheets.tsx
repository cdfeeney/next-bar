'use client';

import { useState } from 'react';

import Avatar from '@/components/Avatar';
import { filterPeople } from '@/components/composer/StoryAudienceSheet';
import Sheet from './Sheet';
import type { TaggedPerson } from './storyStore';

/**
 * "Tag friends" — the people sheet Compose opens (README §9.3). A sheet over
 * compose, never a further full-screen step. Tagging never changes group
 * membership: this edits the post's tag list and nothing else.
 *
 * The bar sheet and the Story-audience sheet that used to live here belonged
 * to Add-to-Story's own compose dock, which S-11 retired in favour of the one
 * composer; Compose carries its own bar sheet and the audience sheet is
 * `composer/StoryAudienceSheet.tsx`.
 */

/** README §9.3: the picker scroller is bounded at 290px. */
const PICKER_HEIGHT = 'max-h-[290px]';

export function PeopleSheet({
  friends,
  selected,
  onToggle,
  onClose,
}: {
  /** Accepted MUTUAL friends, from the real follow graph. */
  friends: readonly TaggedPerson[];
  selected: readonly TaggedPerson[];
  onToggle: (person: TaggedPerson) => void;
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const shown = filterPeople(friends, query);
  return (
    <Sheet label="Tag friends" testId="story-people-sheet" onClose={onClose}>
      <p className="text-muted text-[11px] mb-3 leading-relaxed">
        Friends are people you follow who follow you back.
      </p>
      {friends.length === 0 ? (
        <p data-testid="story-people-empty" className="text-sm leading-relaxed">
          Nobody to tag yet. Friends are people you follow who follow you back.
        </p>
      ) : (
        <>
          {/* The sheet broke at 70+ friends with no way to find one; a name or
              @handle filter is the fix, not a taller list. */}
          <input
            type="search"
            data-testid="story-people-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search friends…"
            aria-label="Search friends"
            className="w-full min-h-[44px] rounded-2xl border border-border bg-bg px-4 text-sm outline-none focus:border-accent"
          />
          <p
            data-testid="story-people-count"
            className="text-muted text-[11px] mt-2 mb-1"
            aria-live="polite"
          >
            {friends.length} {friends.length === 1 ? 'friend' : 'friends'} · {selected.length} picked
          </p>
          <ul className={`${PICKER_HEIGHT} overflow-y-auto`}>
            {shown.map((friend) => {
              const on = selected.some((entry) => entry.id === friend.id);
              return (
                <li key={friend.id}>
                  <button
                    type="button"
                    data-testid="story-people-row"
                    data-profile={friend.id}
                    data-handle={friend.handle}
                    aria-pressed={on}
                    onClick={() => onToggle(friend)}
                    className="w-full flex items-center gap-3 min-h-[56px] border-b border-border text-left touch-manipulation"
                  >
                    <Avatar initials={friend.initials} seed={friend.id} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm truncate">{friend.name}</span>
                      <span className="block text-[11px] text-muted truncate">
                        @{friend.handle}
                      </span>
                    </span>
                    <SelectionMark on={on} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <button
        type="button"
        data-testid="story-people-done"
        onClick={onClose}
        className="w-full min-h-[52px] mt-4 rounded-2xl bg-accent text-bg font-display text-sm uppercase tracking-widest touch-manipulation hover:bg-accentDim transition-colors"
      >
        Done
      </button>
    </Sheet>
  );
}

/**
 * Selection is a MARK, not a colour: the check glyph is present or absent, so
 * the state survives a monochrome or colour-blind reading.
 */
function SelectionMark({ on }: { on: boolean }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={[
        'w-6 h-6 shrink-0 rounded-full border flex items-center justify-center text-[11px]',
        on ? 'border-accent bg-accent text-bg' : 'border-border text-transparent',
      ].join(' ')}
    >
      ✓
    </span>
  );
}
