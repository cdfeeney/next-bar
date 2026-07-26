'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import type { Bar, VibeTag } from '@/types';
import { vibeMatchBadge } from '@/lib/matching';
import { leadCopy } from '@/lib/travelTime';
import { formatVerified, isFresh } from '@/lib/freshness';
import { barImageUrls } from '@/lib/barVisual';
import OpenNowBadge from '@/components/OpenNowBadge';
import BarVisualTile from '@/components/BarVisualTile';
import BarLightbox from '@/components/BarLightbox';
import RatingBadge from '@/components/RatingBadge';

type ResultCardProps = {
  bar: Bar;
  rank: number;
  miles: number | null;
  userTags: VibeTag[];
};

/**
 * E2.3 photo-first card (R7): when the bar has an ingested photo the card
 * LEADS with it full-bleed — name/neighborhood/price sit on a gradient
 * overlay, Instagram-register not Yelp. Photo-less bars (and live 404s,
 * via onError) fall back to the compact glyph-tile header row.
 *
 * U2-3 (operator decision 2026-07-25): suggestion cards are for DECIDING,
 * not rating — ranking happens on /rankings ("Rank it →" deep-links into
 * the quick-add + comparison chain there). A compact RatingBadge still
 * shows an existing tier. Tapping the photo (or the fallback tile) opens
 * the full-screen BarLightbox (carousel, weekly hours, review).
 */
export default function ResultCard({ bar, rank, miles, userTags }: ResultCardProps) {
  const lead = leadCopy(miles, bar.neighborhood);
  const badge = vibeMatchBadge(userTags, bar.tags);
  const fresh = isFresh(bar.lastVerified);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [heroFailed, setHeroFailed] = useState(false);
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  const photos = barImageUrls(bar);
  const showHero = photos.length > 0 && !heroFailed;
  // Google policy: attribution must render whenever the photo is shown.
  // Index-aligned with the carousel; '' means unknown author.
  const heroAttribution = bar.photoAttributions?.[0] || bar.photoAttribution;
  const review = bar.reviews?.[0];

  return (
    <article className="bg-surface border border-border rounded-3xl overflow-hidden flex flex-col">
      {showHero ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            aria-label={`See photos and hours for ${bar.name}`}
            className="block w-full touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photos[0]}
              alt=""
              data-testid="bar-visual"
              loading="lazy"
              className="w-full aspect-[16/10] object-cover"
              onError={() => setHeroFailed(true)}
            />
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
            />
          </button>
          {photos.length > 1 ? (
            <span className="absolute top-3 right-3 pointer-events-none rounded-full bg-black/60 text-white/90 text-[11px] px-2.5 py-1">
              {photos.length} photos
            </span>
          ) : null}
          <div className="absolute inset-x-0 bottom-0 p-4 pointer-events-none flex flex-col gap-1">
            <h3 className="font-display text-2xl leading-tight text-white drop-shadow-sm">
              {rank}. {bar.name}
            </h3>
            <p className="text-xs uppercase tracking-wider text-white/85">
              {bar.neighborhood} · {'$'.repeat(bar.priceTier)}
            </p>
          </div>
        </div>
      ) : null}

      <div className="p-5 pt-4 flex flex-col gap-3">
        {showHero ? (
          <div className="flex items-center gap-3 flex-wrap">
            <OpenNowBadge bar={bar} />
            <RatingBadge barId={bar.id} />
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label={`See photos and hours for ${bar.name}`}
              className="shrink-0 touch-manipulation rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <BarVisualTile bar={bar} size={56} />
            </button>
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-2xl leading-tight">
                  {rank}. {bar.name}
                </h3>
                <span className="text-muted text-xs shrink-0">
                  {'$'.repeat(bar.priceTier)}
                </span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-muted text-xs uppercase tracking-wider">{bar.neighborhood}</p>
                <OpenNowBadge bar={bar} />
                <RatingBadge barId={bar.id} />
              </div>
            </div>
          </div>
        )}
        {showHero && heroAttribution ? (
          <p className="text-[10px] text-muted leading-tight">
            Photo: {heroAttribution} · Google
          </p>
        ) : null}
        <p className="font-display text-accent text-3xl">{lead.text}</p>
        <p className="text-sm text-muted">
          Vibe match · {badge.num} of {badge.den}
        </p>
        <p className="text-sm italic line-clamp-2">{bar.blurb}</p>
        {review ? (
          <p className="text-xs text-muted line-clamp-2">
            &ldquo;{review.text}&rdquo; &mdash; {review.author}, Google review
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-muted">
            Verified {formatVerified(bar.lastVerified)}
            {!fresh && ' · older info'}
          </p>
          <div className="flex items-center gap-4">
            <Link
              href={`/rankings?add=${bar.id}`}
              className="text-xs text-accent font-display min-h-[56px] inline-flex items-center touch-manipulation hover:underline underline-offset-4"
            >
              Rank it →
            </Link>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                `${bar.name} ${bar.address}`,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent font-display min-h-[56px] inline-flex items-center touch-manipulation hover:underline underline-offset-4"
            >
              Maps →
            </a>
          </div>
        </div>
      </div>

      {lightboxOpen ? (
        <BarLightbox bar={bar} onClose={closeLightbox} />
      ) : null}
    </article>
  );
}
