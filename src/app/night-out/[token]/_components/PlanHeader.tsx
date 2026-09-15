'use client';

/** S-07 split (pure move): the plan header — cover, title, date, host, state, invite link. */
import PlanCover from '@/components/PlanCover';
import type { NightOut } from '@/lib/nightOuts.server';
import { barLabel, nightDateLabel } from './planPage';

export default function PlanHeader({
  plan,
  isCancelled,
  shareNotice,
  onCopyInvite,
}: {
  plan: NightOut;
  isCancelled: boolean;
  shareNotice: string | null;
  onCopyInvite: () => void;
}): JSX.Element {
  return (
        <header className="text-center">
          {/* S-06b: the cover, when the plan has one; nothing otherwise. */}
          <PlanCover nightOutId={plan.id} className="mb-4 h-[150px] w-full rounded-3xl" />
          <h1 className="text-2xl font-semibold">
            {plan.title ?? 'Night out'}
          </h1>
          <p className="mt-1 opacity-80">{nightDateLabel(plan.night)}</p>
          <p className="mt-1 text-sm opacity-60">
            Hosted by {plan.ownerDisplayName ?? plan.ownerHandle ?? 'a friend'}
          </p>
          {isCancelled ? (
            <p className="mt-3 font-semibold text-red-400">
              This night out was cancelled.
            </p>
          ) : plan.status === 'decided' && plan.decidedBarId !== null ? (
            <p className="mt-3 font-semibold">
              It&apos;s decided: {barLabel(plan.decidedBarId)}
            </p>
          ) : null}

          {/* Round-2 review (Codex, high): creating a plan produced a link the
              app gave you no way to send. The consensus page's "Invite friends"
              still shares /join, and this page had no share control at all, so
              the canonical invitation lifecycle had no reachable invite step. */}
          {!isCancelled ? (
            <button
              type="button"
              onClick={onCopyInvite}
              className="mt-4 rounded-full border px-5 py-2 text-sm"
            >
              Copy invite link
            </button>
          ) : null}
          {shareNotice !== null ? (
            <p className="mt-2 break-all text-xs opacity-70" role="status">
              {shareNotice}
            </p>
          ) : null}
        </header>
  );
}
