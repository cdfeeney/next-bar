'use client';

/** S-07 split (pure move): the RSVP row — I'm in / Not tonight / Count me back in / Cancel night out. */
import { getBrowserSupabase } from '@/lib/supabase/client';
import { cancelNightOut, type NightOut } from '@/lib/nightOuts.server';

export default function RsvpRow({
  plan,
  isCancelled,
  isDeclined,
  isOwner,
  respondAs,
  withRefresh,
  variant = 'all',
}: {
  plan: NightOut;
  isCancelled: boolean;
  isDeclined: boolean;
  isOwner: boolean;
  respondAs: (accept: boolean) => () => Promise<boolean>;
  withRefresh: (action: () => Promise<boolean>, capacityRefusable?: boolean) => () => Promise<void>;
  /**
   * R-03 item 3: a pending invitee's "I'm in" is the primary action and belongs
   * ABOVE the shortlist, in the first viewport; the rest of the row stays at the
   * bottom by the footer. 'accept' renders only that button, 'rest' everything else.
   */
  variant?: 'all' | 'accept' | 'rest';
}): JSX.Element | null {
  if (isCancelled) return null;
  const showAccept = variant !== 'rest' && plan.callerStatus === 'pending';
  const showRest = variant !== 'accept';
  if (!showAccept && !showRest) return null;
  return (
    <>
      {(
        <section className="mt-6 flex justify-center gap-3" data-testid={`rsvp-row-${variant}`}>
          {showAccept ? (
            // An invited member accepts EXPLICITLY (viewing never mutates).
            <button
              type="button"
              onClick={withRefresh(respondAs(true))}
              className="inline-flex min-h-[44px] items-center rounded-full bg-accent px-6 font-display font-semibold text-bg touch-manipulation"
            >
              I&apos;m in
            </button>
          ) : null}
          {!showRest ? null : isDeclined ? (
            <button
              type="button"
              onClick={withRefresh(respondAs(true), true)}
              className="inline-flex min-h-[44px] items-center rounded-full border border-border px-5 touch-manipulation"
            >
              Count me back in
            </button>
          ) : !isOwner ? (
            <button
              type="button"
              onClick={withRefresh(respondAs(false))}
              className="inline-flex min-h-[44px] items-center rounded-full border border-border px-5 touch-manipulation"
            >
              Not tonight
            </button>
          ) : (
            <button
              type="button"
              onClick={withRefresh(() => {
                const supabase = getBrowserSupabase();
                return supabase
                  ? cancelNightOut(supabase, plan.id)
                  : Promise.resolve(false);
              })}
              className="inline-flex min-h-[44px] items-center rounded-full border border-red-400 px-5 text-red-400 touch-manipulation"
            >
              Cancel night out
            </button>
          )}
        </section>
      )}
    </>
  );
}
