'use client';

import Link from 'next/link';
import Avatar from '@/components/Avatar';
import Sheet from './Sheet';
import type { TaggedPerson } from './storyStore';

/**
 * "Tagged in this story" — one sheet, three entry points, per the detail
 * panel in `next-bar-story-tag-placement.png`.
 *
 * It lists the FULL tag list that the chip's "+N" collapsed, links every row
 * to that person's profile, and gives anyone tagged a first-person way out of
 * someone else's story. Every row is a 56px target, and no like count appears
 * here or anywhere on a story.
 *
 * The caller pauses automatic progression while this is open — the sheet does
 * not reach into the viewer's timer (see StoryViewer's pause reasons).
 */
/**
 * Where a row's Profile goes.
 *
 * Your own row does NOT go to `/u/<handle>`: `VIEWER_HANDLE` is the local
 * placeholder `'you'` (storyStore.ts), which is not a real profile — that route
 * dead-ends on "No one here" signed-out and `notFound()` signed-in. Your own
 * profile surface in this product is the Account root at `/settings`, so that
 * is where your row points. Every row still links to a profile (criterion 7);
 * one of them is yours.
 */
function profileHref(person: TaggedPerson): string {
  return person.isYou === true ? '/settings' : `/u/${person.handle}`;
}

export default function TaggedPeopleSheet({
  people,
  posterName,
  onRemoveMe,
  onClose,
}: {
  people: readonly TaggedPerson[];
  posterName: string;
  /** Absent when you are not tagged — every row then offers Profile only. */
  onRemoveMe: (() => void) | null;
  onClose: () => void;
}): JSX.Element {
  return (
    <Sheet
      label="Tagged in this story"
      testId="tagged-people-sheet"
      position="absolute"
      onClose={onClose}
    >
      <ul>
        {people.map((person) => (
          <li
            key={person.handle}
            data-testid="tagged-person-row"
            className="flex items-center gap-3 min-h-[56px] border-b border-border last:border-b-0"
          >
            <Avatar initials={person.initials} seed={person.handle} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm truncate">{person.name}</span>
              <span className="block text-[11px] text-muted truncate">
                @{person.handle}
                {person.isYou === true ? ' · you' : ''}
              </span>
            </span>
            {/* EVERY row links to a profile — "Remove me" is an extra action
                on your own row, not a replacement for it. Swapping the two
                left the one person guaranteed to be in this list with no way
                to reach a profile from it. */}
            <span className="shrink-0 flex items-center gap-2">
              <Link
                href={profileHref(person)}
                data-testid="tagged-person-profile"
                className="min-h-[44px] px-3 flex items-center rounded-2xl border border-border text-xs font-display uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
              >
                Profile
              </Link>
              {person.isYou === true && onRemoveMe !== null ? (
                <button
                  type="button"
                  data-testid="remove-me"
                  onClick={onRemoveMe}
                  className="min-h-[44px] px-3 rounded-2xl border border-border text-xs font-display uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
                >
                  Remove me
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-muted text-[11px] mt-4 leading-relaxed">
        {posterName} posted this story.
      </p>
    </Sheet>
  );
}
