'use client';

import Avatar from '@/components/Avatar';
import Sheet from '@/components/story/Sheet';
import type { TaggedPerson } from '@/components/story/storyStore';

import type { ComposerGroup, StoryAudienceChoice } from './types';

/**
 * The Story-audience sheet (V8-R-CMP-005).
 *
 * WHY THIS IS NOT `story/StorySheets.tsx`'s `AudienceSheet`. That one is typed
 * to `StoryAudience = 'friends' | 'custom'` and deliberately dropped its
 * "Selected groups" row, because at the time "there is no saved-groups
 * capability in this database, and a people picker labelled as a group feature
 * is a promise the product cannot keep". That is no longer true — `groups.server.ts`
 * ships real named groups — and V8-R-CMP-005 requires the named-group audience
 * here. Widening the story branch's own type is another lane's file, so the
 * composer carries its own sheet over the SAME shared `Sheet` shell.
 *
 * IT IS A SHEET OVER THE DESTINATION SCREEN, NOT A FOURTH FRAME: "opens as a
 * sheet over the destination screen rather than as a fourth frame" is the
 * requirement's own wording, and V8-R-CMP-001 counts three steps.
 *
 * D-C-37 lives in `resolveStoryRecipients`, not here: a named group resolves to
 * that group INTERSECTED WITH the poster's mutual friends. This sheet shows the
 * intersection it will actually get, so the count on screen is the count that
 * publishes.
 */
export default function StoryAudienceSheet({
  value,
  groups,
  groupId,
  friends,
  friendsReady,
  customIds,
  resolvedCount,
  lapsed,
  onChangeChoice,
  onChangeGroup,
  onToggleCustom,
  onDone,
  onClose,
}: {
  value: StoryAudienceChoice;
  groups: readonly ComposerGroup[];
  groupId: string | null;
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
  onChangeGroup: (next: string) => void;
  onToggleCustom: (profileId: string) => void;
  onDone: () => void;
  onClose: () => void;
}): JSX.Element {
  // Done is unavailable while a narrowing reaches nobody — the same gate the
  // story branch keeps, for the same reason: an audience with no recipients
  // behind it is a label, not an audience.
  const ready = value === 'friends' || (friendsReady && resolvedCount > 0);

  return (
    <Sheet label="Story audience" testId="composer-audience-sheet" onClose={onClose}>
      <p className="text-muted text-[11px] mb-3 leading-relaxed">
        This governs your story only. It never changes who sees the Feed post,
        the Night Out recap or a group thread.
      </p>

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
          option="group"
          label="A group"
          hint="That group, narrowed to friends who follow you back"
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

      {value === 'group' ? (
        <div data-testid="composer-audience-groups" className="mt-4">
          <p className="text-muted text-[11px] mb-2 leading-relaxed">
            A group member who is not a friend who follows you back is not a
            recipient.
          </p>
          {groups.length === 0 ? (
            <p data-testid="composer-audience-groups-empty" className="text-sm leading-relaxed">
              You have no groups yet.
            </p>
          ) : (
            <ul>
              {groups.map((group) => (
                <li key={group.id}>
                  <button
                    type="button"
                    data-testid="composer-audience-group"
                    data-group={group.id}
                    role="radio"
                    aria-checked={groupId === group.id}
                    onClick={() => onChangeGroup(group.id)}
                    className="w-full flex items-center gap-3 min-h-[56px] border-b border-border text-left touch-manipulation"
                  >
                    <span className="min-w-0 flex-1 text-sm truncate">{group.name}</span>
                    <SelectionMark on={groupId === group.id} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {value === 'custom' ? (
        <div data-testid="composer-audience-people" className="mt-4">
          <p className="text-muted text-[11px] mb-2 leading-relaxed">
            Only friends who follow you back can be picked.
          </p>
          <ul className="max-h-[40vh] overflow-y-auto">
            {friends.map((friend) => {
              const on = customIds.includes(friend.id);
              return (
                <li key={friend.id}>
                  <button
                    type="button"
                    data-testid="composer-audience-person"
                    data-profile={friend.id}
                    aria-pressed={on}
                    onClick={() => onToggleCustom(friend.id)}
                    className="w-full flex items-center gap-3 min-h-[56px] border-b border-border text-left touch-manipulation"
                  >
                    <Avatar initials={friend.initials} seed={friend.id} size="sm" />
                    <span className="min-w-0 flex-1 text-sm truncate">{friend.name}</span>
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

      <button
        type="button"
        data-testid="composer-audience-done"
        onClick={onDone}
        disabled={!ready}
        aria-disabled={!ready}
        className="mt-3 w-full min-h-[52px] rounded-2xl bg-accent text-bg font-display text-sm uppercase tracking-widest touch-manipulation disabled:opacity-40"
      >
        Done
      </button>
    </Sheet>
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
