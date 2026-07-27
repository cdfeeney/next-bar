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

const KNOWN_TAGS: ReadonlySet<string> = new Set(TAG_VOCABULARY);

export type UseVibeVotesReturn = {
  /** null = dark (unapplied migration 0017 / signed out / load error) —
   *  callers render nothing. [] = live with no votes yet. */
  votes: VibeVote[] | null;
  /** The caller's own current vote tag, if any. */
  myTag: string | null;
  winner: string | null;
  counts: ReadonlyMap<string, number>;
  busy: boolean;
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
  const night = nycNightKey();
  const userId = auth.status === 'signed-in' ? auth.user.id : null;

  const refresh = useCallback(async (): Promise<void> => {
    if (!userId) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const epoch = getCacheEpoch();
    const rows = await fetchCircleVibeVotes(supabase, night);
    if (getCacheEpoch() !== epoch) return;
    // null (dark/error) only ever DARKENS a fresh mount — once live, a
    // transient read error keeps the last good list instead of blanking
    // the poll (0012 review lesson: fetch failure preserves prior state).
    // Unknown tags are display-filtered here (0008 tolerance: the server
    // stores any tag-shaped text; the vocabulary lives in code) — so
    // winner/counts only ever speak real VibeTags.
    setVotes((prev) =>
      rows === null ? prev : rows.filter((r) => KNOWN_TAGS.has(r.tag)),
    );
  }, [userId, night]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const myTag = useMemo(
    () => votes?.find((v) => v.userId === userId)?.tag ?? null,
    [votes, userId],
  );
  const { counts, winner } = useMemo(
    () => tallyVibeVotes(votes ?? []),
    [votes],
  );

  const toggleVote = useCallback(
    async (tag: VibeTag): Promise<void> => {
      if (!userId || busy) return;
      const supabase = getBrowserSupabase();
      if (!supabase) return;
      // Busy holds THROUGH the refetch (0012 review lesson) so stale
      // derived state can't invert the toggle branch mid-flight.
      setBusy(true);
      try {
        if (myTag === tag) {
          await rescindVibeVote(supabase, userId, night);
        } else {
          await castVibeVote(supabase, night, tag);
        }
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [userId, busy, myTag, night, refresh],
  );

  return { votes, myTag, winner, counts, busy, toggleVote };
}
