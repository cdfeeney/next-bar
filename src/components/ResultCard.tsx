'use client';

import { useCallback, useState } from 'react';
import type { Bar, Coords, VibeTag } from '@/types';
import { vibeMatchBadge } from '@/lib/matching';
import { directionsHref, routeCopy, type BarTravel, type TravelMode } from '@/lib/travelTime';
import { barVisual } from '@/lib/barVisual';
import { resolveMedia } from '@/lib/mediaPolicy';
import { buildPickPath, sharePickText } from '@/lib/share';
import { displayHood } from '@/lib/hoodDisplay';
import ShareButton from '@/components/ShareButton';
import OpenNowBadge from '@/components/OpenNowBadge';
import BarVisualTile from '@/components/BarVisualTile';
import BarLightbox from '@/components/BarLightbox';
import RatingBadge from '@/components/RatingBadge';
import GooglePlacePhotoLazy from '@/components/GooglePlacePhotoLazy';

type ResultCardProps = {
  bar: Bar;
  rank: number;
  miles: number | null;
  origin?: Coords;
  travel?: BarTravel;
  travelLoading?: boolean;
  directionsMode?: TravelMode;
  /**
   * The vibes the user EXPLICITLY selected, or [] when no selection is
   * active. NOT the saved quiz profile — a cold-start prior is not a choice,
   * and must not produce a match badge (V8-R-NXT-009 / D-C-41).
   */
  selectedVibes: VibeTag[];
  /** Planning phase (operator 2026-07-27): show the "Send" share — text
   *  the bar to a group; recipients without the app land on /share/[id]. */
  showShare?: boolean;
};

/**
 * QA5-S1 (operator 2026-07-26): the full-bleed photo HERO card returns
 * (E2.3 semantics), but with the identity text kept SMALL — readable,
 * never truncated (wrap allowed). The hero leads 21/9; name +
 * neighborhood + $ sit on a bottom gradient overlay; tapping the hero
 * opens the BarLightbox (carousel, hours, review). Broken photos advance
 * through the carousel then fall back to the glyph tile.
 *
 * Below the hero the card stays terse: one meta line (walk time + vibe
 * match), the open-now/rating badge row, and Maps. Ranking entry moved
 * off result cards entirely (the per-card "Rank it" link is gone —
 * /rankings owns that flow), and the per-card photo attribution line is
 * replaced by the blanket disclosure on /privacy + the lightbox credit.
 */
export default function ResultCard({ bar, rank, selectedVibes, showShare, origin, travel, travelLoading, directionsMode = 'walking' }: ResultCardProps) {
  // null with no explicit selection — there is then no badge to render at all.
  const badge = vibeMatchBadge(selectedVibes, bar.tags);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // A broken photo advances to the NEXT carousel photo before giving up —
  // a multi-photo bar with one corrupt file keeps its photo-first card.
  const [heroIdx, setHeroIdx] = useState(0);
  const [heroFailed, setHeroFailed] = useState(false);
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  const decision = resolveMedia(bar);
  const photos = decision.source === 'glyph' || decision.source === 'google-live'
    ? []
    : decision.urls;
  const showHero = photos.length > 0 && !heroFailed;
  const isGoogleLive = decision.source === 'google-live';
  const mapsHref = directionsHref(origin, bar, directionsMode);
  const fallbackVisual = barVisual(bar);

  return (
    <article data-testid="result-card" className="bg-surface border border-border rounded-3xl overflow-hidden flex flex-col">
      {isGoogleLive ? (
        <GooglePlacePhotoLazy
          placeId={decision.placeId}
          surface="result-card"
          fallback={(
            <div className="relative w-full aspect-[21/9] flex items-center justify-center" style={{ backgroundColor: fallbackVisual.bg, color: fallbackVisual.fg }}>
              <span aria-hidden="true" className="font-display text-4xl">{fallbackVisual.glyph}</span>
              <div className="absolute inset-x-0 bottom-0 px-4 pb-3 pt-12 flex items-end justify-between gap-3 bg-gradient-to-t from-black/85 via-black/40 to-transparent text-white">
                <div className="min-w-0">
                  <h3 className="font-display text-lg leading-snug">{bar.name}</h3>
                  <p className="text-[11px] uppercase tracking-wider">{displayHood(bar.neighborhood)} · {'$'.repeat(bar.priceTier)}</p>
                </div>
                <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs font-display min-h-[44px] inline-flex items-center">Open in Maps</a>
              </div>
            </div>
          )}
        />
      ) : null}
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
              src={photos[heroIdx]}
              alt=""
              data-testid="bar-visual"
              // Rank 1's hero is the likely LCP element — eager.
              loading={rank === 1 ? 'eager' : 'lazy'}
              // Operator 2026-07-27: the old 16/10 banner was "super
              // large" — a shorter 21/9 strip keeps the photo lead while
              // fitting more of the 5-card list on one screen.
              className="w-full aspect-[21/9] object-cover"
              onError={() =>
                heroIdx + 1 < photos.length
                  ? setHeroIdx(heroIdx + 1)
                  : setHeroFailed(true)
              }
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
          <div className="absolute inset-x-0 bottom-0 px-4 pb-3 pointer-events-none flex flex-col gap-0.5">
            {/* Small-but-readable, and it NEVER truncates — long bar names
                wrap onto a second line instead (operator: text-lg max). */}
            <h3 className="font-display text-lg leading-snug text-white drop-shadow-sm">
              {rank}. {bar.name}
            </h3>
            <p className="text-[11px] uppercase tracking-wider text-white/85">
              {displayHood(bar.neighborhood)} · {'$'.repeat(bar.priceTier)}
            </p>
          </div>
        </div>
      ) : null}

      <div className="p-4 pt-3 flex flex-col gap-2">
        {!showHero && !isGoogleLive ? (
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label={`See photos and hours for ${bar.name}`}
              className="shrink-0 touch-manipulation rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <BarVisualTile bar={bar} size={56} />
            </button>
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <h3 className="font-display text-lg leading-snug">
                {rank}. {bar.name}
              </h3>
              <p className="text-[11px] uppercase tracking-wider text-muted">
                {displayHood(bar.neighborhood)} · {'$'.repeat(bar.priceTier)}
              </p>
            </div>
          </div>
        ) : null}

        {/* One meta line: the loud walk/ride time, plus the match count when —
            and only when — the user has an explicit vibe selection active.
            With no selection there is no honest fraction to print, so the
            badge is omitted rather than shown as "0/1". Specs identify a card
            by data-testid="result-card", never by this text. */}
        <p className="text-sm">
          <span className="font-display text-accent">{travelLoading ? 'Calculating walk…' : routeCopy(travel?.walking, 'walking')}</span>
          {badge ? (
            <span className="text-muted" data-testid="vibe-match">
              {' '}· Vibe match {badge.num}/{badge.den}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted">
          {travelLoading ? 'Calculating drive…' : routeCopy(travel?.driving, 'driving')}
        </p>

        {/* flex-wrap (review HIGH): open-badge + rating + Send + Maps can
            exceed a 390px card — wrap instead of clipping under the
            article's overflow-hidden. */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <OpenNowBadge bar={bar} />
            <RatingBadge barId={bar.id} />
            {isGoogleLive ? (
              <button type="button" onClick={() => setLightboxOpen(true)} className="text-xs text-accent font-display min-h-[44px] inline-flex items-center">
                Photos &amp; hours
              </button>
            ) : null}
          </div>
          {showShare ? (
            <ShareButton
              path={buildPickPath(bar.id)}
              text={sharePickText(bar)}
              label="Send"
              ariaLabel={`Send ${bar.name} to friends`}
            />
          ) : null}
          {!isGoogleLive ? <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent font-display min-h-[44px] inline-flex items-center touch-manipulation hover:underline underline-offset-4 shrink-0"
          >
            {directionsMode === 'walking' ? 'Walk' : 'Drive'} Maps →
          </a> : null}
          <a href={directionsHref(origin, bar, directionsMode === 'walking' ? 'driving' : 'walking')}
            target="_blank" rel="noopener noreferrer" className="text-xs text-accent min-h-[44px] inline-flex items-center">
            {directionsMode === 'walking' ? 'Drive' : 'Walk'} directions
          </a>
        </div>
      </div>

      {lightboxOpen ? <BarLightbox bar={bar} onClose={closeLightbox} origin={origin} directionsMode={directionsMode} /> : null}
    </article>
  );
}
