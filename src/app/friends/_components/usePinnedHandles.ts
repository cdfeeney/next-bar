'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNightRefresh } from '@/hooks/useIntent';
import { nycNightKey } from '@/lib/nightKey';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { fetchCirclePresence, fetchMyPresence } from '@/lib/presence/server';
import type { CirclePresence, MyPresence } from '@/lib/presence';

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

/**
 * How long after THIS device's night rollover the circle read keeps asking, so
 * the server's own 4:00 AM boundary is picked up even when the two clocks
 * disagree. Fifteen minutes at the shared one-minute tick.
 */
const ROLLOVER_SETTLE_MS = 15 * 60 * 1_000;

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

  /**
   * THE ROLLOVER IS THIS DEVICE'S GUESS AT THE SERVER'S (round-7 panel, Codex).
   *
   * The re-read was keyed on the night key CHANGING, and a key changes once.
   * With the device clock running fast the key flipped before the server's own
   * 4:00 AM boundary, that one re-read returned rows the server was still
   * serving for the night in progress, and nothing asked again — so when the
   * server did roll over and those rows expired, the panel went on showing
   * friend pins that no longer existed, for the rest of the session.
   *
   * For a bounded window after our own rollover we therefore keep asking on the
   * shared minute tick, until the server's answer catches up with ours. That is
   * at most `ROLLOVER_SETTLE_MS / 60s` extra reads once a night, and strictly
   * fewer than `useMyPresence` below already makes — it re-reads on EVERY tick.
   *
   * ponytail: covers a skew up to the settle window; a clock hours out is a
   * device problem no client-side window can paper over.
   */
  const nightRef = useRef(night);
  const rolledAt = useRef<number | null>(null);
  useNightRefresh(() => {
    const key = nycNightKey();
    if (key !== nightRef.current) {
      nightRef.current = key;
      rolledAt.current = Date.now();
      setNight(key);
    }
    if (rolledAt.current !== null && Date.now() - rolledAt.current < ROLLOVER_SETTLE_MS) {
      setNonce((n) => n + 1);
    }
  });

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

/**
 * The caller's OWN presence tonight.
 *
 * Separate from `usePinnedHandles` because the sources are separate on purpose:
 * `get_circle_presence` answers "who ELSE is out" and excludes `auth.uid()`, while
 * `get_my_presence` returns only the caller's row. The Stories rail needs both — your own
 * pin and everyone else's — and unioning them in the page keeps each RPC honest about the
 * question it answers.
 *
 * It listens for PRESENCE_CHANGED_EVENT because the rail and TonightPresence are two
 * INDEPENDENT readers of the same row. Without it, pinning a spot updated the panel you
 * were looking at and left the rail a night behind — which is the staleness the event was
 * introduced to fix, and why removing the event as "dead" would have been the wrong repair.
 */
export function useMyPresence(): MyPresence | null {
  const auth = useAuth();
  const isSignedIn = auth.status === 'signed-in';
  const [mine, setMine] = useState<MyPresence | null>(null);
  const [nonce, setNonce] = useState(0);
  const bumpNonce = useCallback(() => setNonce((n) => n + 1), []);
  // Re-read at the 4:00 AM boundary: the night key changes and the server returns nothing
  // for last night, so the badge clears itself at the same instant on both sides.
  useNightRefresh(bumpNonce);

  useEffect(() => {
    const bump = () => setNonce((n) => n + 1);
    if (typeof window === 'undefined') return undefined;
    window.addEventListener(PRESENCE_CHANGED_EVENT, bump);
    return () => window.removeEventListener(PRESENCE_CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isSignedIn) { setMine(null); return () => { cancelled = true; }; }
    const supabase = getBrowserSupabase();
    if (supabase === null) { setMine(null); return () => { cancelled = true; }; }
    void (async () => {
      const read = await fetchMyPresence(supabase);
      // A failed read is NO BADGE here, and that is safe in a way it is not in
      // TonightPresence: this hook only DISPLAYS the pin. Nothing downstream of
      // it writes, so there is no audience for a missing read to widen — the
      // rail simply shows no pin until the next read lands.
      if (!cancelled) setMine(read.kind === 'ok' ? read.presence : null);
    })();
    return () => { cancelled = true; };
  }, [isSignedIn, nonce]);

  return mine;
}
