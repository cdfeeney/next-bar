'use client';

/**
 * G-01 split: "Who's in" — the COUNT for a link holder with the account prompt
 * (owner 2026-09-16: names need an account), the full list once signed in —
 * and the read-only shortlist beneath it.
 */
import { getBarById } from '@/lib/catalog';
import type { NightOutPreview } from '@/lib/nightOuts.server';
import type { BearerAttendee, BearerShortlistEntry } from '../bearer';

export default function InviteWhosIn({
  preview,
  attendees,
  shortlist,
  signedIn,
  onSignIn,
}: {
  preview: NightOutPreview;
  attendees: BearerAttendee[] | null;
  shortlist: BearerShortlistEntry[] | null;
  signedIn: boolean;
  onSignIn: () => void;
}): JSX.Element {
  return (
    <>
      {/* WHO IS GOING. The COUNT is public to a link holder (0044's preview
          always released it); the NAMES are what an account is for — owner,
          2026-09-16: "to see who else is going on a night out they need to make
          their account". A signed-in viewer still gets the list. */}
      <section className="mt-8">
        <h2 className="font-semibold">
          Who&apos;s in ({preview.acceptedCount})
        </h2>
        {!signedIn ? (
          <div className="mt-2" data-testid="invite-whos-in-locked">
            <p className="text-sm opacity-60">
              {preview.acceptedCount === 0
                ? 'Nobody has said yes yet.'
                : preview.acceptedCount === 1
                  ? 'One person is in so far.'
                  : `${preview.acceptedCount} people are in so far.`}
            </p>
            <button
              type="button"
              onClick={onSignIn}
              data-testid="invite-whos-in-signup"
              className="mt-3 inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center rounded-full border px-6 text-sm"
            >
              Create an account to see who&apos;s going
            </button>
          </div>
        ) : attendees === null ? (
          <p className="mt-2 text-sm opacity-60" role="status">
            Couldn&apos;t load who&apos;s coming.
          </p>
        ) : attendees.length === 0 ? (
          <p className="mt-2 text-sm opacity-60">Nobody has said yes yet.</p>
        ) : (
          <ul className="mt-2 space-y-1" data-testid="invite-attendees">
            {attendees.map((person, index) => (
              <li
                key={`${person.handle ?? person.displayName ?? 'someone'}-${index}`}
                className="text-sm"
              >
                {person.displayName ?? person.handle ?? 'Someone'}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* THE SHORTLIST SO FAR (V8-R-INV-002) — read-only. There is no Vote
          control here and there is no anon grant behind one: "no voting, no
          suggesting" is V8-R-INV-001's own exclusion. */}
      <section className="mt-8">
        <h2 className="font-semibold">Where they&apos;re thinking</h2>
        {shortlist === null ? (
          <p className="mt-2 text-sm opacity-60" role="status">
            Couldn&apos;t load the shortlist.
          </p>
        ) : shortlist.length === 0 ? (
          <p className="mt-2 text-sm opacity-60">No bars suggested yet.</p>
        ) : (
          <ul className="mt-2 space-y-2" data-testid="invite-shortlist">
            {shortlist.map((entry) => (
              <li
                key={entry.barId}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
              >
                <span>{getBarById(entry.barId)?.name ?? entry.barId}</span>
                <span className="opacity-70">
                  {entry.votes} {entry.votes === 1 ? 'vote' : 'votes'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
