'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getBarById } from '@/lib/catalog';
import type { NightOutPreview } from '@/lib/nightOuts.server';
import {
  RSVP_LABELS,
  RSVP_ORDER,
  clearQueuedRsvp,
  ensureRsvpKey,
  fetchAnonRsvp,
  fetchBearerAttendees,
  fetchBearerDetail,
  fetchBearerShortlist,
  queueRsvp,
  readQueuedRsvp,
  readRsvpKey,
  submitAnonRsvp,
  type BearerAttendee,
  type BearerDetail,
  type BearerShortlistEntry,
  type RsvpChoice,
} from './bearer';

/**
 * The bearer invitation surface (V8-R-INV-001 … V8-R-INV-004, D-C-23).
 *
 * WHAT THIS REPLACED, and why it is not a smaller change than it looks. The page
 * used to give a signed-out recipient the plan's date, its host and a headcount,
 * and then one button: "Sign in to join". D-C-23 explicitly SUPERSEDES the
 * frozen PRD sentence that pre-signup RSVP is not authorized, so requiring an
 * account before the recipient could answer at all was not a missing detail —
 * it was the requirement inverted:
 *
 *   V8-R-INV-001  "may VIEW the associated Night Out and SUBMIT AN RSVP
 *                  WITHOUT SIGNING UP"
 *   V8-R-INV-002  shows "who invited them, the plan name, time and area, who is
 *                  going, and the shortlist so far", and states in words what is
 *                  not visible before joining
 *   V8-R-INV-003  three choices: Going, Maybe, Can't make it
 *   V8-R-INV-004  an explicitly OPTIONAL signup upsell AFTER the RSVP
 *
 * WHAT IS STILL REFUSED, unchanged: voting, suggesting, and browsing private
 * application data. Those are V8-R-INV-001's own exclusions and every one of
 * them is enforced by the absence of an anon grant, not by this component.
 *
 * THE LIMITATION IS STATED, NOT DISCOVERED BY FAILURE. Both V8-R-INV-001 and
 * V8-R-INV-002 put that under accessibility, and it is the reason the sentence
 * below is unconditional rather than an error the recipient meets by tapping
 * something.
 */
export default function InvitePreview({
  token,
  preview,
  signedIn,
  onSignIn,
  children,
}: {
  token: string;
  /** The 0044 preview: night, title, status, host identity, accepted count. */
  preview: NightOutPreview;
  signedIn: boolean;
  /** Stores the invite handoff and routes to /auth. Signed-in path only. */
  onSignIn: () => void;
  /**
   * The signed-in, non-member actions (Join / Not tonight). They are the page's
   * because they need its epoch guard and its member loader; this component owns
   * the bearer half and renders theirs in place.
   */
  children?: React.ReactNode;
}): JSX.Element {
  const [detail, setDetail] = useState<BearerDetail | null>(null);
  const [attendees, setAttendees] = useState<BearerAttendee[] | null>(null);
  const [shortlist, setShortlist] = useState<BearerShortlistEntry[] | null>(
    null,
  );
  const [rsvp, setRsvp] = useState<RsvpChoice | null>(null);
  /**
   * An answer HELD but not delivered (V8-R-INV-003). Deliberately not folded
   * into `rsvp`: the host cannot see a queued answer, so showing it as the
   * recipient's RSVP would be the same lie as reporting a failed write.
   */
  const [queued, setQueued] = useState<RsvpChoice | null>(null);
  /**
   * TRUE when we could not read whether this recipient has already answered —
   * which is not the same as their not having answered. Answering again is
   * harmless (the write is an upsert on their own key), so this informs rather
   * than blocks: the controls stay live and the surface says it could not check.
   */
  const [rsvpUnreadable, setRsvpUnreadable] = useState(false);
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [upsellDismissed, setUpsellDismissed] = useState(false);

  /**
   * Which token's reads may paint. Next reuses this component across
   * `/night-out/A` → `/night-out/B` without remounting, so a read for A can
   * settle under B — the same defect the page's own `viewEpoch` exists for, and
   * the bearer reads are separate round trips that need their own copy of it.
   */
  const epoch = useRef(0);
  /**
   * Has the recipient answered IN THIS VIEW since the initial read started?
   *
   * The epoch alone does not cover this. The mount read and an RSVP write are
   * two round trips in the same view, and the read is issued first but need not
   * finish first: tap Going before `get_anon_rsvp_by_token` settles and its
   * answer — "no RSVP under this key", which was true when it was asked — lands
   * afterwards and clears the choice off the screen. The write DID land, so the
   * surface would then be telling the recipient they had not answered a plan
   * they had. A stale read may not overwrite a fresher local truth.
   */
  const answered = useRef(false);

  useEffect(() => {
    epoch.current += 1;
    answered.current = false;
    const startedAt = epoch.current;
    // The previous plan's answers belong to the previous plan.
    setDetail(null);
    setAttendees(null);
    setShortlist(null);
    setRsvp(null);
    setQueued(null);
    setRsvpUnreadable(false);
    setRsvpError(null);
    setUpsellDismissed(false);
    // ...INCLUDING THE IN-FLIGHT FLAG (round-3 panel, Claude gate). `answer()`
    // returns early on the epoch guard, which is right — its result belongs to
    // the invite that asked — but that return also skipped `setRsvpBusy(false)`,
    // and this effect reset everything except that one boolean. A write that
    // settled across a token change therefore left `rsvpBusy` true forever:
    // every RSVP control on the NEW invite rendered disabled and the re-entry
    // guard swallowed each tap, so that recipient could not answer at all
    // without a full reload. Next reuses this component across
    // /night-out/A → /night-out/B without remounting, so that path is the
    // ordinary one, not an edge.
    setRsvpBusy(false);

    const supabase = getBrowserSupabase();
    if (supabase === null) return;

    void (async () => {
      // READ ONLY WITH A KEY WE ALREADY HAVE. Minting one here would create a
      // recipient identity for somebody who only ever looked at the page.
      const key = readRsvpKey(token);
      const [nextDetail, nextAttendees, nextShortlist, storedRsvp] =
        await Promise.all([
          fetchBearerDetail(supabase, token),
          fetchBearerAttendees(supabase, token),
          fetchBearerShortlist(supabase, token),
          key === null
            ? Promise.resolve({ kind: 'none' as const })
            : fetchAnonRsvp(supabase, token, key),
        ]);
      if (startedAt !== epoch.current) return;
      setDetail(nextDetail);
      setAttendees(nextAttendees);
      setShortlist(nextShortlist);
      // The plan's own facts always apply; the RSVP does not, if the recipient
      // has answered since this read was issued. See `answered` above.
      if (!answered.current) {
        // THREE OUTCOMES, NOT TWO (round-4 panel, Claude gate). `failed` used
        // to land in the same branch as `none`, so a returning recipient whose
        // read hit a transport blip was shown the un-answered state — asked to
        // RSVP again to a plan they had already answered, with nothing on
        // screen saying the read had failed. That is the distinction
        // `RsvpRead` exists to carry.
        setRsvp(storedRsvp.kind === 'ok' ? storedRsvp.choice : null);
        setRsvpUnreadable(storedRsvp.kind === 'failed');
      }
    })();
  }, [token]);

  const answer = useCallback(
    async (choice: RsvpChoice): Promise<void> => {
      if (rsvpBusy) return;
      const startedAt = epoch.current;
      const supabase = getBrowserSupabase();
      const key = ensureRsvpKey(token);
      if (key === null) {
        // An answer under a key we cannot persist is one the recipient could
        // never see or change again — and one we could not retry either, since
        // the queue would have nothing to send it under. Say so instead.
        setRsvpError(
          "This browser won't let us remember your reply, so we haven't sent it.",
        );
        return;
      }
      setRsvpBusy(true);
      setRsvpError(null);
      const result =
        supabase === null
          ? // No client is the same shape of failure as no network: nothing
            // reached the server, so the answer is held rather than lost.
            ('unreachable' as const)
          : await submitAnonRsvp(supabase, token, key, choice);
      if (startedAt !== epoch.current) {
        setRsvpBusy(false);
        return;
      }
      if (result === 'sent') {
        answered.current = true;
        clearQueuedRsvp(token);
        setQueued(null);
        setRsvp(choice);
        setUpsellDismissed(false);
      } else if (result === 'unreachable') {
        // "An offline response is QUEUED and explicitly labelled as not yet
        // sent" (V8-R-INV-003, failure recovery). Held here and delivered by
        // the `online` listener below — and never shown as the recipient's
        // answer, because the host cannot see it yet.
        answered.current = true;
        const held = queueRsvp(token, choice);
        setQueued(held ? choice : null);
        setRsvpError(
          held
            ? "You're offline — we'll send this the moment you're back."
            : "That hasn't been sent yet — try again in a moment.",
        );
      } else {
        // REFUSED. The server answered and said no, so retrying cannot make it
        // land and queueing it would be a promise we cannot keep.
        setRsvpError("That hasn't been sent yet — try again in a moment.");
      }
      setRsvpBusy(false);
    },
    [rsvpBusy, token],
  );

  /**
   * Deliver a queued answer, on arrival and whenever the browser says it is
   * back online.
   *
   * Idempotent by construction: the RPC upserts on the recipient's own key, so
   * a delivery that lands twice is one row either way. That is what makes a
   * fire-on-reconnect retry safe without any de-duplication of its own.
   */
  useEffect(() => {
    const held = readQueuedRsvp(token);
    if (held !== null) setQueued(held);

    let cancelled = false;
    /**
     * THE QUEUE IS READ AT DELIVERY TIME, NOT AT MOUNT (round-4 panel, Codex).
     * This effect used to return early when the queue was empty on arrival —
     * which is the ordinary case — and so never installed the listener that the
     * "we'll send this the moment you're back" promise depends on. An answer
     * queued LATER in the same visit then sat there until a reload. The
     * listener is now unconditional and asks storage for the current answer
     * each time it fires.
     */
    const deliver = async (): Promise<void> => {
      const pending = readQueuedRsvp(token);
      if (pending === null) return;
      const supabase = getBrowserSupabase();
      const key = readRsvpKey(token);
      if (supabase === null || key === null) return;
      const startedAt = epoch.current;
      const result = await submitAnonRsvp(supabase, token, key, pending);
      if (cancelled || startedAt !== epoch.current) return;
      if (result === 'sent') {
        answered.current = true;
        clearQueuedRsvp(token);
        setQueued(null);
        setRsvp(pending);
        setRsvpError(null);
      } else if (result === 'refused') {
        // The plan moved on — cancelled, or the link expired. Holding this
        // forever would keep telling the recipient it is about to be sent.
        clearQueuedRsvp(token);
        setQueued(null);
        setRsvpError("That hasn't been sent yet — try again in a moment.");
      }
      // 'unreachable' keeps the queue exactly as it is, for the next event.
    };

    // An answer held from a previous visit goes out now; one queued during this
    // visit goes out on the next `online`.
    if (held !== null) void deliver();
    const onOnline = (): void => void deliver();
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
    };
  }, [token]);

  const host =
    preview.ownerDisplayName ?? preview.ownerHandle ?? 'A friend';
  // `getBarById` answers undefined for a bar the catalog no longer carries, so
  // this narrows to a definite value rather than rendering "It's decided:"
  // followed by nothing.
  const decidedBar =
    detail?.decidedBarId != null
      ? (getBarById(detail.decidedBarId) ?? null)
      : null;

  return (
    <main className="min-h-screen px-6 py-10 pb-28" data-testid="invite-preview">
      <p className="text-center text-sm uppercase tracking-wide opacity-60">
        You&apos;re invited
      </p>
      <h1 className="mt-2 text-center text-2xl font-semibold">
        {preview.title ?? `${host}'s night out`}
      </h1>

      {/* WHO INVITED THEM, AND WHEN AND WHERE (V8-R-INV-002). The time is the
          server's scheduled start; nothing here computes an hour. */}
      <p className="mt-2 text-center opacity-80" data-testid="invite-when">
        {detail === null
          ? nightDateLabel(preview.night)
          : startLabel(detail.startsAt)}
      </p>
      <p className="mt-1 text-center text-sm opacity-60">
        Hosted by {host}
      </p>
      {/* WHERE, in the two forms the plan can answer it. The AREA is the
          plan's own (V8-R-NO-003) and is there while it is still choosing; the
          decided bar arrives later and replaces nothing — a plan can have both.
          Round 4 rendered only the bar, so a recipient of an open plan was told
          nothing about where (round-4 panel, Codex). */}
      {detail?.area != null ? (
        <p className="mt-1 text-center text-sm opacity-80" data-testid="invite-area">
          Around {detail.area}
        </p>
      ) : null}
      {decidedBar !== null ? (
        <p className="mt-1 text-center text-sm" data-testid="invite-where">
          It&apos;s decided: {decidedBar.name}
        </p>
      ) : null}

      {/* THE RSVP — the whole point of D-C-23, and it comes before the account
          conversation rather than behind it. */}
      <section className="mt-6" data-testid="invite-rsvp">
        <h2 className="text-center text-sm font-semibold">Can you make it?</h2>
        <div
          className="mt-3 flex flex-wrap justify-center gap-2"
          role="group"
          aria-label="Can you make it?"
        >
          {RSVP_ORDER.map((choice) => (
            <button
              key={choice}
              type="button"
              // PRESSED means SENT. A queued answer is shown separately, in
              // words, because the host cannot see it yet.
              aria-pressed={rsvp === choice}
              disabled={rsvpBusy}
              onClick={() => void answer(choice)}
              data-testid={`invite-rsvp-${choice}`}
              className={[
                'inline-flex min-h-[44px] touch-manipulation items-center rounded-full border px-5 text-sm disabled:opacity-60',
                rsvp === choice
                  ? 'border-white font-semibold'
                  : queued === choice
                    ? 'border-dashed'
                    : 'opacity-80',
              ].join(' ')}
            >
              {RSVP_LABELS[choice]}
            </button>
          ))}
        </div>
        {rsvp !== null ? (
          <p
            className="mt-3 text-center text-sm opacity-70"
            role="status"
            data-testid="invite-rsvp-sent"
          >
            {rsvp === 'going'
              ? "You're down as going. Change it any time."
              : rsvp === 'maybe'
                ? "You're down as a maybe. Change it any time."
                : "You're down as can't make it. Change it any time."}
          </p>
        ) : null}
        {/* WE COULD NOT CHECK whether you already answered — which is not the
            same as your not having answered, and saying nothing would ask you
            to reply again to a plan you may have replied to. */}
        {rsvpUnreadable && rsvp === null && queued === null ? (
          <p
            className="mt-3 text-center text-sm opacity-70"
            role="status"
            data-testid="invite-rsvp-unreadable"
          >
            Couldn&apos;t check whether you already replied. Answering again is
            fine — it replaces your last one.
          </p>
        ) : null}

        {/* HELD, AND SAID SO IN WORDS. V8-R-INV-003's failure clause is that an
            offline response is "queued and explicitly labelled as not yet
            sent" — the label is the requirement, not a nicety. */}
        {queued !== null && rsvp === null ? (
          <p
            className="mt-3 text-center text-sm opacity-70"
            role="status"
            data-testid="invite-rsvp-queued"
          >
            {RSVP_LABELS[queued]} — not sent yet. We&apos;ll send it as soon as
            you&apos;re back online.
          </p>
        ) : null}
        {rsvpError !== null ? (
          <p
            className="mt-3 text-center text-sm text-red-400"
            role="status"
            data-testid="invite-rsvp-error"
          >
            {rsvpError}
          </p>
        ) : null}
      </section>

      {/* V8-R-INV-004. Explicitly optional, and it says the RSVP is safe either
          way — an upsell that leaves the recipient unsure whether dismissing it
          costs them their reply is not optional in practice. Signed-in visitors
          never see it: they already have the account it is selling. */}
      {rsvp !== null && !signedIn && !upsellDismissed ? (
        <section
          className="mt-6 rounded-2xl border px-4 py-4 text-center"
          data-testid="invite-upsell"
        >
          <p className="text-sm">
            You&apos;re RSVP&apos;d either way. An account adds voting on the
            shortlist, suggesting a bar, and live updates as the plan changes.
          </p>
          <div className="mt-3 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={onSignIn}
              data-testid="invite-upsell-signup"
              className="inline-flex min-h-[44px] touch-manipulation items-center rounded-full bg-white px-6 font-semibold text-black"
            >
              Create an account
            </button>
            <button
              type="button"
              onClick={() => setUpsellDismissed(true)}
              data-testid="invite-upsell-dismiss"
              className="inline-flex min-h-[44px] touch-manipulation items-center text-sm underline underline-offset-4"
            >
              Maybe later
            </button>
          </div>
        </section>
      ) : null}

      {/* WHO IS GOING (V8-R-INV-002). Display identities only — the RPC returns
          no account ids at all. */}
      <section className="mt-8">
        <h2 className="font-semibold">
          Who&apos;s in ({preview.acceptedCount})
        </h2>
        {attendees === null ? (
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

      {/* THE LIMITATION, IN WORDS, ON THE SCREEN. */}
      <p className="mt-8 text-sm opacity-60" data-testid="invite-limitation">
        Until you join, you can see this plan and answer it — voting on the
        shortlist, suggesting a bar, and everyone&apos;s saved bars, ratings and
        full profiles stay inside the app.
      </p>

      {signedIn ? (
        <div className="mt-6">{children}</div>
      ) : (
        <button
          type="button"
          onClick={onSignIn}
          data-testid="invite-sign-in"
          className="mt-6 inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center rounded-full border px-6 text-sm"
        >
          Sign in to join
        </button>
      )}
    </main>
  );
}

/** "Friday, July 24" from a night key, when the scheduled start is unreadable. */
function nightDateLabel(nightKey: string): string {
  const [y, m, d] = nightKey.split('-').map(Number);
  if (!y || !m || !d) return nightKey;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * "Friday, July 24 at 9:00 PM" — the SERVER's scheduled start, rendered in the
 * contract's zone.
 *
 * America/New_York rather than the device's: the plan's 9:00 PM is a fact about
 * the night, and showing a recipient in another zone their own local hour for it
 * would be a different claim than the one the plan makes.
 */
function startLabel(startsAt: string): string {
  const at = new Date(startsAt);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(at);
}
