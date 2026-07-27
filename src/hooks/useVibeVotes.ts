'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { VibeTag } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch } from '@/lib/accountCache';
import { nycNightKey } from '@/lib/nightKey';
import {
  castVibeVote,
  fetchCircleVibeVotes,
  rescindVibeVote,
} from '@/lib/vibeVotes.server';
import { tallyVibeVotes, type VibeVote } from '@/lib/vibeVotes';
import { TAG_VOCABULARY } from '@/lib/catalog';

const KNOWN_TAGS: ReadonlySet<VibeTag> = new Set(TAG_VOCABULARY);

const isKnownTag = (tag: string): tag is VibeTag =>
  KNOWN_TAGS.has(tag as VibeTag);

export type UseVibeVotesReturn = {
  /** null = dark (unapplied migration 0017 / signed out / load error) —
   *  callers render nothing. [] = live with no votes yet. */
  votes: VibeVote[] | null;
  /** The caller's own current vote tag, if any (UNfiltered — review MED:
   *  a vote whose tag left the vocabulary still exists server-side and
   *  must not be invisible to the "do I have a vote" question; it just
   *  has no renderable chip among the poll options). */
  myTag: string | null;
  /** Winner over VOCABULARY tags only — safe to render via displayTag. */
  winner: VibeTag | null;
  counts: ReadonlyMap<string, number>;
  busy: boolean;
  /** True when the last cast/rescind didn't land (review MED: a silent
   *  no-op tap reads as broken). Cleared on the next attempt. */
  failed: boolean;
  /** Cast/move to `tag`; tapping the tag you already hold rescinds. */
  toggleVote: (tag: VibeTag) => Promise<void>;
};

/**
 * UX-E tonight's-vibe poll state (migration 0017 — dark until applied;
 * fetch errors keep `votes` null and the UI stays invisible).
 */
export function useVibeVotes(): UseVibeVotesReturn {
  const auth = useAuth();
  const [votes, setVotes] = useState<VibeVote[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const night = nycNightKey();
  const userId = auth.status === 'signed-in' ? auth.user.id : null;

  const refresh = useCallback(async (): Promise<void> => {
    // Review HIGH: sign-out must DARKEN the poll — without this reset the
    // last circle's votes (winner chip, favorites boost) survive into
    // the demo/local view.
    if (!userId) {
      setVotes(null);
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const epoch = getCacheEpoch();
    const rows = await fetchCircleVibeVotes(supabase, night);
    if (getCacheEpoch() !== epoch) return;
    // null (dark/error) only ever DARKENS a fresh mount — once live, a
    // transient read error keeps the last good list instead of blanking
    // the poll (0012 review lesson: fetch failure preserves prior state).
    setVotes((prev) => (rows === null ? prev : rows));
  }, [userId, night]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const myTag = useMemo(
    () => votes?.find((v) => v.userId === userId)?.tag ?? null,
    [votes, userId],
  );
  // Vocabulary filter at the TALLY boundary (0008 tolerance: the server
  // stores any tag-shaped text; the vocabulary lives in code) — winner
  // and counts only ever speak real VibeTags. ACCEPTED EDGE (review MED):
  // an own vote whose tag left the vocabulary has no chip among the poll
  // options; casting then MOVEs it — the old vote was un-displayable
  // anyway.
  const { counts, winner } = useMemo(() => {
    const known = (votes ?? []).filter((v) => isKnownTag(v.tag));
    const tally = tallyVibeVotes(known);
    return {
      counts: tally.counts,
      winner:
        tally.winner !== null && isKnownTag(tally.winner)
          ? tally.winner
          : null,
    };
  }, [votes]);

  const toggleVote = useCallback(
    async (tag: VibeTag): Promise<void> => {
      if (!userId || busy) return;
      const supabase = getBrowserSupabase();
      if (!supabase) return;
      // Busy holds THROUGH the refetch (0012 review lesson) so stale
      // derived state can't invert the toggle branch mid-flight.
      setBusy(true);
      setFailed(false);
      try {
        const landed =
          myTag === tag
            ? await rescindVibeVote(supabase, userId, night)
            : await castVibeVote(supabase, night, tag);
        if (!landed) setFailed(true);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [userId, busy, myTag, night, refresh],
  );

  return { votes, myTag, winner, counts, busy, failed, toggleVote };
}
