'use client';

/** S-07 split (pure move): the member board and the invite-link reply counts. */
import type { NightOutMember } from '@/lib/nightOuts.server';
import type { AnonRsvpCounts } from '../planActions';

export default function MemberBoard({
  members,
  accepted,
  anonRsvps,
}: {
  members: NightOutMember[];
  accepted: NightOutMember[];
  anonRsvps: AnonRsvpCounts | null;
}): JSX.Element {
  return (
    <>
      {/* `data-testid`, not the heading text, is what "the member board" means
          now: the bearer surface has its own "Who's in" — the accepted COUNT,
          which 0044's preview has always made public — so a test asserting the
          member board is absent cannot key on those words any more. The two
          lists are different data with different audiences: this one names
          every member and their invite status, and only accepted members' own
          display identities reach the bearer one. */}
      <section className="mt-8" data-testid="member-board">
        <h2 className="font-semibold">Who&apos;s in ({accepted.length})</h2>
        <ul className="mt-2 space-y-1">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2 text-sm">
              <span>{m.displayName ?? m.handle ?? 'Someone'}</span>
              <span className="opacity-50">
                {m.role === 'owner'
                  ? 'host'
                  : m.inviteStatus === 'accepted'
                    ? 'in'
                    : m.inviteStatus === 'declined'
                      ? 'not tonight'
                      : 'invited'}
              </span>
            </li>
          ))}
        </ul>
        {/* V8-R-INV-003's audience is "plan members", and until round 5 an
            answer sent from the invitation link reached nobody: the only reader
            of the anon RSVPs needed the recipient's own secret key. Counts, not
            names — a token-scoped recipient has no account and gave none, and
            inventing one would be worse than the silence this replaces. A
            failed read says nothing rather than reporting zero replies. */}
        {anonRsvps !== null &&
        anonRsvps.going + anonRsvps.maybe + anonRsvps.declined > 0 ? (
          <p className="mt-3 text-sm opacity-70" data-testid="night-out-link-replies">
            From the invite link: {anonRsvps.going} going, {anonRsvps.maybe}{' '}
            maybe, {anonRsvps.declined} can&apos;t make it.
          </p>
        ) : null}
      </section>
    </>
  );
}
