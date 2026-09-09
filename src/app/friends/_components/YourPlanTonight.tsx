'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getNightOut, type NightOut } from '@/lib/nightOuts.server';
import { nycNightKey } from '@/lib/nightKey';
import { forgetOwnedNightOut, recallOwnedNightOut } from '@/lib/ownedNightOut';

/**
 * V9-03 — "after starting a night I can no longer find it."
 *
 * Why this exists: `get_my_night_outs` deliberately excludes plans the caller
 * OWNS (0059_night_outs_respond_revision.sql:296), so `PlanInvites` can never
 * list a plan you created, and until now no surface did. When the Start button
 * creates a plan it now records it as tonight's owned plan (`ownedNightOut`,
 * localStorage keyed by account + night — distinct from the create-recovery
 * record, which the plan page spends on open). This card reads that record,
 * fetches the plan through the same `get_night_out` the plan page uses (RLS
 * decides, not the client), and links to it.
 *
 * States are distinct on purpose: nothing recorded → renders nothing; recorded
 * but the read failed → says so with a retry (never "no plans"); recorded but
 * the plan is gone or cancelled → forgets it and renders nothing.
 */
export default function YourPlanTonight(): JSX.Element | null {
  const auth = useAuth();
  const userId = auth.status === 'signed-in' ? auth.user.id : null;
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'failed' }
    | { kind: 'plan'; plan: NightOut }
    | { kind: 'none' }
  >({ kind: 'idle' });

  const load = useCallback(async (): Promise<void> => {
    if (userId === null) {
      setState({ kind: 'none' });
      return;
    }
    const owned = recallOwnedNightOut(userId, nycNightKey());
    if (owned === null) {
      setState({ kind: 'none' });
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setState({ kind: 'failed' });
      return;
    }
    setState({ kind: 'loading' });
    const plan = await getNightOut(supabase, owned.planId);
    if (plan === null) {
      // A failed READ is not "no plan": say so and offer a retry.
      setState({ kind: 'failed' });
      return;
    }
    if (plan.callerRole !== 'owner' || plan.status === 'cancelled' || plan.shareToken === null) {
      forgetOwnedNightOut(userId, owned.planId);
      setState({ kind: 'none' });
      return;
    }
    setState({ kind: 'plan', plan });
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'idle' || state.kind === 'none') return null;

  if (state.kind === 'loading') {
    return (
      <p role="status" className="text-sm text-muted" data-testid="your-plan-loading">
        Finding your plan…
      </p>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div
        role="alert"
        data-testid="your-plan-failed"
        className="flex items-center justify-between gap-3 bg-surface border border-border rounded-3xl px-4 py-3"
      >
        <span className="text-sm">Couldn&apos;t load the plan you started tonight.</span>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-[44px] px-4 rounded-full border border-border text-sm touch-manipulation"
        >
          Retry
        </button>
      </div>
    );
  }

  const { plan } = state;
  return (
    <Link
      href={`/night-out/${plan.shareToken}`}
      data-testid="your-plan-tonight"
      className="flex items-center gap-4 bg-surface border border-accent rounded-3xl px-4 py-4 touch-manipulation min-h-[44px]"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] uppercase tracking-widest text-muted">Your plan tonight</span>
        <span className="block font-display text-lg leading-snug truncate">
          {plan.title ?? 'Night Out'}
        </span>
        <span className="block text-xs text-muted mt-1">
          {plan.status === 'decided' ? 'Bar decided' : 'Open for suggestions'}
        </span>
      </span>
      <span aria-hidden="true" className="text-muted shrink-0">
        ›
      </span>
    </Link>
  );
}
