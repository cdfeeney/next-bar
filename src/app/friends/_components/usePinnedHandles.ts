'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNightRefresh } from '@/hooks/useIntent';
import { nycNightKey } from '@/lib/nightKey';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { fetchCirclePresence } from '@/lib/presence/server';
import type { CirclePresence } from '@/lib/presence';

/**
 * Who in your circle is out tonight (V8-R-SOC-001, V8-R-PRE-001..005).
 *
 * The hook behind Social · Tonight. It answers one question — "whose presence
 * may I show right now?" — and answers it with three distinguishable states,
 * because the surface above it must render three different things:
 *
 *   loading  · we do not know yet          → show nothing, not an empty state
 *   rows: [] · nobody has set a status     → "no friends out yet" (V8-R-OPS-005)
 *   rows:null· the fetch failed            → say so; never claim nobody is out
 *
 * Collapsing the last two is the bug worth naming: rendering "nobody is out
 * tonight" because a request failed tells the user something false about their
 * friends, and it does it silently.
 *
 * NIGHT-SCOPED, and it re-reads at the boundary. `useNightRefresh` fires on the
 * shared clock signal, so when the clock passes 4:00 AM America/New_York the
 * night key changes and this refetches — and the server, filtering on
 * `public.nyc_night_key()`, returns nothing for last night. The list empties on
 * its own at the same instant on both sides. Nothing here schedules an expiry
 * or trims a stale row; expiry is what the shared boundary already means.
 */

export type PinnedHandlesState = {
  /** True until the first answer arrives. Distinct from "nobody is out". */
  loading: boolean;
  /** Tonight's presence, [] when nobody is out, null when the read failed. */
  rows: CirclePresence[] | null;
  /** The night these rows belong to (YYYY-MM-DD), for callers that display it. */
  night: string;
  /** Re-read now — after the viewer changes their own pin, say. */
  refresh: () => void;
};

export function usePinnedHandles(): PinnedHandlesState {
  const auth = useAuth();
  const [night, setNight] = useState(() => nycNightKey());
  const [rows, setRows] = useState<CirclePresence[] | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped to force a re-read; the effect below depends on it.
  const [nonce, setNonce] = useState(0);

  useNightRefresh(() => setNight(nycNightKey()));

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    // Signed out (or still resolving auth) is not a failed read and not an
    // empty circle — there is simply no circle to ask about.
    if (auth.status === 'loading') {
      setLoading(true);
      return;
    }
    if (auth.status !== 'signed-in') {
      setRows([]);
      setLoading(false);
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) {
      // Unconfigured client is a load FAILURE, not an empty night: the
      // surface must not report that nobody is out.
      setRows(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      const next = await fetchCirclePresence(supabase);
      if (cancelled) return;
      setRows(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status, night, nonce]);

  return { loading, rows, night, refresh };
}
