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
   *
   * A ROLLOVER THIS HOOK NEVER SAW STILL COUNTS (round-9 panel). Arming only on
   * an OBSERVED key change misses the commonest arrival of all: mounting when
   * the device has ALREADY rolled over. The key is then simply the new night's
   * from the first render, no change is ever observed, `rolledAt` stays null,
   * and the settle polling never runs — so a device ten minutes fast, opened at
   * real 3:55 AM, reads the night in progress and goes on showing those pins
   * after the server expires them at 4:00, until a remount. The window is a
   * property of WHERE THE CLOCK IS, not of what this instance happened to
   * watch: if fifteen minutes ago was a different night, we are inside it.
   */
  const nightRef = useRef(night);
  /**
   * BOTH SIDES OF THE BOUNDARY, because clock skew has two signs (round-10
   * round 5, Codex). Looking only BACKWARDS — "was fifteen minutes ago a
   * different night?" — arms a device whose clock runs FAST, which has already
   * rolled over while the server has not. A device running SLOW has the
   * opposite problem and the worse one: the server rolls over at real 4:00 and
   * expires the pins, while this device still reads 3:50, sees no change, and
   * keeps showing rows the server has already dropped until it catches up.
   *
   * Looking forwards as well arms that case: if fifteen minutes from now is a
   * different night, the server may have rolled already. The window is a
   * property of how close the clock is to the boundary, in either direction.
   */
  const [mountedInsideSettle] = useState(() => {
    const now = Date.now();
    return (
      nycNightKey(new Date(now - ROLLOVER_SETTLE_MS)) !== night
      || nycNightKey(new Date(now + ROLLOVER_SETTLE_MS)) !== night
    );
  });
  const rolledAt = useRef<number | null>(
    mountedInsideSettle ? Date.now() : null,
  );
  useNightRefresh(() => {
    const key = nycNightKey();
    if (key !== nightRef.current) {
      nightRef.current = key;
      rolledAt.current = Date.now();
      setNight(key);
    }
    // The APPROACH to the boundary re-arms too, so a session that was open long
    // before 4:00 AM is inside the window when it arrives — on a slow clock the
    // server rolls over first, and there is no local change to notice.
    if (nycNightKey(new Date(Date.now() + ROLLOVER_SETTLE_MS)) !== nightRef.current) {
      rolledAt.current = Date.now();
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
  return useMyPresenceRead().presence;
}

/**
 * The same read, plus WHETHER IT HAS HAPPENED YET.
 *
 * `useMyPresence` answers `null` for both "not read yet" and "no pin", and the
 * comment on the read below justifies that by saying nothing downstream writes.
 * That stopped being true when the Start-a-Night-Out form began SEEDING the
 * plan's Area from this hook (V8-R-NO-003, "reuses the area already known from
 * Tonight"): tapping Start before the read settles made the form treat a
 * neighbourhood the app already knew as one it did not have, and the plan was
 * created without it and said nothing (round-10 round 9, Codex).
 *
 * A writer needs the two apart, so this is the shape a writer asks for. The
 * display callers keep the null-collapsing one above — for a badge the
 * distinction genuinely does not matter — so no existing caller changes.
 *
 * `settled` means the read RETURNED, not that it succeeded: a failed read is
 * still an answer of "no pin we can see", and the caller that cares can only
 * act on the difference between "not yet" and "we asked".
 */
export function useMyPresenceRead(): { presence: MyPresence | null; settled: boolean } {
  const auth = useAuth();
  const isSignedIn = auth.status === 'signed-in';
  const [mine, setMine] = useState<MyPresence | null>(null);
  const [settled, setSettled] = useState(false);
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
    // A signed-out viewer and a missing client are both SETTLED: there is no
    // read coming, so a caller waiting on one would wait forever.
    if (!isSignedIn) { setMine(null); setSettled(true); return () => { cancelled = true; }; }
    const supabase = getBrowserSupabase();
    if (supabase === null) { setMine(null); setSettled(true); return () => { cancelled = true; }; }
    void (async () => {
      const read = await fetchMyPresence(supabase);
      // A failed read is NO BADGE here, and that is safe in a way it is not in
      // TonightPresence: this hook only DISPLAYS the pin. Nothing downstream of
      // it writes, so there is no audience for a missing read to widen — the
      // rail simply shows no pin until the next read lands.
      if (cancelled) return;
      setMine(read.kind === 'ok' ? read.presence : null);
      setSettled(true);
    })();
    return () => { cancelled = true; };
  }, [isSignedIn, nonce]);

  return { presence: mine, settled };
}
