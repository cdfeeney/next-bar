'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch } from '@/lib/accountCache';
import { fetchNightOutCovers } from '@/lib/nightOutPlan';
import CoverImage from './CoverImage';

/**
 * S-06b — a plan's cover on a surface that already has the plan (the board
 * header, an invitation card). Reads `night_outs.cover` for ONE plan under the
 * member select policy and renders nothing until it lands, nothing for no
 * cover, and nothing for a failed read — the surface then looks exactly as it
 * did before covers existed. `data-plan-cover-state` tells the three apart.
 *
 * ponytail: one read per mount; batch through fetchNightOutCovers if Plans ever
 * lists dozens of invitations.
 */
export default function PlanCover({
  nightOutId,
  className = '',
  showLabel = true,
  testId = 'plan-cover',
}: {
  nightOutId: string;
  className?: string;
  showLabel?: boolean;
  testId?: string;
}): JSX.Element | null {
  const [state, setState] = useState<{ cover: string | null; failed: boolean } | null>(null);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let cancelled = false;
    const epoch = getCacheEpoch();
    setState(null);
    void (async () => {
      const covers = await fetchNightOutCovers(supabase, [nightOutId]);
      if (cancelled || getCacheEpoch() !== epoch) return;
      setState(covers === null ? { cover: null, failed: true } : { cover: covers[nightOutId] ?? null, failed: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [nightOutId]);

  if (state === null || state.failed || state.cover === null) {
    return (
      <span
        hidden
        data-testid={`${testId}-state`}
        data-plan-cover-state={state === null ? 'loading' : state.failed ? 'failed' : 'none'}
      />
    );
  }
  return <CoverImage cover={state.cover} className={className} showLabel={showLabel} testId={testId} />;
}
