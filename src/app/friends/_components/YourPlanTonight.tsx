'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getBarById } from '@/lib/catalog';
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
 * TWO FACES (Social redesign 2026-09-13, README §1.4 and §2.1):
 *   - `variant="tonight"` is Tonight's PRIMARY element, the plan card. It always
 *     renders: a live plan as the accent gradient card, otherwise the "No plan
 *     yet." box with the Start CTA (signed out, the CTA goes to /auth).
 *   - `variant="plans"` (default) is the compact row on the Plans sub-tab and
 *     renders nothing when nothing was started, as before.
 *
 * States are distinct on purpose: recorded but the read failed → says so with
 * a retry (never "no plans"); recorded but the plan is gone or cancelled →
 * forgets it and renders the no-plan state.
 *
 * `get_night_out` carries no member, vote or area counts, so the card names
 * only what it knows — title, night, status and the decided bar — rather than
 * inventing "4 going · 3 of 4 voted".
 */
export default function YourPlanTonight({
  variant = 'plans',
  onHasPlan,
}: {
  variant?: 'tonight' | 'plans';
  /** Plans uses this to show its no-plan line only when there is no live plan. */
  onHasPlan?: (hasPlan: boolean) => void;
} = {}): JSX.Element | null {
  const auth = useAuth();
  const userId = auth.status === 'signed-in' ? auth.user.id : null;
  const signedOut = auth.status !== 'loading' && auth.status !== 'signed-in';
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'failed' }
    | { kind: 'plan'; plan: NightOut }
    | { kind: 'none' }
  >({ kind: 'idle' });

  // The rendered state belongs to ONE account. When the account changes in
  // place, reset synchronously — during this very render, before anything is
  // committed — so not even one frame of the previous account's plan (and its
  // bearer link) reaches the screen. The epoch below then guards the async
  // part (round-1 and round-2 panels, Codex).
  const [stateFor, setStateFor] = useState<string | null>(userId);
  if (stateFor !== userId) {
    setStateFor(userId);
    setState({ kind: 'idle' });
  }
  // Every load is stamped; a result that arrives after the account changed,
  // after a newer load started, or after unmount is dropped on the floor.
  const epoch = useRef(0);
  const load = useCallback(async (): Promise<void> => {
    const mine = ++epoch.current;
    const live = (): boolean => epoch.current === mine;
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
    if (!live()) return;
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
    return () => {
      epoch.current += 1;
    };
  }, [load]);

  useEffect(() => {
    onHasPlan?.(state.kind === 'plan');
  }, [state.kind, onHasPlan]);

  if (state.kind === 'idle' || state.kind === 'none') {
    return variant === 'tonight' ? <NoPlanCard signedOut={signedOut} /> : null;
  }

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
  if (variant === 'tonight') return <PlanCard plan={plan} />;

  // README §2.1: title 18px/700 ("Open for votes" / "<Bar> · locked in"), then
  // the plan's name and night as the meta line.
  const decided = plan.status === 'decided' && plan.decidedBarId ? getBarById(plan.decidedBarId) : null;
  return (
    <Link
      href={`/night-out/${plan.shareToken}`}
      data-testid="your-plan-tonight"
      className="flex items-center gap-3.5 bg-surface border border-accent rounded-3xl p-4 touch-manipulation min-h-[44px]"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-label text-[11px] uppercase tracking-[0.14em] text-muted">
          Your plan tonight
        </span>
        <span className="block font-display text-lg font-bold leading-snug mt-1 truncate">
          {plan.status === 'decided'
            ? `${decided?.name ?? 'Bar'} · locked in`
            : 'Open for votes'}
        </span>
        <span className="block text-xs text-muted mt-1 truncate">
          {plan.title ?? 'Night Out'} · {weekdayOf(plan.night)}
        </span>
      </span>
      <span aria-hidden="true" className="text-muted shrink-0">
        ›
      </span>
    </Link>
  );
}

/** Tonight's plan card with a live plan (README §1.4, "with a plan"). */
function PlanCard({ plan }: { plan: NightOut }): JSX.Element {
  const decidedBar = plan.decidedBarId ? getBarById(plan.decidedBarId) : null;
  const title = plan.title ?? `${weekdayOf(plan.night)} · Night out`;
  const meta =
    plan.status === 'decided'
      ? decidedBar
        ? `Decided · ${decidedBar.name}`
        : 'Decided'
      : 'Open for votes';
  const lead =
    plan.status === 'decided'
      ? decidedBar
        ? `${decidedBar.name} is the pick`
        : 'The bar is picked'
      : 'Everyone votes on where';
  return (
    <Link
      href={`/night-out/${plan.shareToken}`}
      data-testid="your-plan-tonight"
      data-plan-state={plan.status}
      className="block w-full p-5 rounded-[28px] border border-accent text-text touch-manipulation"
      style={{ background: 'linear-gradient(180deg, rgba(255,91,58,0.14), #141414)' }}
    >
      <span className="block font-label text-[10px] font-bold uppercase tracking-[0.22em] text-accent">
        Your plan tonight
      </span>
      <span className="block font-display text-[26px] font-bold leading-[1.15] mt-2.5 truncate">
        {title}
      </span>
      <span className="block text-[13px] text-muted mt-1.5">{meta}</span>
      <span
        className="flex items-center justify-between mt-4 pt-3.5 border-t"
        style={{ borderColor: 'rgba(255,91,58,0.35)' }}
      >
        <span className="text-sm font-semibold">{lead}</span>
        <span className="font-label text-xs font-bold uppercase tracking-[0.1em] text-accent">
          Open ›
        </span>
      </span>
    </Link>
  );
}

/** Tonight's plan card with no plan (README §1.4, "without"). */
function NoPlanCard({ signedOut }: { signedOut: boolean }): JSX.Element {
  return (
    <div
      data-testid="your-plan-none"
      className="w-full px-5 py-[22px] rounded-[28px] border border-border bg-surface"
    >
      <p className="font-label text-[10px] font-bold uppercase tracking-[0.22em] text-muted">
        Tonight
      </p>
      <p className="font-display text-2xl font-bold leading-tight mt-2.5">No plan yet.</p>
      <p className="text-[13px] leading-relaxed text-muted mt-1.5">
        Pick a time, an area and who&apos;s coming. Everyone votes on where.
      </p>
      <Link
        href={signedOut ? '/auth' : '/friends/consensus'}
        data-testid="start-night-out-tonight"
        className="flex items-center justify-center w-full min-h-[50px] mt-4 rounded-full bg-accent text-bg font-display text-[15px] font-bold touch-manipulation"
      >
        Start a night out
      </Link>
    </div>
  );
}

/** "Friday" from a night key; UTC on purpose (see /friends/page.tsx weekdayOf). */
function weekdayOf(night: string): string {
  const parsed = new Date(`${night}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 'Tonight';
  return parsed.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}
