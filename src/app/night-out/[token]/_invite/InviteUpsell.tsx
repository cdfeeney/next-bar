'use client';

/** G-01 split (pure move): the optional account upsell after an answer. */
import type { RsvpChoice } from '../bearer';

export default function InviteUpsell({
  rsvp,
  signedIn,
  upsellDismissed,
  setUpsellDismissed,
  onSignIn,
}: {
  rsvp: RsvpChoice | null;
  signedIn: boolean;
  upsellDismissed: boolean;
  setUpsellDismissed: (next: boolean) => void;
  onSignIn: () => void;
}): JSX.Element {
  return (
    <>
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
    </>
  );
}
