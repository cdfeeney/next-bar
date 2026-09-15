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
}: {
  plan: NightOut;
  isCancelled: boolean;
  isDeclined: boolean;
  isOwner: boolean;
  respondAs: (accept: boolean) => () => Promise<boolean>;
  withRefresh: (action: () => Promise<boolean>, capacityRefusable?: boolean) => () => Promise<void>;
}): JSX.Element {
  return (
    <>
      {!isCancelled ? (
        <section className="mt-6 flex justify-center gap-3">
          {plan.callerStatus === 'pending' ? (
            // An invited member accepts EXPLICITLY (viewing never mutates).
            <button
              type="button"
              onClick={withRefresh(respondAs(true))}
              className="rounded-full bg-white px-5 py-2 font-semibold text-black"
            >
              I&apos;m in
            </button>
          ) : null}
          {isDeclined ? (
            <button
              type="button"
              onClick={withRefresh(respondAs(true), true)}
              className="rounded-full border px-5 py-2"
            >
              Count me back in
            </button>
          ) : !isOwner ? (
            <button
              type="button"
              onClick={withRefresh(respondAs(false))}
              className="rounded-full border px-5 py-2"
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
              className="rounded-full border border-red-400 px-5 py-2 text-red-400"
            >
              Cancel night out
            </button>
          )}
        </section>
      ) : null}
    </>
  );
}
