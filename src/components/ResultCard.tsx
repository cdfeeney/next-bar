'use client';

import { useCallback, useState } from 'react';
import type { Bar, VibeTag } from '@/types';
import { vibeMatchBadge } from '@/lib/matching';
import { leadCopy } from '@/lib/travelTime';
import {
  needsGoogleAttribution,
  resolveMedia,
} from '@/lib/mediaPolicy';
import GoogleAttribution from '@/components/GoogleAttribution';
import { buildPickPath, sharePickText } from '@/lib/share';
import { displayHood } from '@/lib/hoodDisplay';
import ShareButton from '@/components/ShareButton';
import OpenNowBadge from '@/components/OpenNowBadge';
import BarVisualTile from '@/components/BarVisualTile';
import BarLightbox from '@/components/BarLightbox';
import RatingBadge from '@/components/RatingBadge';

type ResultCardProps = {
  bar: Bar;
  rank: number;
  miles: number | null;
  userTags: VibeTag[];
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
export default function ResultCard({ bar, rank, miles, userTags, showShare }: ResultCardProps) {
  const lead = leadCopy(miles, displayHood(bar.neighborhood));
  const badge = vibeMatchBadge(userTags, bar.tags);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // A broken photo advances to the NEXT carousel photo before giving up —
  // a multi-photo bar with one corrupt file keeps its photo-first card.
  const [heroIdx, setHeroIdx] = useState(0);
  const [heroFailed, setHeroFailed] = useState(false);
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  // Criterion 12/13: the hero is an ALLOWED Google surface (a visible
  // recommendation card), but it must resolve through the one media policy
  // rather than building /bar-photos/... URLs itself — otherwise the kill
  // switch cannot reach it. The bespoke overlay below (gradient, photo
  // count, name) is why this uses resolveMedia directly instead of the
  // <BarMedia> wrapper: same boundary, different chrome.
  const decision = resolveMedia(bar);
  const photos =
    decision.source === 'glyph' || decision.source === 'google-live'
      ? []
      : decision.urls;
  const showHero = photos.length > 0 && !heroFailed;

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

      {/* Criterion 4: visible attribution wherever Google-derived imagery is
          shown. Sits directly under the hero it refers to. */}
      {showHero && needsGoogleAttribution(decision) ? (
        <GoogleAttribution bar={bar} label="Photo via Google" className="px-4 pt-2" />
      ) : null}

      <div className="p-4 pt-3 flex flex-col gap-2">
        {!showHero ? (
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

        {/* One meta line: the loud walk/ride time + the match count several
            e2e specs key on ("Vibe match" — keep those words). */}
        <p className="text-sm">
          <span className="font-display text-accent">{lead.text}</span>
          <span className="text-muted">
            {' '}· Vibe match {badge.num}/{badge.den}
          </span>
        </p>

        {/* flex-wrap (review HIGH): open-badge + rating + Send + Maps can
            exceed a 390px card — wrap instead of clipping under the
            article's overflow-hidden. */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <OpenNowBadge bar={bar} />
            <RatingBadge barId={bar.id} />
          </div>
          {showShare ? (
            <ShareButton
              path={buildPickPath(bar.id)}
              text={sharePickText(bar)}
              label="Send"
              ariaLabel={`Send ${bar.name} to friends`}
            />
          ) : null}
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              `${bar.name} ${bar.address}`,
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent font-display min-h-[44px] inline-flex items-center touch-manipulation hover:underline underline-offset-4 shrink-0"
          >
            Maps →
          </a>
        </div>
      </div>

      {lightboxOpen ? <BarLightbox bar={bar} onClose={closeLightbox} /> : null}
    </article>
  );
}
