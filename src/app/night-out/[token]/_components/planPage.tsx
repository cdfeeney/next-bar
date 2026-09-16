/**
 * S-07 split (pure move): the page's own types, constants, helpers and the
 * shortlist overflow menu, lifted out of page.tsx so the route file sits under
 * the 800-line cap. Nothing here changed behaviour; the comments travelled
 * with their code.
 */
import { getBarById } from '@/lib/catalog';
import type {
  NightOut,
  NightOutBoardEntry,
  NightOutMember,
  NightOutPreview,
} from '@/lib/nightOuts.server';
import type { AnonGuest, AnonRsvpCounts, NightOutVoting } from '../planActions';

export type PageState =
  | { kind: 'loading' }
  | { kind: 'gone' }
  | { kind: 'preview'; preview: NightOutPreview }
  | {
      kind: 'member';
      plan: NightOut;
      members: NightOutMember[];
      /** Null = the board READ failed (S-07 acceptance 8) — never drawn as an empty shortlist. */
      board: NightOutBoardEntry[] | null;
      /**
       * V8-R-NO-005. Null when the read failed — which is NOT "voting is
       * closed", and is why this is not folded into a boolean.
       */
      voting: NightOutVoting | null;
      /** V8-R-INV-003. Null when the read failed; zeroes mean nobody replied. */
      anonRsvps: AnonRsvpCounts | null;
      /** G-01: named share-link guests; null = unread or a pre-0080 database. */
      anonGuests: AnonGuest[] | null;
    };

/**
 * Has the page reached a TERMINAL state — i.e. has the invite handoff finished
 * its job, whatever the outcome?
 *
 * This predicate is the root of a bug that has now been "fixed" three times,
 * each time by approximating the same invariant slightly differently:
 *
 *   round 1: consume in PendingInviteRedirect  -> it navigated away before
 *            arriving, so an interrupted trip lost the plan
 *   round 2: consume on MOUNT                  -> mount is not arrival;
 *            OnboardingGate redirected first and the token was already gone
 *   round 3: consume on state.kind==='member'  -> membership is not the only
 *            arrival; a signed-in non-member settling in 'preview' or 'gone'
 *            never spent the token, so PendingInviteRedirect replayed the
 *            navigation on EVERY route change for the rest of the session
 *
 * The invariant was always: the handoff is spent once the destination SETTLES,
 * regardless of which terminal state it settles into. Stating it once, here,
 * is what stops a fourth variant appearing.
 *
 * The exhaustive switch is deliberate. Adding a fifth PageState will fail to
 * compile until someone classifies it as settled or not — the next person
 * cannot silently inherit the wrong answer.
 */
export function isSettled(kind: PageState['kind']): boolean {
  switch (kind) {
    case 'member':
    case 'preview':
    case 'gone':
      return true;
    case 'loading':
      return false;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * V8-R-SOC-008's overflow control and its one action.
 *
 * "Ownership and removal are carried by the control and its menu, never by a
 * paragraph" — so the affordance IS the control, and the row says nothing about
 * who may act on it. 44px, as the requirement's accessibility clause states.
 *
 * The parent decides whether this renders at all, using the same predicate the
 * RPC enforces; this component decides nothing about authorization.
 */
export function ShortlistOverflow({
  barName,
  open,
  onToggle,
  onRemove,
}: {
  barName: string;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <span className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`More for ${barName}`}
        onClick={onToggle}
        data-testid="shortlist-overflow"
        className="inline-flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-full border text-sm"
      >
        ⋯
      </button>
      {open ? (
        <span
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 min-w-[10rem] rounded-lg border bg-black p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={onRemove}
            data-testid="shortlist-remove"
            className="block w-full rounded-md px-3 py-2 text-left text-sm"
          >
            Remove from the shortlist
          </button>
        </span>
      ) : null}
    </span>
  );
}

/**
 * "Friday at 11:00 PM" for a voting deadline, in the contract's zone.
 *
 * America/New_York rather than the device's: the deadline is a fact about the
 * plan, and every other instant this surface states — the scheduled start, the
 * media window — is stated the same way. The empty string for an unparseable
 * instant lets the caller render the sentence without a hole in it.
 */
export function deadlineLabel(instant: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(at);
}

/**
 * A second past the deadline, so the server has crossed it by its own clock
 * when we ask; the floor for a deadline this device thinks is ALREADY BEHIND
 * IT, which is what such a deadline waits instead of never arming at all; and
 * the longest single wait before the timer re-arms, because `setTimeout`
 * silently fires immediately past ~24.8 days.
 */
/**
 * What a member load actually did — three outcomes, never a boolean.
 *
 * Round-10 round 9, Claude gate, and the round-4 comment in the Join handler
 * had already written down why: `false` meant BOTH "the read failed" and "the
 * view moved on and I refused to paint", and only the first is something to
 * report. Every caller carried its own hand-patch that re-checked `viewEpoch`
 * to tell them apart. Round 8 added a SECOND reason to refuse — a newer load of
 * the same view had already painted — and those hand-patches, which knew only
 * about the epoch, silently started reporting it as a failure: a double-tapped
 * Join painted "You're in — but this page couldn't load" over a member board
 * that had loaded correctly, and the resolve effect would paint the bearer
 * PREVIEW over it.
 *
 * Patching each caller a second time would leave the same trap set for the
 * third reason. The ambiguity is in the return type, so that is what changed.
 */
export type MemberLoad = 'painted' | 'superseded' | 'failed';

export const DEADLINE_GRACE_MS = 1_000;
export const MIN_RECHECK_MS = 60_000;
export const MAX_REARM_MS = 6 * 60 * 60 * 1_000;
/**
 * How much CLOCK SKEW the approach tolerates — and, therefore, how long before
 * a deadline this device believes is still ahead we start asking every minute.
 *
 * Waiting an "ahead" deadline exactly is only right if the two clocks agree. On
 * a device running ten minutes SLOW the server closes voting first while
 * Suggest, Vote and Remove stay editable here for the whole skew, and the first
 * tap in that window is refused instead of the surface having gone read-only
 * (round-10 round 7, Codex). The behind case already had a floor for the
 * disagreement; this is the same tolerance on the other side.
 *
 * IT IS A WINDOW, NOT A CAP (round-10 round 8, both lanes). Round 7 wrote
 * `Math.min(delay, 60_000)`, which does not mean "notice the deadline a minute
 * late" — it means "ask again every minute, forever". A plan opened hours
 * before its deadline re-ran `loadMemberView`'s FIVE RPCs every sixty seconds
 * for the whole wait. Ten minutes is the tolerance, the figure round 7's own
 * trigger named: inside the window, a read a minute.
 *
 * OUTSIDE IT WE HALVE, RATHER THAN SLEEP THROUGH (round-10 round 9, Codex).
 * Round 8 waited to the window's edge in one go, which made the tolerance a
 * CONSTANT: a device thirty minutes slow kept Suggest, Vote and Remove editable
 * for twenty minutes past a deadline the server was already enforcing, and
 * every tap in that window is refused. Halving makes the lag at the true
 * crossing at most half the remaining wait, so it scales with the error, at a
 * logarithmic number of reads. See `NightOutMedia`'s copy for the full
 * reasoning and for the residual gap, which is reported rather than closed.
 */
export const SKEW_TOLERANCE_MS = 10 * 60_000;

/**
 * When to ask the server again about a deadline only the server enforces.
 *
 * THE FLOOR IS FOR THE DISAGREEMENT CASE ONLY (round-9 panel). It used to be
 * `Math.max(delay, MIN_RECHECK_MS)`, which reads as "never poll faster than
 * once a minute" and behaves as "never notice a deadline sooner than a minute":
 * a deadline five seconds away was re-read after sixty, so Suggest, Vote and
 * Remove stayed editable for most of a minute past an expiry the server was
 * already enforcing, and the first tap in that window was refused instead of
 * the page having gone read-only. A deadline still AHEAD is waited for
 * exactly. One already behind cannot change its answer until the server's own
 * clock crosses, so there the floor is right.
 *
 * `NightOutMedia` carries the same rule for its media window, and round 8 fixed
 * one copy while leaving the other. A shared module in `src/lib/` would be the
 * repair and is another lane's write scope, so the duplication is recorded here
 * rather than hidden.
 *
 * AND A DEADLINE AHEAD IS NOT WAITED INDEFINITELY EITHER (round-10 round 7,
 * Codex). "Waited exactly" is correct only when the clocks agree; on a slow
 * device the server closes first and this surface stays editable for the whole
 * skew. The approach therefore opens `SKEW_TOLERANCE_MS` before the deadline
 * and asks every minute inside it, which makes the tolerance symmetric without
 * turning the timer into a permanent poll (round-10 round 8 — see that
 * constant; the previous shape polled for the entire ahead period).
 */
export function clampRecheck(delayMs: number): number {
  if (delayMs <= 0) return MIN_RECHECK_MS;
  const wait =
    delayMs > SKEW_TOLERANCE_MS
      ? // Outside the approach window: HALVE the remaining wait rather than
        // sleeping through it, so the detection lag scales with the skew. See
        // `SKEW_TOLERANCE_MS`.
        Math.min(delayMs - SKEW_TOLERANCE_MS, Math.ceil(delayMs / 2))
      : // Inside it: a minute, or the exact remaining time when that is sooner,
        // so a deadline five seconds away is still not re-read after sixty.
        Math.min(delayMs, MIN_RECHECK_MS);
  return Math.min(wait, MAX_REARM_MS);
}

export function nightDateLabel(nightKey: string): string {
  const [y, m, d] = nightKey.split('-').map(Number);
  if (!y || !m || !d) return nightKey;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function barLabel(barId: string): string {
  return getBarById(barId)?.name ?? barId;
}

