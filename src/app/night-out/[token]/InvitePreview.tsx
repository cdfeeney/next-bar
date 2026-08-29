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
  /**
   * The in-flight lock, holding WHICH INVITE it belongs to — not a boolean.
   *
   * `rsvpBusy` drives the disabled attribute and must be state; the automatic
   * queued delivery needs to read and set the same mutual exclusion from
   * outside React's render cycle, where a state value read from a stale closure
   * would be worthless. Both writers take this one.
   *
   * WHY A TOKEN AND NOT A FLAG (round-10 round 4, Codex). Two earlier fixes
   * pulled in opposite directions on a boolean and it could not satisfy both.
   * Round 9: a request for the PREVIOUS invite that never settled held the flag,
   * so the next invite rendered enabled buttons whose every tap returned at the
   * guard — so the flag was cleared on every token change. Round 10: clearing it
   * meant navigating A → B → A could start a SECOND write for A while A's first
   * was still out, and the upsert is last-write-wins, so the earlier choice
   * could land last while the screen showed the later one.
   *
   * A token settles both. A write is refused only while one for THE SAME invite
   * is outstanding, so a different invite is never blocked by it; and a release
   * only ever clears the holder's own hold, so a settling write for A cannot
   * unlock B.
   *
   * A SET, not one token (round-10 round 5, Codex). A single slot could only
   * remember the most recent holder, so taking B's lock FORGOT that A's write
   * was still out — and returning to A then started a second one, which is the
   * defect the token was introduced to stop. Writes for different invites can
   * genuinely overlap, so the lock has to be able to say so.
   */
  const rsvpInFlight = useRef<Set<string>>(new Set());
  /**
   * The invite ON SCREEN right now, readable from a settling write's closure.
   *
   * A write that settles after the recipient has come BACK to its own invite
   * takes the stale branch — the epoch moved twice, so it may not paint — but
   * it is releasing the very hold that is disabling the buttons in front of
   * them. Without re-deriving `rsvpBusy` there, the set empties and the state
   * stays true, and all three controls are disabled with no message until a
   * reload (round-10 round 6, both lanes). The token-change effect cannot help:
   * the token did not change.
   */
  const liveToken = useRef(token);
  liveToken.current = token;

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
    // THE LOCK ITSELF IS NOT CLEARED HERE (round-10 round 4, Codex). Round 9
    // cleared it, because as a boolean it was the same lock for every invite
    // and a stuck one made the next invite unanswerable. Now that it names its
    // invites, clearing on a token change is exactly the bug: coming back to A
    // while A's write is still out would start a second one. Each hold lasts
    // until the write it belongs to settles, and a hold for another invite does
    // not block this one.
    //
    // BUT `rsvpBusy` IS DERIVED FROM IT, not blindly cleared (round-10 round 5,
    // Claude). Setting it false while this invite's write was still outstanding
    // rendered three enabled buttons whose every tap the guard swallowed in
    // silence — no disable, no message, nothing — which is precisely what this
    // component says elsewhere must never be offered. Returning to an invite
    // that is still busy now looks busy.
    setRsvpBusy(rsvpInFlight.current.has(token));

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
      // The REF, not the state: an automatic queued delivery holds the same
      // lock and does not go through a render to take it. Compared against THIS
      // invite, so a write still out for a different one never blocks this.
      if (rsvpBusy || rsvpInFlight.current.has(token)) return;
      const heldToken = token;
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
      // MARKED ANSWERED BEFORE THE AWAIT. The automatic queued delivery stands
      // down on this flag, and it has to be set at the moment of the tap — not
      // when the tap's round trip returns — or the delivery can start in
      // between and overwrite what the recipient just asked for.
      answered.current = true;
      rsvpInFlight.current.add(heldToken);
      setRsvpBusy(true);
      setRsvpError(null);
      const result =
        supabase === null
          ? // No client is the same shape of failure as no network: nothing
            // reached the server, so the answer is held rather than lost.
            ('unreachable' as const)
          : await submitAnonRsvp(supabase, token, key, choice);
      if (startedAt !== epoch.current) {
        // A STALE WRITE RELEASES ONLY ITS OWN HOLD, and paints nothing. It has
        // genuinely settled, so a later write for the SAME invite is safe to
        // allow — and holds for other invites are untouched, which is why the
        // lock is a set rather than one slot.
        rsvpInFlight.current.delete(heldToken);
        // If the invite it belonged to is the one back on screen, the buttons
        // it was disabling have to come back with it.
        if (liveToken.current === heldToken) setRsvpBusy(false);
        // ...AND IT STILL SPENDS THE QUEUE (round-10 round 5, Claude). This
        // branch returned before the `sent` handling below, so a successful
        // write that settled after a token change left an OLDER queued answer
        // in storage. Coming back to that invite auto-delivered it, and the
        // last-write-wins upsert replaced the recipient's newer answer — the
        // same older-answer-lands-last defect the queue lock exists to stop,
        // reached through the stale door. A sent answer is sent whoever is on
        // screen, so the queue it satisfies is spent here too.
        if (result === 'sent') clearQueuedRsvp(heldToken);
        return;
      }
      rsvpInFlight.current.delete(heldToken);
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
        //
        // AND THE COPY SAYS SO (round-6 panel, Codex, MEDIUM). This branch used
        // the offline sentence — "not sent yet, try again in a moment" — for an
        // answer the server had already declined. Every reason it declines is
        // durable: the invitation has expired, the plan was cancelled, or the
        // plan's link replies have hit their cap. "In a moment" is a retry that
        // cannot succeed, which is the same defect round 5 closed on the
        // expired surface. The one forward path that does work is telling the
        // host, so that is what it offers.
        //
        // AND THE QUEUE GOES WITH IT (round-7 panel, Codex, MEDIUM). Only the
        // DELIVERY path cleared the queue on a refusal; a refused TAP left an
        // older held answer in place, so the surface said this invitation could
        // record nothing AND that a different answer was still about to be
        // sent. Every reason the server refuses is a property of the plan, not
        // of the answer, so the held one cannot land either.
        clearQueuedRsvp(token);
        setQueued(null);
        setRsvpError(
          "We couldn't record that — this invitation may have expired. Let the host know directly.",
        );
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
      // THE TWO WRITERS TAKE ONE LOCK (round-5 panel, both lanes). This
      // delivery and `answer()` upsert the same row, and neither waited for the
      // other: queue Maybe offline, reload, tap Going before the automatic
      // delivery settles, and the stale queued value could land last — on the
      // server AND on screen, reporting the older answer as the one on record.
      //
      // The queue always holds the recipient's LATEST offline choice (it is
      // overwritten, never appended), so delivering whatever is in it is
      // correct; what was missing is that the two writers must not overlap, and
      // that a delivery must not paint a value the recipient has since changed.
      if (rsvpInFlight.current.has(token)) return;
      const pending = readQueuedRsvp(token);
      if (pending === null) return;
      const supabase = getBrowserSupabase();
      const key = readRsvpKey(token);
      if (supabase === null || key === null) return;
      const heldToken = token;
      const startedAt = epoch.current;
      rsvpInFlight.current.add(heldToken);
      // Visibly in flight, exactly as a tap is: the controls disable for the
      // moment the delivery holds the lock, so the recipient is never offered a
      // tap that the guard would silently swallow.
      setRsvpBusy(true);
      const result = await submitAnonRsvp(supabase, token, key, pending);
      // Same rule as `answer()` above: a delivery that settles after the invite
      // changed paints nothing and releases only its OWN hold, never whatever
      // the invite now on screen may be holding.
      if (cancelled || startedAt !== epoch.current) {
        rsvpInFlight.current.delete(heldToken);
        // Same two rules as the stale branch in `answer()`: give the controls
        // back if this invite is the one on screen, and spend the queue a sent
        // answer satisfied wherever the viewer has gone.
        if (liveToken.current === heldToken) setRsvpBusy(false);
        if (result === 'sent') clearQueuedRsvp(heldToken);
        return;
      }
      rsvpInFlight.current.delete(heldToken);
      setRsvpBusy(false);
      // The queue moved on while we were away — the recipient answered again,
      // and that newer choice is the one that must be sent and shown.
      if (readQueuedRsvp(token) !== pending) {
        void deliver();
        return;
      }
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
        setRsvpError(
          "We couldn't record that — this invitation may have expired. Let the host know directly.",
        );
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
