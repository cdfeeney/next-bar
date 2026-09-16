'use client';

/** G-01 split (pure move): "Can you make it?" — the guest's name, the three choices, and every notice. */
import { GUEST_NAME_MAX, RSVP_LABELS, RSVP_ORDER, type RsvpChoice } from '../bearer';

export default function InviteRsvp({
  guestName,
  setGuestName,
  nameMissing,
  setNameMissing,
  rsvp,
  queued,
  rsvpBusy,
  rsvpError,
  rsvpUnreadable,
  answer,
}: {
  guestName: string;
  setGuestName: (next: string) => void;
  nameMissing: boolean;
  setNameMissing: (next: boolean) => void;
  rsvp: RsvpChoice | null;
  queued: RsvpChoice | null;
  rsvpBusy: boolean;
  rsvpError: string | null;
  rsvpUnreadable: boolean;
  answer: (choice: RsvpChoice) => Promise<void>;
}): JSX.Element {
  return (
    <>

        {/* THE RSVP — the whole point of D-C-23, and it comes before the account
            conversation rather than behind it. */}
        <section className="mt-6" data-testid="invite-rsvp">
          <h2 className="text-center text-sm font-semibold">Can you make it?</h2>
          {/* G-01: the guest says who they are. Going and Maybe carry it, here
              and on the server (0080); "Can't make it" may stay anonymous. */}
          <div className="mx-auto mt-3 max-w-xs">
            <label htmlFor="guest-name" className="sr-only">Your name</label>
            <input
              id="guest-name"
              type="text"
              value={guestName}
              maxLength={GUEST_NAME_MAX}
              placeholder="Your name"
              disabled={rsvpBusy}
              onChange={(event) => {
                setGuestName(event.target.value);
                if (event.target.value.trim() !== '') setNameMissing(false);
              }}
              className="min-h-[44px] w-full rounded-full border px-4 text-center text-sm"
            />
            {nameMissing ? (
              <p className="mt-2 text-center text-sm text-red-400" role="status" data-testid="invite-name-missing">
                Add your name so they know who&apos;s coming.
              </p>
            ) : null}
          </div>
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
              {/* G-01 acceptance 1: the confirmation names the guest when we
                  have one (Going / Maybe always do; a nameless "can't make it"
                  keeps the old wording). */}
              {rsvp === 'going'
                ? guestName.trim() !== ''
                  ? `You're in as ${guestName.trim()}. Change it any time.`
                  : "You're down as going. Change it any time."
                : rsvp === 'maybe'
                  ? guestName.trim() !== ''
                    ? `You're a maybe as ${guestName.trim()}. Change it any time.`
                    : "You're down as a maybe. Change it any time."
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
              sent" — the label is the requirement, not a nicety.

              IT IS SHOWN WHENEVER THE HELD ANSWER DIFFERS FROM THE ONE ON RECORD,
              not only when there is none (round-10 round 9, Codex). The condition
              was `rsvp === null`, which is right for a first answer and silently
              wrong for a CHANGED one: a recipient whose server answer is Maybe
              and who then queues Going offline saw Maybe pressed, Going marked by
              a dashed border alone, and no words anywhere saying Going had not
              been sent. "Explicitly labelled" is not satisfied by a border, and
              colour-or-shape alone is exactly what the requirement rules out.
              When the two agree there is nothing outstanding to narrate. */}
          {queued !== null && queued !== rsvp ? (
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
    </>
  );
}
