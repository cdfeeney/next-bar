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
 * durable in the database either way. (It is NOT yet reachable from a plan
 * list: no surface lists plans you own. That gap is recorded as a residual
 * product gap in V8-3-HANDOFF-2026-08-16b.md, which is why this recovery path
 * carries more weight than it looks like it should.)
 */
const STARTED_KEY = 'next-bar:started-night-out:v1';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * WHOSE plan, and for WHICH night. Round 2 filed the unscoped version twice.
 *
 * Claude (HIGH): sessionStorage is per TAB, not per account, and this key is in
 * no wipe set — `accountCache` clears localStorage only. So user A parks an
 * unopened plan, signs out, and user B signing in to the same tab inherits A's
 * plan id: Start is disabled, "Open it" silently no-ops because getNightOut
 * returns null under B's RLS, and nothing ever clears the key. B cannot create a
 * night out for the rest of the session.
 *
 * Codex, independently: also unscoped by night, so a mobile browser restoring
 * the tab tomorrow keeps Start disabled for yesterday's plan.
 *
 * Both are the same missing idea — a parked plan is only meaningful for the
 * identity and the night that created it.
 */
type ParkedPlan = { planId: string; userId: string; nightKey: string };

/**
 * Last-resort store for when sessionStorage throws (Safari private mode at
 * quota, some webviews).
 *
 * Codex (round 2): a purely best-effort write left criterion 4 unfixed exactly
 * where storage is unavailable — the duplicate-plan bug came back for those
 * users while the code looked like it had been handled. A module-level value
 * lives as long as the JS context, which is precisely the span a route change
 * unmounts a component across, so it closes the same window without pretending
 * to be durable.
 */
let inMemoryParked: ParkedPlan | null = null;
/**
 * Did the last write actually land? A WRITABLE store is authoritative: if it
 * says nothing is parked, nothing is parked. The in-memory copy is consulted
 * only when the store could not be written or could not be read — otherwise a
 * stale module-level value would outrank the real answer and re-offer a
 * recovery the user has already finished with.
 */
let storageUsable = true;

function rememberStarted(parked: ParkedPlan): void {
  inMemoryParked = parked;
  try {
    window.sessionStorage.setItem(STARTED_KEY, JSON.stringify(parked));
    storageUsable = true;
  } catch {
    // Covered by inMemoryParked — never let this throw block navigation.
    storageUsable = false;
  }
}

function recallStarted(): ParkedPlan | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(STARTED_KEY);
  } catch {
    return inMemoryParked;
  }
  if (raw === null) return storageUsable ? null : inMemoryParked;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { planId, userId, nightKey } = parsed as Record<string, unknown>;
    if (typeof planId !== 'string' || !UUID_RE.test(planId)) return null;
    if (typeof userId !== 'string' || !UUID_RE.test(userId)) return null;
    if (typeof nightKey !== 'string' || nightKey === '') return null;
    return { planId, userId, nightKey };
  } catch {
    return null;
  }
}

function forgetStarted(): void {
  inMemoryParked = null;
  storageUsable = true;
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
  const [retryFailed, setRetryFailed] = useState(false);
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
  //
  // Keyed on the signed-in user: a parked plan belonging to someone else, or to
  // an earlier night, is discarded rather than shown. Without that, the recovery
  // UI locks the NEXT account out of creating a plan (round 2, both lanes).
  const userId = auth.status === 'signed-in' ? auth.user.id : null;
  useEffect(() => {
    if (userId === null) return;
    const parked = recallStarted();
    if (parked === null) return;
    if (parked.userId !== userId || parked.nightKey !== nycNightKey()) {
      forgetStarted();
      return;
    }
    setCreatedPlanId(parked.planId);
    setReadFailed(true);
  }, [userId]);

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
    setRetryFailed(false);
    const plan = await getNightOut(supabase, createdPlanId);
    if (!mounted.current) return;
    if (plan === null) {
      // Round 2 (Claude): this returned silently, so a plan that had genuinely
      // gone — deleted, or a read that keeps failing — turned "Open it" into a
      // dead control with no message and Start still disabled. A button that
      // does nothing and says nothing is worse than a reported failure, because
      // the user cannot tell it from a slow tap.
      setRetryFailed(true);
      return;
    }
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
    rememberStarted({ planId, userId: auth.user.id, nightKey: nycNightKey() });
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
          {retryFailed ? (
            <p className="mt-2 text-sm text-red-400" role="status">
              Still couldn&apos;t open it. Your night out exists — try again in a
              moment.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
