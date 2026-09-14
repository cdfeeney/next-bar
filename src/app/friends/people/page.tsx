'use client';

import Link from 'next/link';
import GroupsAndPeople from '../_components/GroupsAndPeople';

/**
 * /friends/people — GROUPS & PEOPLE, pushed from the Social header's people
 * icon (Social redesign 2026-09-13, README §10). Its own route on purpose: a
 * pushed screen gets the back gesture, a URL a test or a message can name, and
 * Tonight stops carrying a section that is not about tonight.
 *
 * Order matters and changed with the redesign: counts → Find friends → Groups
 * → Group Favorites. The consent inbox (pending follow requests) still comes
 * first whenever it is non-empty — consent is never hidden behind a scroll.
 */
export default function PeoplePage(): JSX.Element {
  return (
    <main className="min-h-screen pb-28">
      <header className="max-w-md mx-auto w-full flex items-center gap-2 px-4 pt-2.5 pb-2">
        <Link
          href="/friends"
          aria-label="Back to Social"
          data-testid="people-back"
          className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-2xl text-text text-lg touch-manipulation"
        >
          <span aria-hidden="true">‹</span>
        </Link>
        <h1
          id="groups-and-people-heading"
          className="font-display text-base font-bold min-w-0 flex-1"
        >
          Groups &amp; people
        </h1>
      </header>

      <div className="max-w-md mx-auto px-6 pt-2">
        <GroupsAndPeople />
      </div>
    </main>
  );
}
