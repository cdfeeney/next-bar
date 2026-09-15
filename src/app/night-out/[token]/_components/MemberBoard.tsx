'use client';

/**
 * README §7 GOING — one row per member: 34px avatar, name 15px/600, "INVITED
 * VIA FRIENDS" 11px muted uppercase, and the state in words — "Going" in
 * `text`, "No reply" / "Not tonight" in `muted`. The host's row says "Host".
 *
 * `data-testid="member-board"` is what "the member board" means to the e2e:
 * the bearer surface has its own "Who's in" count, so nothing keys on words.
 */
import Avatar from '@/components/Avatar';
import type { NightOutMember } from '@/lib/nightOuts.server';
import type { AnonRsvpCounts } from '../planActions';

function initialsOf(name: string): string {
  const words = name.replace(/^@/, '').split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

function stateOf(m: NightOutMember): { label: string; muted: boolean } {
  if (m.role === 'owner') return { label: 'Host', muted: false };
  if (m.inviteStatus === 'accepted') return { label: 'Going', muted: false };
  if (m.inviteStatus === 'declined') return { label: 'Not tonight', muted: true };
  return { label: 'No reply', muted: true };
}

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
    <section className="mt-8" data-testid="member-board">
      <h2 className="font-label text-[11px] font-bold uppercase tracking-[0.25em] text-muted">
        Going <span className="normal-case tracking-normal">({accepted.length})</span>
      </h2>
      <ul className="mt-3 space-y-2">
        {members.map((m) => {
          const name = m.displayName ?? m.handle ?? 'Someone';
          const state = stateOf(m);
          return (
            <li key={m.userId} className="flex items-center gap-3 min-h-[44px]">
              <Avatar initials={initialsOf(name)} seed={m.handle ?? m.userId} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold truncate">{name}</p>
                <p className="text-[11px] uppercase tracking-wider text-muted">Invited via friends</p>
              </div>
              <span className={`text-sm ${state.muted ? 'text-muted' : 'text-text'}`}>{state.label}</span>
            </li>
          );
        })}
      </ul>
      {/* V8-R-INV-003's audience is "plan members", and until round 5 an
          answer sent from the invitation link reached nobody: the only reader
          of the anon RSVPs needed the recipient's own secret key. Counts, not
          names — a token-scoped recipient has no account and gave none, and
          inventing one would be worse than the silence this replaces. A
          failed read says nothing rather than reporting zero replies. */}
      {anonRsvps !== null &&
      anonRsvps.going + anonRsvps.maybe + anonRsvps.declined > 0 ? (
        <p className="mt-3 text-sm text-muted" data-testid="night-out-link-replies">
          From the invite link: {anonRsvps.going} going, {anonRsvps.maybe}{' '}
          maybe, {anonRsvps.declined} can&apos;t make it.
        </p>
      ) : null}
    </section>
  );
}
