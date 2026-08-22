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
            {person.isYou === true && onRemoveMe !== null ? (
              <button
                type="button"
                data-testid="remove-me"
                onClick={onRemoveMe}
                className="shrink-0 min-h-[44px] px-3 rounded-2xl border border-border text-xs font-display uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
              >
                Remove me
              </button>
            ) : (
              <Link
                href={`/u/${person.handle}`}
                className="shrink-0 min-h-[44px] px-3 flex items-center rounded-2xl border border-border text-xs font-display uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
              >
                Profile
              </Link>
            )}
          </li>
        ))}
      </ul>

      <p className="text-muted text-[11px] mt-4 leading-relaxed">
        {posterName} posted this story.
      </p>
    </Sheet>
  );
}
