'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import type { Bar, VibeTag } from '@/types';
import { vibeMatchBadge } from '@/lib/matching';
import { leadCopy } from '@/lib/travelTime';
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
 * COMPACT card (operator 2026-07-26: "they are drunk — they need the
 * next bar in 10 seconds"). ~3 bars per phone screen: small photo tile,
 * name + walk time as the loud data, one meta line, tiny actions. The
 * full-bleed hero, blurb, and review quote moved into the lightbox —
 * tap the photo for the big version. Broken photos advance through the
 * carousel then fall back to the glyph tile (E2.3 semantics kept).
 * U2-3: cards are for DECIDING — ranking lives on /rankings.
 */
export default function ResultCard({ bar, rank, miles, userTags }: ResultCardProps) {
  const lead = leadCopy(miles, bar.neighborhood);
  const badge = vibeMatchBadge(userTags, bar.tags);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [thumbIdx, setThumbIdx] = useState(0);
  const [thumbFailed, setThumbFailed] = useState(false);
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  const photos = barImageUrls(bar);
  const showThumb = photos.length > 0 && !thumbFailed;
  // Multi-ingest bars must NOT fall back to the legacy field — it can
  // hold a stale author from an older single-photo ingest (E2.3 review
  // rule, re-caught by this rewrite's review).
  const attribution = bar.photoAttributions
    ? bar.photoAttributions[thumbIdx] || null
    : bar.photoAttribution;

  return (
    <article className="bg-surface border border-border rounded-2xl p-3 flex gap-3">
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        aria-label={`See photos and hours for ${bar.name}`}
        className="shrink-0 touch-manipulation rounded-xl overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-accent self-start"
      >
        {showThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photos[thumbIdx]}
            alt=""
            data-testid="bar-visual"
            loading={rank === 1 ? 'eager' : 'lazy'}
            className="w-20 h-20 object-cover"
            onError={() =>
              thumbIdx + 1 < photos.length
                ? setThumbIdx(thumbIdx + 1)
                : setThumbFailed(true)
            }
          />
        ) : (
          <BarVisualTile bar={bar} size={56} photoDisabled={thumbFailed} />
        )}
      </button>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* The NAME owns its full line (operator: "I can't see the name
            of the bars") — it may wrap to two lines; nothing competes
            with it. Walk time leads the meta line instead. */}
        <h3 className="font-display text-base leading-tight">
          {rank}. {bar.name}
        </h3>
        <p className="text-xs truncate">
          <span className="font-display text-accent">{lead.text}</span>
          <span className="text-muted">
            {' '}· {bar.neighborhood} · {'$'.repeat(bar.priceTier)} · Vibe
            match {badge.num}/{badge.den}
          </span>
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <OpenNowBadge bar={bar} />
          <RatingBadge barId={bar.id} />
        </div>
        <div className="flex items-center justify-between gap-2">
          {showThumb ? (
            // Google policy: attribution renders whenever a photo does.
            <p className="text-[9px] text-muted leading-tight truncate">
              {attribution ? `Photo: ${attribution} · Google` : 'Photo · Google'}
            </p>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href={`/rankings?add=${bar.id}`}
              className="text-xs text-accent font-display min-h-[44px] inline-flex items-center touch-manipulation hover:underline underline-offset-4"
            >
              Rank it →
            </Link>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                `${bar.name} ${bar.address}`,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent font-display min-h-[44px] inline-flex items-center touch-manipulation hover:underline underline-offset-4"
            >
              Maps →
            </a>
          </div>
        </div>
      </div>

      {lightboxOpen ? <BarLightbox bar={bar} onClose={closeLightbox} /> : null}
    </article>
  );
}
