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
 * The hook behind Social Â· Tonight. It answers one question â€” "whose presence
 * may I show right now?" â€” and answers it with three distinguishable states,
 * because the surface above it must render three different things:
 *
 *   loading  Â· we do not know yet          â†’ show nothing, not an empty state
 *   rows: [] Â· nobody has set a status     â†’ "no friends out yet" (V8-R-OPS-005)
 *   rows:nullÂ· the fetch failed            â†’ say so; never claim nobody is out
 *
 * Collapsing the last two is the bug worth naming: rendering "nobody is out
 * tonight" because a request failed tells the user something false about their
 * friends, and it does it silently.
 *
 * NIGHT-SCOPED, and it re-reads at the boundary. `useNightRefresh` fires on the
 * shared clock signal, so when the clock passes 4:00 AM America/New_York the
 * night key changes and this refetches â€” and the server, filtering on
 * `public.nyc_night_key()`, returns nothing for last night. The list empties on
 * its own at the same instant on both sides. Nothing here schedules an expiry
 * or trims a stale row; expiry is what the shared boundary already means.
 */

// ---------------------------------------------------------------------------
// FOUNDER DECISION 2026-08-24 — BOTH SOURCES SURVIVE.
//
// This hook reads `get_circle_presence`, NOT `get_circle_suggestions`. They answer
// different questions over different tables: presence is "I am out tonight" (one row per
// night, server-scoped by `public.nyc_night_key()`, audience-gated so that `close`
// requires a MUTUAL follow); suggestions is "I proposed this bar" (many rows per user per
// night, night supplied by the CLIENT, no audience model, no `updated_at`).
//
// Adopting the suggestions source here was rejected as a privacy regression: it drops the
// mutual-follow requirement for close presence and widens who can see a user's location.
// It would also discard the server-enforced 4 AM boundary (V8-R-PRE-005 / D-C-39).
// Suggestions keeps its own source for its own feature; nothing is merged into one.
//
// This matches the intent already recorded on the other side of this merge: "a ring means
// an unseen story, a pin means someone is out, and they are never merged into one
// affordance." Do not re-litigate this in a downstream lane.
// ---------------------------------------------------------------------------

/** Fired after a pin/unpin the server confirmed. */
export const PRESENCE_CHANGED_EVENT = 'next-bar:presence-changed';

/** Announce a confirmed pin/unpin to every presence reader on the page. */
export function announcePresenceChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PRESENCE_CHANGED_EVENT));
}

export type PinnedHandlesState = {
  /** True until the first answer arrives. Distinct from "nobody is out". */
  loading: boolean;
  /** Tonight's presence, [] when nobody is out, null when the read failed. */
  rows: CirclePresence[] | null;
  /** The night these rows belong to (YYYY-MM-DD), for callers that display it. */
  night: string;
  /** Re-read now â€” after the viewer changes their own pin, say. */
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
    // empty circle â€” there is simply no circle to ask about.
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
