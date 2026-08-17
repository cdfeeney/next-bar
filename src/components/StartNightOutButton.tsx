'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { nycNightKey } from '@/lib/nightKey';
import { createNightOut, getNightOut } from '@/lib/nightOuts.server';

/**
 * A plan that was CREATED but never opened, parked where a route change cannot
 * take it (fix round 1, Codex).
 *
 * Component state alone was the whole recovery story, and it dies on unmount —
 * which a tab tap, a back gesture or any client-side navigation performs. The
 * user then returns to an armed Start button with no memory of the plan they
 * already made, and the next tap creates a SECOND plan for the same night. That
 * is the exact duplicate-plan defect criterion 4 exists to prevent, reached by a
 * different door than the one that was closed.
 *
 * sessionStorage, not localStorage: an unopened plan is one tab's in-flight
 * intent. It should not outlive the session or leak across tabs — the plan is
 * durable in the database and reachable from the plan list either way.
 */
const STARTED_KEY = 'next-bar:started-night-out:v1';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rememberStarted(planId: string): void {
  try {
    window.sessionStorage.setItem(STARTED_KEY, planId);
  } catch {
    // Private mode / quota. Recovery degrades to component state, which is
    // exactly where it was before — never let this throw block navigation.
  }
}

function recallStarted(): string | null {
  try {
    const raw = window.sessionStorage.getItem(STARTED_KEY);
    return raw !== null && UUID_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

function forgetStarted(): void {
  try {
    window.sessionStorage.removeItem(STARTED_KEY);
  } catch {
    // Nothing to do; a stale entry dies with the session.
  }
}

/**
 * The canonical Night Out entry point (V8-3 review: the lifecycle had no
 * production create surface). Signed-in only — creation is an authenticated
 * RPC (criterion 6); the consensus flow itself keeps working signed-out on
 * local data, so this renders nothing there.
 */
export default function StartNightOutButton(): JSX.Element | null {
  const auth = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [createdPlanId, setCreatedPlanId] = useState<string | null>(null);
  /**
   * Navigation must not fire from an unmounted component (fix round 1, Codex):
   * `handleStart`'s read can settle long after a route change, and pushing then
   * yanks the user off whatever they deliberately opened.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Re-arm the recovery affordance instead of the Start button. A plan created
  // in this session but never opened is the one state where offering "Start" is
  // actively harmful.
  useEffect(() => {
    const parked = recallStarted();
    if (parked !== null) {
      setCreatedPlanId(parked);
      setReadFailed(true);
    }
  }, []);

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
    if (plan === null || !mounted.current) return;
    forgetStarted();
    router.push(`/night-out/${plan.shareToken}`);
  };

  if (auth.status !== 'signed-in') return null;

  const handleStart = async (): Promise<void> => {
    const supabase = getBrowserSupabase();
    if (!supabase || busy) return;
    setBusy(true);
    setError(false);
    const planId = await createNightOut(supabase, nycNightKey());
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
    // Parked BEFORE the follow-up read, not after it: the window this closes is
    // the one where the read is still in flight and the user navigates away.
    rememberStarted(planId);
    setCreatedPlanId(planId);
    const plan = await getNightOut(supabase, planId);
    if (plan === null) {
      setReadFailed(true);
      return;
    }
    if (!mounted.current) return;
    forgetStarted();
    router.push(`/night-out/${plan.shareToken}`);
  };

  return (
    <div className="mt-4 text-center">
      <button
        type="button"
        onClick={() => void handleStart()}
        // A plan already exists for this session — the only safe action left is
        // opening it. Leaving Start armed here is precisely how the second plan
        // gets created.
        disabled={busy || createdPlanId !== null}
        className="rounded-full border border-accent px-5 py-2 text-accent touch-manipulation disabled:opacity-50"
      >
        {busy ? 'Starting…' : 'Start the official Night Out'}
      </button>
      {error ? (
        <p className="mt-2 text-sm text-red-400">
          Couldn&apos;t start it — try again.
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
