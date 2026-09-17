'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { Recap } from '@/lib/recap';
import BarVisualTile from '@/components/BarVisualTile';
import RatingBadge from '@/components/RatingBadge';
import ShareNightButton from '@/components/ShareNightButton';

// R-05a: the inert embed built for the saved-night recap (S-08b), not BarMap —
// BarMap fills a fixed box only in `fill` mode and that mode's control offset
// (globals.css) is sized for a full-page map, so inside a 192px block its
// controls mispositioned. SavedNightMap has no controls to misplace.
const SavedNightMap = dynamic(() => import('@/components/SavedNightMap'), { ssr: false });

type RecapCardProps = {
  recap: Recap;
};

/**
 * E4.2/E4.5: the morning-after card — last night, composed with zero
 * input (R6). Shows the route in order with the Loved bar
 * highlighted, pins of the night on the map, and ONE primary action:
 * rank what's still unrated while it's rememberable.
 */
export default function RecapCard({ recap }: RecapCardProps) {
  const stops = recap.bars.length;

  return (
    <section
      data-testid="recap-card"
      className="max-w-md mx-auto bg-surface border border-border rounded-3xl overflow-hidden"
    >
      <div className="px-5 pt-4">
        <p className="text-muted text-xs uppercase tracking-wider mb-1">
          Last night
        </p>
        <h2 className="font-display text-2xl leading-tight">
          {stops === 1 ? 'One stop' : `${stops} stops`}
          {recap.loved ? ` · you loved ${recap.loved.name}` : ''}
        </h2>
      </div>

      <ol className="px-5 py-4 flex flex-col gap-3">
        {recap.bars.map((bar, i) => (
          <li key={`${bar.id}-${i}`} className="flex items-center gap-3">
            <span className="text-muted text-xs font-display w-4 shrink-0">
              {i + 1}
            </span>
            <BarVisualTile bar={bar} size={32} />
            <span className="flex-1 min-w-0 truncate font-display text-sm">
              {bar.name}
              {recap.loved?.id === bar.id ? (
                // Decorative — the headline already says "you loved X".
                <span className="text-accent" aria-hidden="true"> ♥</span>
              ) : null}
            </span>
            <RatingBadge barId={bar.id} />
          </li>
        ))}
      </ol>

      <div className="px-5 pb-4 flex items-center gap-3 flex-wrap">
        <Link
          href="/rankings"
          className="inline-flex items-center min-h-[56px] px-6 rounded-full border border-accent text-accent font-display text-sm touch-manipulation hover:bg-accent hover:text-bg transition-colors"
        >
          {recap.unratedBarIds.length > 0
            ? 'Rank last night →'
            : 'See your rankings →'}
        </Link>
        {/* E4.4: publish + share the night (signed-in with a handle only —
            renders nothing otherwise). */}
        <ShareNightButton recap={recap} />
      </div>

      {recap.bars.length > 0 ? (
        <div className="h-48" data-testid="recap-card-map">
          <SavedNightMap
            bars={recap.bars}
            highlightIds={recap.loved ? [recap.loved.id] : []}
          />
        </div>
      ) : null}
    </section>
  );
}
