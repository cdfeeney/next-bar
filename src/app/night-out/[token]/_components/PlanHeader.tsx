'use client';

/**
 * README §7 — the plan header: cover (when set), the plan's name falling back
 * to "Where are we going?", then "Saturday, September 13 · hosted by you".
 *
 * The start time the README draws ("· 9:00 PM") is not on the member read
 * (`get_night_out` carries no starts_at; only the bearer preview does), so the
 * meta line states the night and the host — disclosed in S-07's packet rather
 * than invented from the 9:00 PM default.
 */
import PlanCover from '@/components/PlanCover';
import type { NightOut } from '@/lib/nightOuts.server';
import { nightDateLabel } from './planPage';

export const UNNAMED_PLAN_TITLE = 'Where are we going?';

export default function PlanHeader({
  plan,
  isOwner,
  isCancelled,
}: {
  plan: NightOut;
  isOwner: boolean;
  isCancelled: boolean;
}): JSX.Element {
  const host = isOwner ? 'you' : (plan.ownerDisplayName ?? plan.ownerHandle ?? 'a friend');
  return (
    <header className="text-left" data-testid="plan-header">
      {/* S-06b: the cover, when the plan has one; nothing otherwise. */}
      <PlanCover nightOutId={plan.id} className="mb-4 h-[150px] w-full rounded-3xl" />
      <h1 className="font-display text-[28px] font-bold leading-tight" data-testid="plan-title">
        {plan.title ?? UNNAMED_PLAN_TITLE}
      </h1>
      <p className="mt-1 text-[13px] text-muted" data-testid="plan-meta">
        {nightDateLabel(plan.night)} · hosted by {host}
      </p>
      {isCancelled ? (
        <p className="mt-3 font-semibold text-red-400">This night out was cancelled.</p>
      ) : null}
    </header>
  );
}
