'use client';

/**
 * Social → Plans, per `docs/design-reference/approved/next-bar-social-v2-core.png`
 * (screen 3A, "shortlist vote").
 *
 * The canvas's own note: "Start a Night Out closes the creation gap. The
 * compact entry sits directly under the sub-tabs and above the open plan, so
 * the same one tap works with one plan open and with zero plans, where it
 * becomes the empty state's single primary action."
 *
 * Two things this screen draws are deliberately NOT rebuilt here, because they
 * already exist and criterion 11 says preserve, not duplicate:
 *
 *  - The SHORTLIST · VOTE board (suggest / ▲ vote / lock) is the live
 *    `/night-out/[token]` surface over `get_night_out_board`,
 *    `suggest_night_out_bar` and `vote_night_out_bar`. `PlanInvites` already
 *    routes an accepted plan straight into it.
 *  - Plan CREATION with its people picker is `StartNightOutButton`, which
 *    needs a settled invitee list and therefore lives on the group screen it
 *    is selected from. The card here is the entry point into that flow.
 */

import Link from 'next/link';
import PlanInvites from '@/components/PlanInvites';

export default function PlansSection(): JSX.Element {
  return (
    <section aria-labelledby="plans-heading" className="space-y-3">
      <h2
        id="plans-heading"
        className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3"
      >
        Plans
      </h2>

      <Link
        href="/friends/consensus"
        className="flex items-center gap-4 bg-surface border border-border rounded-3xl px-4 py-4 touch-manipulation min-h-[44px] hover:border-accent transition-colors"
      >
        <span
          aria-hidden="true"
          className="shrink-0 w-11 h-11 rounded-2xl bg-accent/15 text-accent font-display text-xl flex items-center justify-center"
        >
          +
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg leading-snug">
            Start a Night Out
          </span>
          <span className="block text-[11px] uppercase tracking-widest text-muted mt-1">
            New plan · time, area, people
          </span>
        </span>
        <span aria-hidden="true" className="text-muted shrink-0">
          ›
        </span>
      </Link>

      {/* Invitations addressed to this account, and the way into an accepted
          plan's shortlist. Renders nothing when there are none. */}
      <PlanInvites />
    </section>
  );
}
