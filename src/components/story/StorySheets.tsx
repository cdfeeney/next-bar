'use client';

import Avatar from '@/components/Avatar';
import BarPicker from '@/components/BarPicker';
import type { Bar } from '@/types';
import Sheet from './Sheet';
import type { StoryAudience, TaggedPerson } from './storyStore';

/**
 * The three sheets Story compose opens. Each is a sheet over compose, never a
 * further full-screen step — `next-bar-add-story-flow.png` counts five
 * screens in this branch, not six.
 *
 * "Where was this?" wraps the app's ONE bar picker rather than growing a
 * second search list, and tagging never changes group membership: the people
 * sheet edits this story's tag list and nothing else.
 */

export function BarSheet({
  onPick,
  onClose,
}: {
  onPick: (bar: Bar) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Sheet label="Where was this?" testId="story-bar-sheet" onClose={onClose}>
      <p className="text-muted text-[11px] mb-3 leading-relaxed">
        The venue is chosen by you. It is never read from your location.
      </p>
      <div className="max-h-[55vh] overflow-y-auto">
        <BarPicker onPick={onPick} />
      </div>
    </Sheet>
  );
}

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
  return (
    <Sheet label="Tag friends" testId="story-people-sheet" onClose={onClose}>
      <p className="text-muted text-[11px] mb-3 leading-relaxed">
        Tagging someone here does not add them to a group.
      </p>
      {friends.length === 0 ? (
        <p data-testid="story-people-empty" className="text-sm leading-relaxed">
          Nobody to tag yet. Friends are people you follow who follow you back.
        </p>
      ) : null}
      <ul>
        {friends.map((friend) => {
          const on = selected.some((entry) => entry.id === friend.id);
          return (
            <li key={friend.id}>
              <button
                type="button"
                data-testid="story-people-row"
                data-profile={friend.id}
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
    </Sheet>
  );
}

const AUDIENCE_ROWS: ReadonlyArray<{
  value: StoryAudience;
  label: string;
  hint: string;
}> = [
  {
    value: 'friends',
    label: 'Friends',
    hint: 'All accepted friends · your Account default',
  },
  // "Selected groups" is GONE (V8 amendment, item 6). There is no saved-groups
  // capability in this database, and a people picker labelled as a group
  // feature is a promise the product cannot keep. It returns in V9 with real
  // groups behind it.
  { value: 'custom', label: 'Custom', hint: 'Pick people one by one' },
];

/**
 * Story audience, resolved AT ACTION TIME. A change here is a single-post
 * override: it applies to this story only and never rewrites the Account
 * default, which is what the closing line states on screen.
 *
 * `Friends` needs no list. The two NARROWER audiences do: an audience with no
 * recipients behind it is a label, not an audience, and it would leave the
 * stored story with nothing anyone could ever enforce it from. So picking one
 * of those two reveals your circle, and Done stays unavailable until at least
 * one person is chosen.
 */
export function AudienceSheet({
  value,
  friends,
  handles,
  lapsed = false,
  onChange,
  onToggleHandle,
  onDone,
  onClose,
}: {
  value: StoryAudience;
  /** Accepted MUTUAL friends — the only permissible recipients. */
  friends: readonly TaggedPerson[];
  /** Selected recipients, as real PROFILE IDS. */
  handles: readonly string[];
  /**
   * True when a post was REFUSED because every recipient of this narrowing had
   * left the circle. The sheet is reopened rather than the audience silently
   * widened, so this line is what tells the user why nothing was shared.
   */
  lapsed?: boolean;
  onChange: (next: StoryAudience) => void;
  onToggleHandle: (handle: string) => void;
  onDone: () => void;
  onClose: () => void;
}): JSX.Element {
  const needsPeople = value !== 'friends';
  // Readiness counts only recipients the sheet is actually SHOWING. Counting
  // `handles` itself trusted a selection that may no longer be in the circle —
  // unfollow someone in another tab and the row disappears while Done stayed
  // enabled on a recipient nobody could see, which is the same "label with
  // nothing behind it" this gate exists to prevent.
  const visible = handles.filter((handle) =>
    friends.some((friend) => friend.id === handle),
  );
  const ready = !needsPeople || visible.length > 0;
  return (
    <Sheet label="Story audience" testId="story-audience-sheet" onClose={onClose}>
      {lapsed ? (
        <p
          data-testid="story-audience-lapsed"
          role="alert"
          className="text-sm leading-relaxed mb-4 rounded-2xl border border-accent px-4 py-3"
        >
          Nothing was shared. Everyone you picked for this story has left your
          circle, so pick again or switch back to Friends.
        </p>
      ) : null}
      <ul role="radiogroup" aria-label="Story audience">
        {AUDIENCE_ROWS.map((row) => (
          <li key={row.value}>
            <button
              type="button"
              role="radio"
              data-testid="story-audience-option"
              data-value={row.value}
              aria-checked={value === row.value}
              onClick={() => onChange(row.value)}
              className="w-full flex items-center gap-3 min-h-[56px] border-b border-border text-left touch-manipulation"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{row.label}</span>
                <span className="block text-[11px] text-muted truncate">
                  {row.hint}
                </span>
              </span>
              <SelectionMark on={value === row.value} />
            </button>
          </li>
        ))}
      </ul>
      {needsPeople ? (
        <div data-testid="story-audience-people" className="mt-4">
          <p className="text-muted text-[11px] mb-2 leading-relaxed">
            Who sees it. Only friends who follow you back can be picked.
          </p>
          <ul className="max-h-[40vh] overflow-y-auto">
            {friends.map((friend) => {
              const on = handles.includes(friend.id);
              return (
                <li key={friend.id}>
                  <button
                    type="button"
                    data-testid="story-audience-person"
                    data-profile={friend.id}
                    data-handle={friend.handle}
                    aria-pressed={on}
                    onClick={() => onToggleHandle(friend.id)}
                    className="w-full flex items-center gap-3 min-h-[56px] border-b border-border text-left touch-manipulation"
                  >
                    <Avatar
                      initials={friend.initials}
                      seed={friend.id}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 text-sm truncate">
                      {friend.name}
                    </span>
                    <SelectionMark on={on} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* aria-disabled, never `disabled`: unchecking the last person while
          Done holds keyboard focus would drop focus to <body> behind this
          aria-modal sheet, and `disabled` also leaves the focus trap's Tab
          ring (src/lib/focusTrap.ts FOCUSABLE), so the control explaining why
          the sheet will not complete becomes unreachable. Same pattern as
          CameraStage's shutter. Rule: src/components/BarLightbox.tsx:322. */}
      <button
        type="button"
        data-testid="story-audience-done"
        onClick={() => {
          if (!ready) return;
          onDone();
        }}
        aria-disabled={!ready}
        className="w-full min-h-[52px] mt-5 rounded-2xl bg-accent text-bg font-display text-sm uppercase tracking-widest touch-manipulation hover:bg-accentDim transition-colors aria-disabled:opacity-40"
      >
        Done
      </button>
      {ready ? null : (
        <p
          data-testid="story-audience-needs-people"
          role="status"
          className="text-muted text-[11px] text-center mt-2 leading-relaxed"
        >
          Pick at least one person for this audience.
        </p>
      )}
      <p className="text-muted text-[11px] text-center mt-3 leading-relaxed">
        Applies to this story only. Your Account default stays Friends.
      </p>
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
