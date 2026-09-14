'use client';

/**
 * Social → PLANS (Social redesign 2026-09-13, README §2). Everything about
 * plans and nothing else, top to bottom:
 *
 *   1. Your plan tonight — the plan THIS account started (V9-03: the owner is
 *      excluded from `get_my_night_outs`, so without this row a creator could
 *      not find their own plan again).
 *   2. Start a Night Out — the single way to create one (→ /auth signed out).
 *   3. When it is KNOWN there is no live plan: "Invitations you've been sent
 *      land here too. Nothing else lives on this tab."
 *   4. INVITED — invitations addressed to this account (`PlanInvites`, with
 *      I'm in / Not tonight) and the in-app invitation notifications that used
 *      to render inside Groups & people (`InvitedPlans`). ONE invitation, ONE
 *      row: a group invitation writes both a member row and a notification
 *      (0067), so the notification is hidden while its card is on the page and
 *      marked read once the card is answered.
 *   5. EARLIER NIGHTS — saved nights, each opening its recap.
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import PlanInvites, { type PlanInviteSummary } from '@/components/PlanInvites';
import EarlierNights from '@/app/nights/_components/EarlierNights';
import { useAuth } from '@/hooks/useAuth';
import InvitedPlans from './InvitedPlans';
import YourPlanTonight from './YourPlanTonight';

export default function PlansSection(): JSX.Element {
  const auth = useAuth();
  const signedOut = auth.status !== 'loading' && auth.status !== 'signed-in';
  // null = not known yet; the no-plan line waits for the read to settle.
  const [hasPlan, setHasPlan] = useState<boolean | null>(null);
  const [invitePlans, setInvitePlans] = useState<ReadonlyArray<PlanInviteSummary>>([]);
  const onPlansChange = useCallback((plans: ReadonlyArray<PlanInviteSummary>) => {
    setInvitePlans(plans);
  }, []);
  const carded = useMemo(
    () => new Set(invitePlans.map((plan) => plan.nightOutId)),
    [invitePlans],
  );
  const answered = useMemo(
    () => new Set(invitePlans.filter((plan) => plan.myStatus !== 'pending').map((plan) => plan.nightOutId)),
    [invitePlans],
  );

  return (
    <section aria-labelledby="plans-heading" className="space-y-3">
      <h2
        id="plans-heading"
        className="font-label text-xs font-bold uppercase tracking-[0.25em] text-muted mb-3.5"
      >
        Plans
      </h2>

      <YourPlanTonight variant="plans" onHasPlan={setHasPlan} />

      <Link
        href={signedOut ? '/auth' : '/friends/consensus'}
        data-testid="start-night-out"
        className="flex items-center gap-3.5 bg-surface border border-border rounded-3xl p-4 touch-manipulation min-h-[44px] hover:border-accent transition-colors"
      >
        <span
          aria-hidden="true"
          className="shrink-0 w-11 h-11 rounded-2xl bg-accent/15 text-accent font-display text-xl font-bold flex items-center justify-center"
        >
          +
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg font-bold leading-snug">
            Start a Night Out
          </span>
          <span className="block font-label text-[11px] uppercase tracking-[0.1em] text-muted mt-1">
            New plan · time, area, people
          </span>
        </span>
        <span aria-hidden="true" className="text-muted shrink-0">
          ›
        </span>
      </Link>

      {hasPlan === false || signedOut ? (
        <p data-testid="plans-empty-line" className="text-[13px] leading-relaxed text-muted pt-1.5">
          Invitations you&apos;ve been sent land here too. Nothing else lives on this tab.
        </p>
      ) : null}

      {/* Invitations addressed to this account, and the way into an accepted
          plan's shortlist. Renders nothing when there are none. */}
      <PlanInvites onPlansChange={onPlansChange} />
      <InvitedPlans cardedNightOutIds={carded} answeredNightOutIds={answered} />

      <EarlierNights />
    </section>
  );
}
