'use client';

import { useState } from 'react';
import TonightPresence from './_components/TonightPresence';
import PlansSection from './_components/PlansSection';
import GroupsAndPeople, {
  GROUPS_AND_PEOPLE_ID,
} from './_components/GroupsAndPeople';
import { useFollowRequests } from '@/hooks/useFollowRequests';
import { useNightRefresh } from '@/hooks/useIntent';
import { nycNightKey } from '@/lib/nightKey';

/**
 * /friends — SOCIAL, per `docs/design-reference/approved/next-bar-social-v2-core.png`.
 *
 * This replaces the 2026-07-26 Instagram-model Friends dashboard (one action
 * card, a tonight strip, two stats, then search). The approved surface is
 * organised the other way round: presence first, coordination second, and the
 * people graph behind one `Groups & people` control — "everything involving
 * other people", in the canvas's words.
 *
 * Scope boundary with the next lane, stated so it is not mistaken for a gap:
 * the canvas's TONIGHT / PLANS / FEED sub-tab chrome, the Stories rail, the
 * story viewer and the capture pipeline are `g-f1e128da`, which inherits this
 * route once this goal completes. Tonight and Plans are therefore stacked
 * sections here — the shape that lane's spec records as the state it takes
 * over — and Feed is absent rather than faked, because no photo-memory data
 * flow exists to render.
 */
export default function SocialPage(): JSX.Element {
  const { requests } = useFollowRequests();
  // Night-scoped header line, on the shared clock signal so it re-labels at
  // the 6am rollover without a reload.
  const [night, setNight] = useState(() => nycNightKey());
  useNightRefresh(() => setNight(nycNightKey()));

  return (
    <main className="min-h-screen pb-28">
      <header className="px-6 pt-8 pb-4 max-w-md mx-auto w-full flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl uppercase tracking-[0.14em]">
            Next Bar
          </h1>
          <p className="text-muted text-sm mt-1">{weekdayOf(night)}</p>
        </div>
        {/* The canvas's one header control. An in-page anchor for now — see
            the sub-tab boundary in this file's header comment. */}
        <a
          href={`#${GROUPS_AND_PEOPLE_ID}`}
          className="shrink-0 flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 min-h-[44px] touch-manipulation text-[11px] font-display uppercase tracking-widest text-text hover:border-accent transition-colors"
        >
          Groups &amp; people
          {requests.length > 0 ? (
            <span className="rounded-full bg-accent text-bg px-2 py-0.5 text-[11px] tabular-nums">
              {requests.length}
              <span className="sr-only"> follow requests waiting</span>
            </span>
          ) : null}
        </a>
      </header>

      <div className="max-w-md mx-auto px-6 space-y-10">
        <TonightPresence />
        <PlansSection />
        <GroupsAndPeople />
      </div>
    </main>
  );
}

/**
 * "Friday" from a night key, the header line the canvas draws.
 *
 * UTC on purpose, matching the night-key convention shared with PlanInvites
 * and `/night-out/[token]`: the key is a calendar day, not an instant, so
 * letting the device's zone shift it would name the wrong weekday for anyone
 * west of the line.
 */
function weekdayOf(night: string): string {
  const parsed = new Date(`${night}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 'Tonight';
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}
