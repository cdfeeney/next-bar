'use client';

/**
 * Social → Plans — the invitee-facing surface for Night Out invitations.
 *
 * Design: next-bar-night-out-invite-recipient-v1.dc.html, **Part B**, approved
 * 2026-08-16 (next-bar-approved-decisions-addendum-20260816.md). Part A — the
 * deep-link guest RSVP before signup — is a separate future goal and none of it
 * is built here.
 *
 * Why this exists: until 0052 there was no query that could answer "what am I
 * invited to?", so an account-targeted invitation created a `pending` row its
 * recipient could never see. This is the surface that makes half of acceptance
 * criterion 2 reachable.
 *
 * Card states, exactly the five approved for build:
 *   pending          → Accept / Decline
 *   accepted (just)  → green confirmation, then the plan card
 *   accepted (prior) → "Accepted" badge, already-responded copy
 *   plan updated     → "Updated" badge
 *   expired          → "Expired" badge, Dismiss
 *
 * Deliberately NOT built (approved as drawn, deferred with the revoke feature):
 * the revoked and offline-queued states.
 *
 * Two decisions worth stating rather than leaving to be inferred:
 *   - DECLINED rows are omitted. The approved design draws no declined card,
 *     and declining is how a card leaves your list. Inventing a state would
 *     contradict "as drawn".
 *   - Dismiss on an expired card is session-local. There is no server-side
 *     dismissed flag, and adding one is not in this goal's scope.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getMyNightOuts, respondNightOut, type MyNightOut } from '@/lib/nightOuts.server';

function nightLabel(plan: MyNightOut): string {
  const parts = [plan.title ?? 'Night Out', plan.night];
  return parts.filter(Boolean).join(' · ');
}

function inviterLabel(plan: MyNightOut): string {
  const who = plan.ownerDisplayName ?? (plan.ownerHandle ? `@${plan.ownerHandle}` : 'Someone');
  return `${who} invited you`;
}

export default function PlanInvites(): JSX.Element | null {
  const auth = useAuth();
  const router = useRouter();
  const [plans, setPlans] = useState<MyNightOut[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [justAccepted, setJustAccepted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setPlans(await getMyNightOuts(supabase));
  }, []);

  useEffect(() => {
    if (auth.status !== 'signed-in') {
      setPlans(null);
      return;
    }
    void load();
  }, [auth.status, load]);

  const respond = async (planId: string, accept: boolean): Promise<void> => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusy(planId);
    setError(null);
    const ok = await respondNightOut(supabase, planId, accept);
    setBusy(null);
    if (!ok) {
      setError("That didn't go through — try again.");
      return;
    }
    if (accept) setJustAccepted((prev) => new Set(prev).add(planId));
    await load();
  };

  if (auth.status !== 'signed-in' || plans === null) return null;

  // Declined rows leave the list; dismissed expired cards leave for this
  // session. Hidden when empty, matching the Requests consent inbox on this
  // same page rather than inventing an empty state (that belongs to the
  // deferred operational-states work).
  const visible = plans.filter(
    (p) => p.myStatus !== 'declined' && !dismissed.has(p.nightOutId),
  );
  if (visible.length === 0) return null;

  return (
    <div data-testid="plan-invites">
      <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
        Plans · {visible.length}
      </h2>
      {error !== null ? (
        <p className="mb-3 text-sm text-red-400" role="status">
          {error}
        </p>
      ) : null}
      <div className="space-y-3">
        {visible.map((plan) => {
          const viewPlan = (): void => {
            if (plan.shareToken !== null) router.push(`/night-out/${plan.shareToken}`);
          };

          if (plan.isPast) {
            return (
              <div
                key={plan.nightOutId}
                data-testid="invite-expired"
                className="bg-surface border border-border rounded-2xl px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <span className="rounded-full border border-red-500/35 bg-red-500/10 px-2 py-1 text-[10.5px] font-semibold text-red-400">
                    Expired
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-sm">This invite has expired</p>
                    <p className="text-xs text-muted truncate">
                      {nightLabel(plan)} already happened
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDismissed((prev) => new Set(prev).add(plan.nightOutId))
                  }
                  className="mt-3 w-full rounded-full border border-border py-2 text-sm touch-manipulation"
                >
                  Dismiss
                </button>
              </div>
            );
          }

          if (plan.myStatus === 'pending') {
            return (
              <div
                key={plan.nightOutId}
                data-testid="invite-pending"
                className="bg-surface border border-border rounded-2xl px-4 py-3"
              >
                <p className="font-display text-sm">{inviterLabel(plan)}</p>
                <p className="text-xs text-muted truncate">{nightLabel(plan)}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy === plan.nightOutId}
                    onClick={() => void respond(plan.nightOutId, true)}
                    className="flex-1 rounded-full bg-accent py-2 text-sm font-semibold text-black touch-manipulation disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={busy === plan.nightOutId}
                    onClick={() => void respond(plan.nightOutId, false)}
                    className="flex-1 rounded-full border border-border py-2 text-sm touch-manipulation disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </div>
            );
          }

          if (justAccepted.has(plan.nightOutId)) {
            return (
              <div key={plan.nightOutId} data-testid="invite-accepted-confirm">
                <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2.5 text-sm font-semibold text-emerald-400">
                  You accepted — see you {plan.night}
                </div>
                <div className="mt-2 bg-surface border border-border rounded-2xl px-4 py-3">
                  <p className="font-display text-sm truncate">{nightLabel(plan)}</p>
                  <p className="text-xs text-muted">{plan.acceptedCount} going</p>
                  <button
                    type="button"
                    onClick={viewPlan}
                    className="mt-3 w-full rounded-full border border-border py-2 text-sm touch-manipulation"
                  >
                    View plan
                  </button>
                </div>
              </div>
            );
          }

          const updated = plan.planUpdated;
          return (
            <div
              key={plan.nightOutId}
              data-testid={updated ? 'invite-updated' : 'invite-responded'}
              className="bg-surface border border-border rounded-2xl px-4 py-3"
            >
              <div className="flex items-start gap-3">
                <span className="rounded-full border border-border bg-muted/15 px-2 py-1 text-[10.5px] font-semibold text-muted">
                  {updated ? 'Updated' : 'Accepted'}
                </span>
                <div className="min-w-0">
                  <p className="font-display text-sm truncate">
                    {updated ? 'Plan changed' : nightLabel(plan)}
                  </p>
                  <p className="text-xs text-muted truncate">
                    {updated
                      ? `${nightLabel(plan)} was updated`
                      : 'You already accepted this invite'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={viewPlan}
                className="mt-3 w-full rounded-full border border-border py-2 text-sm touch-manipulation"
              >
                View plan
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
