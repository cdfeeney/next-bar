'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { Recap } from '@/lib/recap';
import { barImageUrls } from '@/lib/barVisual';
import BarVisualTile from '@/components/BarVisualTile';
import RatingBadge from '@/components/RatingBadge';

const BarMap = dynamic(() => import('@/components/BarMap'), { ssr: false });

type RecapCardProps = {
  recap: Recap;
};

/**
 * E4.2/E4.5: the morning-after card — last night, composed with zero
 * input (R6). Photo-first (R7): leads with the Loved bar's photo (else
 * the first stop's), then the route in order with the Loved one
 * highlighted, pins of the night on the map, and ONE primary action:
 * rank what's still unrated while it's rememberable.
 */
export default function RecapCard({ recap }: RecapCardProps) {
  const heroBar = recap.loved ?? recap.bars[0];
  // A broken photo degrades to the text header (ResultCard's heroFailed
  // pattern) — never a broken-image glyph under the headline.
  const [heroFailed, setHeroFailed] = useState(false);
  const heroPhoto = heroFailed ? null : (barImageUrls(heroBar)[0] ?? null);
  const stops = recap.bars.length;

  return (
    <section
      data-testid="recap-card"
      className="max-w-md mx-auto bg-surface border border-border rounded-3xl overflow-hidden"
    >
      {heroPhoto ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroPhoto}
            alt=""
            loading="eager"
            className="w-full aspect-[16/9] object-cover"
            onError={() => setHeroFailed(true)}
          />
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
          />
          <div className="absolute inset-x-0 bottom-0 p-4 pointer-events-none">
            <p className="text-xs uppercase tracking-wider text-white/85 mb-1">
              Last night
            </p>
            <h2 className="font-display text-2xl leading-tight text-white drop-shadow-sm">
              {stops === 1 ? 'One stop' : `${stops} stops`}
              {recap.loved ? ` · you loved ${recap.loved.name}` : ''}
            </h2>
          </div>
        </div>
      ) : (
        <div className="px-5 pt-4">
          <p className="text-muted text-xs uppercase tracking-wider mb-1">
            Last night
          </p>
          <h2 className="font-display text-2xl leading-tight">
            {stops === 1 ? 'One stop' : `${stops} stops`}
            {recap.loved ? ` · you loved ${recap.loved.name}` : ''}
          </h2>
        </div>
      )}

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

      <div className="px-5 pb-4">
        <Link
          href="/rankings"
          className="inline-flex items-center min-h-[56px] px-6 rounded-full border border-accent text-accent font-display text-sm touch-manipulation hover:bg-accent hover:text-bg transition-colors"
        >
          {recap.unratedBarIds.length > 0
            ? 'Rank last night →'
            : 'See your rankings →'}
        </Link>
      </div>

      <div className="h-48">
        <BarMap
          bars={recap.bars}
          fitToBars
          highlightIds={recap.loved ? [recap.loved.id] : []}
        />
      </div>
    </section>
  );
}
