'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { nycNightKey } from '@/lib/nightKey';
import { createNightOut, getNightOut, inviteToNightOut } from '@/lib/nightOuts.server';

/**
 * The canonical Night Out entry point (V8-3 review: the lifecycle had no
 * production create surface). Signed-in only — creation is an authenticated
 * RPC (criterion 6); the consensus flow itself keeps working signed-out on
 * local data, so this renders nothing there.
 */
/**
 * Real account ids only. The consensus list mixes followed friends (profile
 * UUIDs) with demo entries whose id is a HANDLE, and with the literal
 * YOU_ID 'you'. night_out_members is FK-bound to profiles, so anything that is
 * not a uuid would fail at the database — silently, since invite returns false.
 * Filtering here keeps that from ever being attempted.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function StartNightOutButton({
  inviteeIds = [],
  disabled = false,
}: {
  /** Selected people from the consensus list; non-account entries are dropped. */
  inviteeIds?: readonly string[];
  /**
   * The invitee list is not settled yet — hold the button.
   *
   * `inviteeIds` is DERIVED state, and an empty array is indistinguishable
   * from "nobody selected" once it arrives here. The consensus page builds it
   * from the followed circle, which is empty while follows load, so starting
   * in that window created a real plan and invited NOBODY — no error, no empty
   * state, a night out with no guests (cold panel, both lanes, HIGH). The
   * caller owns the readiness signal because only the caller knows whether an
   * empty list means "still loading" or "none chosen".
   */
  disabled?: boolean;
} = {}): JSX.Element | null {
  const auth = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [createdPlanId, setCreatedPlanId] = useState<string | null>(null);
  const [inviteFailures, setInviteFailures] = useState(0);
  /**
   * Minted once per attempt and REUSED across retries. That is the whole point:
   * a create whose response never arrived may already have made the plan, and
   * without a stable key the retry makes a second one (cold panel, Codex).
   */
  const attemptKey = useRef<string | null>(null);

  /**
   * Retry the READ, not the create. The first version of this told the user to
   * refresh — advice that loses the plan id from component state and re-arms
   * the Start button, walking them straight back into the duplicate-plan bug it
   * was written to prevent (cold panel 2, Codex). Advice the UI cannot honour
   * is worse than no advice.
   */
  const retryOpen = async (): Promise<void> => {
    const supabase = getBrowserSupabase();
    if (!supabase || createdPlanId === null) return;
    const plan = await getNightOut(supabase, createdPlanId);
    if (plan === null) return;
    router.push(`/night-out/${plan.shareToken}`);
  };

  if (auth.status !== 'signed-in') return null;

  const handleStart = async (): Promise<void> => {
    const supabase = getBrowserSupabase();
    // Guarded here too, not only via the disabled attribute: a click can be
    // dispatched programmatically, and a plan created early cannot be un-made.
    if (!supabase || busy || disabled) return;
    setBusy(true);
    setError(false);
    if (attemptKey.current === null) attemptKey.current = crypto.randomUUID();
    const planId = await createNightOut(
      supabase,
      nycNightKey(),
      undefined,
      attemptKey.current,
    );
    if (planId === null) {
      setBusy(false);
      setError(true);
      return;
    }
    // The plan EXISTS from here on. A failed follow-up read is a read failure,
    // not a create failure: reporting it as one and re-enabling the button made
    // the next tap create a SECOND plan for the same night, splitting the group
    // between two plans nobody could tell apart (cold panel, Codex + Claude).
    // Stay busy and route by plan id; the plan page resolves its own token.
    setCreatedPlanId(planId);

    // Invitations are sent AFTER the plan exists and BEFORE navigating, so the
    // owner learns here if some did not land. A failed invite never blocks
    // reaching the plan — the plan is real either way — but it is never silent
    // either: an invitation nobody sent and nobody mentioned is the whole
    // defect this wiring exists to fix.
    const accounts = inviteeIds.filter((id) => UUID_RE.test(id));
    let failed = 0;
    for (const id of accounts) {
      // Sequential on purpose: invite_to_night_out serialises on a per-plan
      // advisory lock, so firing them in parallel would just queue on the lock.
      if (!(await inviteToNightOut(supabase, planId, id))) failed += 1;
    }
    setInviteFailures(failed);

    const plan = await getNightOut(supabase, planId);
    if (plan === null) {
      setReadFailed(true);
      return;
    }
    router.push(`/night-out/${plan.shareToken}`);
  };

  return (
    <div className="mt-4 text-center">
      <button
        type="button"
        onClick={() => void handleStart()}
        disabled={busy || disabled}
        className="rounded-full border border-accent px-5 py-2 text-accent touch-manipulation disabled:opacity-50"
      >
        {busy ? 'Starting…' : 'Start the official Night Out'}
      </button>
      {error ? (
        <p className="mt-2 text-sm text-red-400">
          Couldn&apos;t start it — try again.
        </p>
      ) : null}
      {inviteFailures > 0 ? (
        <p className="mt-2 text-sm text-red-400">
          {inviteFailures === 1
            ? "One invite didn't send — you can share the link instead."
            : `${inviteFailures} invites didn't send — you can share the link instead.`}
        </p>
      ) : null}
      {readFailed ? (
        <div className="mt-2">
          <p className="text-sm text-red-400">
            Your night out was created, but this page couldn&apos;t open it.
            Don&apos;t start another one.
          </p>
          <button
            type="button"
            onClick={() => void retryOpen()}
            className="mt-2 rounded-full border px-5 py-2 text-sm"
          >
            Open it
          </button>
        </div>
      ) : null}
    </div>
  );
}
