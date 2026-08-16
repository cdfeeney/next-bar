'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { nycNightKey } from '@/lib/nightKey';
import { createNightOut, getNightOut } from '@/lib/nightOuts.server';

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
        disabled={busy}
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
        <p className="mt-2 text-sm text-red-400">
          Your night out was created, but this page couldn&apos;t open it.
          Refresh — don&apos;t start another one.
        </p>
      ) : null}
    </div>
  );
}
