'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PairwiseComparison, Rating } from '@/types/ratings';
import { loadRatings, writeRatings } from '@/lib/ratings';
import {
  appendComparison,
  loadComparisons,
  writeComparisons,
} from '@/lib/pairwise.local';
import {
  fetchServerComparisons,
  insertServerComparison,
  mergeLocalComparisonsToServer,
} from '@/lib/pairwise.server';
import { updateServerScores } from '@/lib/ratings.server';
import {
  applyComparison,
  pickComparisonTarget,
  reconcileScores,
} from '@/lib/pairwise';
import {
  answerComparison,
  startInsertSession,
  type InsertSession,
} from '@/lib/insertFlow';
import { useAuth } from '@/hooks/useAuth';
import { broadcastServerRatingSet } from '@/hooks/useRatings';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch, guardAgainstForeignCache } from '@/lib/accountCache';

const COMPARISONS_BROADCAST = 'next-bar:pairwise:local-update';
const MERGED_KEY = 'next-bar:pairwise:merged-for:v1';

export type PendingPrompt = {
  /** The bar the user just rated. */
  justRatedBarId: string;
  /** The peer the matcher chose for them to compare against. */
  peerBarId: string;
  /** The tier both bars sit in — drives the prompt copy. */
  tier: Extract<Rating, 'loved' | 'liked'>;
};

export type SessionProgress = {
  /** 1-based number of the comparison currently on screen. */
  step: number;
  /** Worst-case comparisons for this insert session. */
  maxSteps: number;
};

export type UsePairwiseReturn = {
  comparisons: PairwiseComparison[];
  pendingPrompt: PendingPrompt | null;
  /**
   * Try to open a comparison prompt for a bar the user just rated. When the
   * tier has ≥2 peers this starts a B4 binary-insert CHAIN (one prompt per
   * probe, ≤7); with exactly 1 peer it falls back to the original one-shot
   * prompt. No-op when:
   *   - tier is 'pass' (Q2 — no Pass-vs-Pass ordering)
   *   - the user has no other same-tier rated bars
   */
  requestPrompt: (justRatedBarId: string, tier: Rating) => void;
  /**
   * Record a comparison the user just answered. Persists the row (local
   * storage signed-out, `pairwise_comparisons` signed-in), recomputes
   * scores via `applyComparison`, commits the new BarRating[], and then
   * either advances the active insert chain to its next probe (same tier,
   * next peer) or dismisses the prompt.
   */
  addComparison: (winnerBarId: string, loserBarId: string) => void;
  /** Dismiss the prompt without recording a pick (Skip / Escape / backdrop). */
  dismissPrompt: () => void;
  /** "2 of 4" copy for the sheet while an insert chain is active, else null. */
  sessionProgress: SessionProgress | null;
};

/**
 * Pairwise comparison state, dual-mode like useRatings (B0.4):
 *
 *   signed-out / unavailable → localStorage transcript + writeRatings.
 *   signed-in → `pairwise_comparisons` rows (append-only, session-tagged)
 *     with a one-time local→server transcript merge per (browser, user).
 *     Scores recompute client-side from the full transcript and bulk-upsert
 *     to `ratings.score`; in-tab useRatings instances hear about it via
 *     broadcastServerRatingSet.
 *
 * The localStorage ratings cache is write-through in server mode (see
 * useRatings B0.3), so loadRatings() is current in BOTH modes and the
 * score pipeline is mode-agnostic.
 */
export function usePairwise(): UsePairwiseReturn {
  const auth = useAuth();
  const [comparisons, setComparisons] = useState<PairwiseComparison[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);
  // Active B4 binary-insert chain, or null when the (legacy) one-shot
  // prompt path is in play. Only requestPrompt starts one.
  const [insertSession, setInsertSession] = useState<InsertSession | null>(
    null,
  );
  // Last (bar|probe|step) an answer was persisted for — double-tap guard.
  const lastAnsweredProbeRef = useRef<string | null>(null);
  // Serialization chain for server score writes — see persistComparison.
  const scoreWriteChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const modeRef = useRef<'local' | 'server' | 'pending'>('pending');
  // One session id per mounted app instance — tags this device's inserts
  // (migration 0005) so a future reconcile flow can detect interleaved
  // multi-device ranking sessions.
  const sessionIdRef = useRef<string | null>(null);
  if (sessionIdRef.current === null) {
    sessionIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : null;
  }

  // Hydrate from localStorage on mount. Same listener pattern as useRatings —
  // a broadcast from another instance (or our own writes) re-reads.
  useEffect(() => {
    setComparisons(loadComparisons());

    function handle(): void {
      // BOTH modes re-read from the write-through cache (Codex B4 review):
      // server-mode appends mirror into it, so it is the shared source for
      // every mounted instance — without this, a second RatingControl's
      // chain started from a transcript missing the first one's answers.
      setComparisons(loadComparisons());
    }
    window.addEventListener(COMPARISONS_BROADCAST, handle);
    return () => window.removeEventListener(COMPARISONS_BROADCAST, handle);
  }, []);

  // Auth-driven mode switch, mirroring useRatings: merge the local
  // transcript once per (browser, user), then fetch the server transcript.
  useEffect(() => {
    if (auth.status === 'loading') return;

    if (auth.status !== 'signed-in') {
      modeRef.current = 'local';
      setComparisons(loadComparisons());
      return;
    }

    const supabase = getBrowserSupabase();
    if (!supabase) {
      modeRef.current = 'local';
      setComparisons(loadComparisons());
      return;
    }

    modeRef.current = 'server';
    const userId = auth.user.id;
    // Cross-account guard (see lib/accountCache.ts): another account's
    // cached transcript must be wiped, never merged into this one.
    guardAgainstForeignCache(userId);
    const local = loadComparisons();
    const alreadyMergedFor = readMergedFlag();

    let cancelled = false;
    // Epoch guard — see useRatings: abandon writes if a wipe landed while
    // this block was in flight (sign-out race).
    const epoch = getCacheEpoch();
    void (async () => {
      if (local.length > 0 && alreadyMergedFor !== userId) {
        const merged = await mergeLocalComparisonsToServer(
          supabase,
          userId,
          local,
          sessionIdRef.current,
        );
        // Latch only on a completed run — a failed merge must retry.
        if (merged !== null && getCacheEpoch() === epoch) writeMergedFlag(userId);
      }
      const server = await fetchServerComparisons(supabase);
      // null = fetch failed — keep the local transcript rather than
      // pretending the user has never compared anything.
      if (!cancelled && server !== null) {
        setComparisons(server);
        if (getCacheEpoch() === epoch) {
          // OWNERSHIP marker (santa round-3, mirrors useRatings): latch the
          // flag even when no merge ran — the guards key off it.
          writeMergedFlag(userId);
          // Write-through the transcript cache (Codex review): without it a
          // later failed fetch falls back to an empty/stale transcript.
          writeComparisons(server);
          // Self-healing pass (Codex review): persisted scores are a
          // denormalization of (ratings, transcript) and can drift — tier
          // changes shrink a tier without re-interpolating, and a partial
          // fire-and-forget failure diverges them. Repair from the
          // authoritative transcript on every hydrate.
          const cached = loadRatings();
          const corrected = reconcileScores(cached, server);
          const repaired = corrected.filter(
            (r, i) => r !== cached[i],
          );
          if (repaired.length > 0) {
            writeRatings(corrected);
            void updateServerScores(supabase, userId, repaired);
            for (const entry of repaired) broadcastServerRatingSet(entry);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.status, auth.status === 'signed-in' ? auth.user.id : null]);

  const broadcast = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new Event(COMPARISONS_BROADCAST));
    } catch {
      // Older Safari etc. — non-fatal; storage will re-read on next mount.
    }
  }, []);

  const requestPrompt = useCallback(
    (justRatedBarId: string, tier: Rating) => {
      // EVERY new request invalidates whatever chain/prompt was active
      // (Codex B4 review): re-rating a bar as Pass mid-chain must not
      // leave the old sheet appending against stale peers/tiers.
      setInsertSession(null);
      setPendingPrompt(null);
      lastAnsweredProbeRef.current = null;
      if (tier !== 'loved' && tier !== 'liked') return;

      const ratings = loadRatings();
      const peerCount = ratings.filter(
        (r) => r.rating === tier && r.barId !== justRatedBarId,
      ).length;

      // ≥2 peers → binary-insert chain (B4). The session probes the
      // midpoint of the tier's current effective order and halves the
      // window on each answer, ≤7 comparisons total.
      if (peerCount >= 2) {
        const session = startInsertSession(
          ratings,
          comparisons,
          justRatedBarId,
          tier,
        );
        if (!session.done && session.probeBarId !== null) {
          setInsertSession(session);
          setPendingPrompt({
            justRatedBarId,
            peerBarId: session.probeBarId,
            tier,
          });
          return;
        }
      }

      // 0–1 peers (or a session that couldn't start) → original one-shot
      // prompt behavior.
      const peer = pickComparisonTarget(
        ratings,
        comparisons,
        justRatedBarId,
        tier,
      );
      if (!peer) return;

      setPendingPrompt({ justRatedBarId, peerBarId: peer, tier });
    },
    [comparisons],
  );

  /**
   * Persist one answered comparison through the mode-appropriate path and
   * recompute scores from the full transcript. Extracted from the original
   * addComparison unchanged — the chain reuses it once per answer.
   */
  const persistComparison = useCallback(
    (newComparison: PairwiseComparison) => {
      // Recompute against the CURRENT ratings (write-through cache keeps
      // this fresh in server mode too).
      const currentRatings = loadRatings();
      const updatedRatings = applyComparison(
        currentRatings,
        comparisons,
        newComparison,
      );

      if (modeRef.current === 'server' && auth.status === 'signed-in') {
        const supabase = getBrowserSupabase();
        if (supabase) {
          const userId = auth.user.id;
          // Optimistic transcript append (server assigns no fields we need),
          // mirrored into the local transcript cache so a later failed
          // fetch still has a usable fallback (Codex review).
          setComparisons((prev) => [...prev, newComparison]);
          appendComparison(newComparison);
          // Tell every OTHER mounted usePairwise instance (Codex B4 review —
          // server mode previously never broadcast, so sibling RatingControls
          // built chains from incomplete transcripts).
          broadcast();
          void insertServerComparison(
            supabase,
            userId,
            newComparison,
            sessionIdRef.current,
          );

          // Persist only the rows whose score actually changed (score-ONLY
          // updates — full-row upserts could roll back a newer tier change
          // from another device), then let every mounted useRatings
          // instance know. Writes are SERIALIZED through a promise chain
          // (Codex B4 review): two chained answers' fire-and-forget score
          // writes could otherwise land out of order, leaving answer 1's
          // intermediate scores on the server until the next hydrate's
          // reconcile pass.
          const changed = updatedRatings.filter((r) => {
            const before = currentRatings.find((c) => c.barId === r.barId);
            return before === undefined || before.score !== r.score;
          });
          scoreWriteChainRef.current = scoreWriteChainRef.current
            .then(() => updateServerScores(supabase, userId, changed))
            .catch(() => undefined);
          writeRatings(updatedRatings); // keep the write-through cache coherent
          for (const entry of changed) broadcastServerRatingSet(entry);
          return;
        }
      }

      const updatedComparisons = appendComparison(newComparison);

      writeRatings(updatedRatings);
      setComparisons(updatedComparisons);
      broadcast();
    },
    [auth, broadcast, comparisons],
  );

  const addComparison = useCallback(
    (winnerBarId: string, loserBarId: string) => {
      if (winnerBarId === loserBarId) return;

      // Does this answer belong to the active insert chain? (It always
      // does when the sheet was opened by a session prompt — this guard
      // just refuses to advance the chain on a mismatched pair.)
      const chained =
        insertSession !== null &&
        !insertSession.done &&
        insertSession.probeBarId !== null &&
        ((winnerBarId === insertSession.barId &&
          loserBarId === insertSession.probeBarId) ||
          (winnerBarId === insertSession.probeBarId &&
            loserBarId === insertSession.barId));

      if (chained && insertSession) {
        // Double-tap idempotence (Opus review): a second tap before the
        // re-render calls this with the SAME stale session closure — it
        // would persist a duplicate row for the same probe and skip ahead.
        // One persist per (bar, probe, step), full stop.
        const probeKey = `${insertSession.barId}|${insertSession.probeBarId}|${insertSession.step}`;
        if (lastAnsweredProbeRef.current === probeKey) return;
        lastAnsweredProbeRef.current = probeKey;

        const { session: next, comparison } = answerComparison(
          insertSession,
          winnerBarId,
        );
        if (comparison === null) return; // defensive; `chained` should preclude
        persistComparison(comparison);

        // Chain not finished → immediately show the next probe instead of
        // closing the sheet. A conflicted session ends gracefully here
        // (done=true) with the answer already recorded.
        if (
          !next.done &&
          next.probeBarId !== null &&
          (next.tier === 'loved' || next.tier === 'liked')
        ) {
          setInsertSession(next);
          setPendingPrompt({
            justRatedBarId: next.barId,
            peerBarId: next.probeBarId,
            tier: next.tier,
          });
          return;
        }
        setInsertSession(null);
        setPendingPrompt(null);
        return;
      }

      // One-shot path (no active chain) — original behavior.
      persistComparison({
        winnerBarId,
        loserBarId,
        comparedAt: new Date().toISOString(),
      });
      setInsertSession(null);
      setPendingPrompt(null);
    },
    [insertSession, persistComparison],
  );

  const dismissPrompt = useCallback(() => {
    // Skip ends the whole chain (B4: bar falls back to the band midpoint
    // when nothing was answered — see skipSession semantics in
    // lib/insertFlow.ts). Answers already given stay persisted; nothing to
    // roll back, so dropping the session object is the entire skip.
    setInsertSession(null);
    setPendingPrompt(null);
  }, []);

  const sessionProgress: SessionProgress | null =
    insertSession !== null && !insertSession.done
      ? { step: insertSession.step + 1, maxSteps: insertSession.maxSteps }
      : null;

  return {
    comparisons,
    pendingPrompt,
    requestPrompt,
    addComparison,
    dismissPrompt,
    sessionProgress,
  };
}

function readMergedFlag(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(MERGED_KEY);
  } catch {
    return null;
  }
}

function writeMergedFlag(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MERGED_KEY, userId);
  } catch {
    // Quota / private mode — non-fatal; merge will just re-run next sign-in.
  }
}
