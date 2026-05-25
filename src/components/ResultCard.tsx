'use client';

import type { Bar, VibeTag } from '@/types';
import { vibeMatchBadge } from '@/lib/matching';
import { leadCopy } from '@/lib/travelTime';
import { formatVerified, isFresh } from '@/lib/freshness';
import RatingControl from '@/components/RatingControl';

type ResultCardProps = {
  bar: Bar;
  rank: number;
  miles: number | null;
  userTags: VibeTag[];
};

export default function ResultCard({ bar, rank, miles, userTags }: ResultCardProps) {
  const lead = leadCopy(miles, bar.neighborhood);
  const badge = vibeMatchBadge(userTags, bar.tags);
  const fresh = isFresh(bar.lastVerified);
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${bar.name} ${bar.address}`,
  )}`;

  return (
    <article className="bg-surface border border-border rounded-3xl p-5 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-2xl leading-tight">
          {rank}. {bar.name}
        </h3>
        <span className="text-muted text-xs shrink-0">
          {'$'.repeat(bar.priceTier)}
        </span>
      </div>
      <p className="text-muted text-xs uppercase tracking-wider">{bar.neighborhood}</p>
      <p className="font-display text-accent text-3xl">{lead.text}</p>
      <p className="text-sm text-muted">
        Vibe match · {badge.num} of {badge.den}
      </p>
      <p className="text-sm italic line-clamp-2">{bar.blurb}</p>

      <RatingControl barId={bar.id} />

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-xs text-muted">
          Verified {formatVerified(bar.lastVerified)}
          {!fresh && ' · older info'}
        </p>
        <a
          href={mapsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-accent font-display min-h-[44px] inline-flex items-center touch-manipulation hover:underline underline-offset-4"
        >
          View on Maps →
        </a>
      </div>
    </article>
  );
}
