'use client';

import { useState } from 'react';

import Avatar from '@/components/Avatar';
import Sheet from '@/components/story/Sheet';
import type { TaggedPerson } from '@/components/story/storyStore';

import type { StoryAudienceChoice } from './types';

/**
 * The Story-audience sheet — README §9 "Story audience sheet", exactly TWO
 * options, per `storyStore.ts`'s `StoryAudience = 'friends' | 'custom'`:
 *
 *   Friends  "All accepted friends · your Account default"
 *   Custom   "Pick people one by one" — reveals the mutuals picker with a search
 *            field; Done reads "Pick at least one person" and is HELD while
 *            Custom has nobody.
 *
 * The composer used to offer a third, named-group audience here. The social
 * redesign (2026-09-13) dropped it: a story's audience is its friends or a
 * hand-picked few, and a GROUP is a destination (its own thread), not a way
 * to narrow a story. `StoryAudienceChoice` is exactly these two.
 *
 * IT IS A SHEET OVER THE DESTINATION SCREEN, NOT A FOURTH FRAME: "opens as a
 * sheet over the destination screen rather than as a fourth frame" is the
 * requirement's own wording, and V8-R-CMP-001 counts three steps.
 *
 * Dismissing (✕, backdrop, Escape) is not Done: the parent restores the last
 * COMMITTED audience, which for a Custom that never had anybody picked is
 * Friends — "Dismissing with Custom empty falls back to Friends" (README) and
 * D-C-37 (never widen a committed narrowing) are the same rule seen from two
 * sides, and both live in `GlobalComposer`, not here.
 */
export default function StoryAudienceSheet({
  value,
  friends,
  friendsReady,
  customIds,
  resolvedCount,
  lapsed,
  onChangeChoice,
  onToggleCustom,
  onDone,
  onClose,
}: {
  value: StoryAudienceChoice;
  /** Accepted MUTUAL friends — the only permissible recipients. */
  friends: readonly TaggedPerson[];
  /** False until the real circle has resolved; narrowing fails closed until then. */
  friendsReady: boolean;
  customIds: readonly string[];
  /** How many people the current choice ACTUALLY reaches, after the intersection. */
  resolvedCount: number;
  /** True when a publish was refused because this narrowing reached nobody. */
  lapsed: boolean;
  onChangeChoice: (next: StoryAudienceChoice) => void;
  onToggleCustom: (profileId: string) => void;
  onDone: () => void;
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  // Done is unavailable while a narrowing reaches nobody — an audience with no
  // recipients behind it is a label, not an audience.
  const ready = value === 'friends' || (friendsReady && resolvedCount > 0);
  const shown = filterPeople(friends, query);

  return (
    <Sheet label="Story audience" testId="composer-audience-sheet" onClose={onClose}>
      {lapsed ? (
        <p
          data-testid="composer-audience-lapsed"
          role="alert"
          className="text-sm leading-relaxed mb-4 rounded-2xl border border-accent px-4 py-3"
        >
          Nothing was shared. Nobody in that audience is a friend who follows you
          back, so pick again or switch back to Friends.
        </p>
      ) : null}

      <ul role="radiogroup" aria-label="Story audience">
        <AudienceOption
          option="friends"
          label="Friends"
          hint="All accepted friends · your Account default"
          value={value}
          onChange={onChangeChoice}
        />
        <AudienceOption
          option="custom"
          label="Custom"
          hint="Pick people one by one"
          value={value}
          onChange={onChangeChoice}
        />
      </ul>

      {value === 'custom' ? (
        <div data-testid="composer-audience-people" className="mt-4">
          <p className="text-muted text-[11px] mb-2 leading-relaxed">
            Who sees it. Only friends who follow you back can be picked.
          </p>
          <input
            type="search"
            data-testid="composer-audience-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search friends…"
            aria-label="Search friends"
            className="w-full min-h-[44px] rounded-2xl border border-border bg-bg px-4 text-sm outline-none focus:border-accent mb-2"
          />
          <ul className="max-h-[290px] overflow-y-auto">
            {shown.map((friend) => {
              const on = customIds.includes(friend.id);
              return (
                <li key={friend.id}>
                  <button
                    type="button"
                    data-testid="composer-audience-person"
                    data-profile={friend.id}
                    data-handle={friend.handle}
                    aria-pressed={on}
                    onClick={() => onToggleCustom(friend.id)}
                    className="w-full flex items-center gap-3 min-h-[56px] border-b border-border text-left touch-manipulation"
                  >
                    <Avatar initials={friend.initials} seed={friend.id} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm truncate">{friend.name}</span>
                      <span className="block text-[11px] text-muted truncate">@{friend.handle}</span>
                    </span>
                    <SelectionMark on={on} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <p data-testid="composer-audience-count" className="text-muted text-[11px] mt-4">
        {value === 'friends'
          ? 'Everyone who follows you back'
          : `${resolvedCount} ${resolvedCount === 1 ? 'person' : 'people'} will see this story`}
      </p>

      {/* aria-disabled, never `disabled`: unchecking the last person while Done
          holds keyboard focus would drop focus to <body> behind this aria-modal
          sheet, and `disabled` also leaves the focus trap's Tab ring. The
          control explaining why the sheet will not complete stays reachable.
          README: while held, the button itself SAYS why. */}
      <button
        type="button"
        data-testid="composer-audience-done"
        onClick={() => {
          if (!ready) return;
          onDone();
        }}
        aria-disabled={!ready}
        className="mt-3 w-full min-h-[52px] rounded-2xl bg-accent text-bg font-display text-sm uppercase tracking-widest touch-manipulation hover:bg-accentDim transition-colors aria-disabled:bg-held aria-disabled:text-muted"
      >
        {ready ? 'Done' : 'Pick at least one person'}
      </button>
      <p className="text-muted text-[11px] text-center mt-3 leading-relaxed">
        Applies to this story only. Your Account default stays Friends.
      </p>
    </Sheet>
  );
}

/** Name or @handle, case-insensitive; an empty query shows everyone. */
export function filterPeople(
  people: readonly TaggedPerson[],
  query: string,
): readonly TaggedPerson[] {
  const needle = query.trim().replace(/^@/, '').toLowerCase();
  if (needle.length === 0) return people;
  return people.filter(
    (person) =>
      person.name.toLowerCase().includes(needle) || person.handle.toLowerCase().includes(needle),
  );
}

function AudienceOption({
  option,
  label,
  hint,
  value,
  onChange,
}: {
  option: StoryAudienceChoice;
  label: string;
  hint: string;
  value: StoryAudienceChoice;
  onChange: (next: StoryAudienceChoice) => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        role="radio"
        data-testid="composer-audience-option"
        data-value={option}
        aria-checked={value === option}
        onClick={() => onChange(option)}
        className="w-full flex items-center gap-3 min-h-[56px] border-b border-border text-left touch-manipulation"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm">{label}</span>
          <span className="block text-[11px] text-muted truncate">{hint}</span>
        </span>
        <SelectionMark on={value === option} />
      </button>
    </li>
  );
}

/** Labelled, never colour-only — the indicator carries its own text. */
function SelectionMark({ on }: { on: boolean }): JSX.Element {
  return (
    <span
      className={`text-[11px] uppercase tracking-widest ${on ? 'text-accent' : 'text-muted'}`}
    >
      {on ? 'On' : 'Off'}
    </span>
  );
}
