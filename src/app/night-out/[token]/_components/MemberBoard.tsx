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
import type { AnonGuest } from '../planActions';

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

/** A reply with a name that is coming, or might be — the ones that get a row. */
type NamedGuest = AnonGuest & { guestName: string; response: 'going' | 'maybe' };

function isNamedRow(g: AnonGuest): g is NamedGuest {
  return g.guestName !== null && g.response !== 'declined';
}

export default function MemberBoard({
  members,
  accepted,
  anonGuests,
}: {
  members: NightOutMember[];
  accepted: NightOutMember[];
  /**
   * G-01 / R-04: every share-link reply, from ONE read. Null = unread, failed,
   * or a pre-0080 database — and a failed read says nothing rather than zero.
   */
  anonGuests: AnonGuest[] | null;
}): JSX.Element {
  // R-04 item 3: rows and remainder come from the same snapshot, so a guest is
  // either a row or a count, never both.
  const replies = anonGuests ?? [];
  const namedRows = replies.filter(isNamedRow);
  const nameless = replies.filter((g) => g.guestName === null);
  const namelessGoing = nameless.filter((g) => g.response === 'going').length;
  const namelessMaybe = nameless.filter((g) => g.response === 'maybe').length;
  const declined = replies.filter((g) => g.response === 'declined').length;
  const namelessCount = namelessGoing + namelessMaybe;
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
      {/* G-01: the share-link guests who gave a name, as rows; the rest stay
          counted below. Owner 2026-09-16: a guest may add their name. */}
      {namedRows.length > 0 ? (
        <ul className="mt-3 space-y-2" data-testid="anon-guests">
          {namedRows.map((guest, i) => (
            <li key={`${guest.guestName}-${i}`} className="flex items-center gap-3 min-h-[44px]" data-testid="anon-guest">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-[11px] text-muted" aria-hidden="true">
                {guest.guestName.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold truncate">{guest.guestName}</p>
                <p className="text-[11px] uppercase tracking-wider text-muted">Guest · via the invite link</p>
              </div>
              <span className={`text-sm ${guest.response === 'going' ? 'text-text' : 'text-muted'}`}>
                {guest.response === 'going' ? 'Going' : 'Maybe'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {namelessCount > 0 ? (
        <p className="mt-2 text-sm text-muted" data-testid="anon-guests-nameless">
          {namelessCount === 1 ? '1 more reply from the invite link.' : `${namelessCount} more replies from the invite link.`}
        </p>
      ) : null}
      {/* V8-R-INV-003's audience is "plan members", and until round 5 an
          answer sent from the invitation link reached nobody. The named guests
          above are ALREADY rows, so this aggregate counts only what has no row —
          the nameless replies and every "can't make it" — or nobody could
          reconcile the two. A failed read says nothing rather than zero. */}
      {anonGuests !== null && namelessCount + declined > 0 ? (
        <p className="mt-3 text-sm text-muted" data-testid="night-out-link-replies">
          From the invite link: {namelessGoing} going, {namelessMaybe} maybe, {declined} can&apos;t make it.
        </p>
      ) : null}
    </section>
  );
}
