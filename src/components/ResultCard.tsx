'use client';

import { useCallback, useState } from 'react';
import type { Bar, VibeTag } from '@/types';
import { vibeMatchBadge } from '@/lib/matching';
import { leadCopy } from '@/lib/travelTime';
import {
  needsGoogleAttribution,
  resolveMedia,
} from '@/lib/mediaPolicy';
import { barVisual } from '@/lib/barVisual';
import GoogleAttribution from '@/components/GoogleAttribution';
import GooglePlacePhotoLazy from '@/components/GooglePlacePhotoLazy';
import { reportGoogleMediaRequest } from '@/lib/mediaMetric';
import { buildPickPath, sharePickText } from '@/lib/share';
import { displayHood } from '@/lib/hoodDisplay';
import ShareButton from '@/components/ShareButton';
import OpenNowBadge from '@/components/OpenNowBadge';
import BarVisualTile from '@/components/BarVisualTile';
import BarLightbox from '@/components/BarLightbox';
import RatingBadge from '@/components/RatingBadge';
import WantToGoToggle from '@/components/WantToGoToggle';

type ResultCardProps = {
  bar: Bar;
  rank: number;
  miles: number | null;
  userTags: VibeTag[];
  /** Planning phase (operator 2026-07-27): show the "Send" share — text
   *  the bar to a group; recipients without the app land on /share/[id]. */
  showShare?: boolean;
  /**
   * True when a saved quiz profile exists even though THIS ranking runs
   * with no vibe tags (the home surface ranks by proximity by operator
   * decision). Telling a fresh quiz-taker to "set a vibe" minutes after
   * the quiz read as the system forgetting them (santa: Kimi,
   * g-65a31bdf) — this switches the unset copy to name the truth: the
   * vibe is off HERE, and Tweak is where it comes into play.
   */
  hasSavedVibe?: boolean;
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
/**
 * What a failed/blocked google-live widget degrades to: the bar's
 * DETERMINISTIC glyph visual at the same reserved 21/9 height, so the card
 * never collapses or shifts when Google media is disabled, blocked, or
 * broken (santa BLOCK, 2026-08-06 — a null fallback dropped the reserved
 * box). Same visual system as BarVisualTile, strip-shaped. By construction
 * it can NEVER reference /bar-photos/ — no owned-photo data is passed into
 * this card, so the glyph is the only permitted degradation.
 */
/** The one Google Maps destination for a bar. Shared so the fallback's
 *  "Open in Maps" and the non-google-live "Maps →" can never drift apart. */
function mapsSearchHref(bar: Bar): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${bar.name} ${bar.address}`,
  )}`;
}

/**
 * The card's rank, rendered the SAME way in every media state.
 *
 * It used to appear in three different shapes depending on which branch
 * rendered: baked into the hero heading as "1. Attaboy", baked into the
 * glyph-row heading the same way, and — on a google-live card — as a small
 * muted "1." leading the walk-time sentence. So the one number that orders
 * the whole list was styled as part of the bar's NAME in two states and as
 * a prefix to an unrelated sentence in the third, and moved position
 * between them (g-65ba768e criterion 2).
 *
 * Now it is one element, in one place — the app-owned meta row, which is
 * the only row that renders in all three states — so scanning down the
 * list gives a single fixed column of ranks. Keeping it out of the heading
 * also stops "1." from being read aloud as part of the bar's name.
 */
function CardRank({ rank }: { rank: number }): JSX.Element {
  return (
    <span
      data-testid="card-rank"
      aria-label={`Rank ${rank}`}
      className="shrink-0 inline-flex items-center justify-center min-w-[1.375rem] h-[1.375rem] px-1 rounded-full bg-accent/15 text-accent font-display text-xs leading-none tabular-nums"
    >
      {rank}
    </span>
  );
}

/**
 * The bar's name, rendered the same way wherever WE own identity.
 *
 * Three things make it cleaner than the raw heading it replaces:
 *   - `break-words` + balanced wrapping, so a long name splits sensibly
 *     instead of forcing the overlay wider than its column;
 *   - `line-clamp-2`, so the longest names in the catalogue
 *     ("La Compagnie des Vins Surnaturels", 33 chars) cannot push the
 *     gradient overlay past the 21/9 strip it is painted on — the case
 *     that made the fallback look broken at 390px;
 *   - `title`, so clamping never hides the full name from a user or from
 *     assistive tech.
 *
 * NOT rendered when Google's widget is showing: the compact widget renders
 * the name itself, and a second copy is the duplication criterion 10
 * forbids.
 */
function CardName({
  bar,
  tone,
}: {
  bar: Bar;
  tone: 'over-image' | 'on-surface';
}): JSX.Element {
  return (
    <h3
      data-testid="card-name"
      title={bar.name}
      className={`font-display text-lg leading-tight break-words [text-wrap:balance] line-clamp-2 ${
        tone === 'over-image' ? 'text-white drop-shadow-sm' : ''
      }`}
    >
      {bar.name}
    </h3>
  );
}

function CardMediaFallback({ bar }: { bar: Bar }): JSX.Element {
  const visual = barVisual(bar);
  return (
    <div className="relative">
      <div
        data-testid="google-fallback-glyph"
        aria-hidden="true"
        className="w-full aspect-[21/9] flex items-center justify-center select-none"
        style={{ backgroundColor: visual.bg, color: visual.fg }}
      >
        <span className="font-display leading-none text-4xl">{visual.glyph}</span>
      </div>
      {/* The bar's IDENTITY lives here, not in the card body.
       *
       * A google-live card deliberately drops our name row because the
       * widget renders the name — but when the widget is unavailable it
       * renders NOTHING, and the first screenshot of this state showed a
       * nameless card: a glyph, a walk time and no way to tell which bar it
       * was. Putting identity inside the FALLBACK gives it exactly when
       * Google is not providing it, and never duplicates it when Google is.
       */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
      />
      <div className="absolute inset-x-0 bottom-0 px-4 pb-3 flex items-end justify-between gap-3">
        <div className="pointer-events-none min-w-0 flex flex-col gap-0.5">
          {/* Name only — the rank lives in the meta row below, which renders
              in BOTH the loaded and fallback states. Repeating it here showed
              "1." twice on the first screenshot of this layout. */}
          <CardName bar={bar} tone="over-image" />
          <p className="text-[11px] uppercase tracking-wider text-white/85 truncate">
            {displayHood(bar.neighborhood)} · {'$'.repeat(bar.priceTier)}
          </p>
        </div>
        {/* THE card's only Maps action in this state.
         *
         * google-live suppresses our Maps link because the widget supplies
         * Google's own — but when the widget fails the widget is GONE, and
         * the card was left with no Maps action at all (verified blocker;
         * the previous test asserted zero and blessed it). This lives
         * inside the fallback rather than behind a status callback, so it
         * is present exactly when the fallback is and absent whenever the
         * widget loaded. */}
        <a
          href={mapsSearchHref(bar)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${bar.name} in Google Maps`}
          className="shrink-0 min-h-[44px] inline-flex items-center text-xs font-display text-white drop-shadow-sm touch-manipulation hover:underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Open in Maps
        </a>
      </div>
    </div>
  );
}

export default function ResultCard({ bar, rank, miles, userTags, showShare, hasSavedVibe }: ResultCardProps) {
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
  /**
   * On a google-live card the compact widget already renders the bar's
   * NAME, its PHOTO, the required ATTRIBUTION and a Maps action. Repeating
   * any of those below it was the duplication the live 390x844 review
   * caught: two names, two Maps links, and a 56px glyph tile beside a photo
   * of the same bar. So this flag suppresses OUR copies — it never touches
   * Google's rendering, which is closed-shadow and must not be styled,
   * moved or hidden.
   */
  const isGoogleLive = decision.source === 'google-live';

  return (
    <article className="bg-surface border border-border rounded-3xl overflow-hidden flex flex-col">
      {decision.source === 'google-live' ? (
        // The compliant live path: Google's own widget renders the photo AND
        // its attribution. Deliberately NOT wrapped in the lightbox button
        // and NOT covered by the bespoke gradient/name overlay — anything
        // painted over the widget risks obscuring the attribution Google
        // requires. Identity text renders in the body row below (the same
        // row the glyph card uses), and the widget's own lightbox handles
        // photo expansion (`lightbox-preferred`).
        <GooglePlacePhotoLazy
          placeId={decision.placeId}
          surface="result-card"
          fallback={<CardMediaFallback bar={bar} />}
          onBillableRequest={reportGoogleMediaRequest}
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
            {/* Small-but-readable. Long names wrap to a second line and stop
                there (operator: text-lg max) — see CardName. */}
            <CardName bar={bar} tone="over-image" />
            <p className="text-[11px] uppercase tracking-wider text-white/85 truncate">
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
              <CardName bar={bar} tone="on-surface" />
              <p className="text-[11px] uppercase tracking-wider text-muted truncate">
                {displayHood(bar.neighborhood)} · {'$'.repeat(bar.priceTier)}
              </p>
            </div>
          </div>
        ) : null}

        {/* One meta line: the loud walk/ride time + the match count several
            e2e specs key on ("Vibe match" — keep those words). With NO vibe
            signal in play a numeric "0/1" badge implied matching that was
            not happening (g-65a31bdf crit 3/5). "Set a vibe" is the honest
            unlock for BOTH states this renders in: a first-timer with no
            profile, and the auto surface, which by operator decision ranks
            on proximity and ignores the saved quiz profile (the quiz/tweak
            surfaces pass real tags and get the numeric badge). */}
        {/* Two lines instead of one run-on sentence (criterion 3).
            Previously rank, walk time and vibe state were three unrelated
            facts concatenated into a single <p> with " · " glue, so the
            primary fact (how far away it is) carried the same weight as the
            secondary one (whether a vibe is in play) and the rank was easy
            to miss between them. Splitting them gives the card a real
            hierarchy: rank + distance lead, vibe state supports.

            Rank survives the removal of our identity row in the google-live
            state — Google's widget renders the name but has no notion of
            OUR ranking. */}
        <div className="flex items-center gap-2">
          <CardRank rank={rank} />
          <p className="min-w-0 text-sm font-display text-accent truncate">
            {lead.text}
          </p>
        </div>
        {/* One element, one contiguous string — e2e keys on the exact
            "Vibe match off — Tweak to use yours" phrasing. */}
        <p className="text-xs text-muted">
          {userTags.length === 0
            ? hasSavedVibe
              ? 'Vibe match off — Tweak to use yours'
              : 'Vibe match after you set a vibe'
            : `Vibe match ${badge.num}/${badge.den}`}
        </p>

        {/* flex-wrap (review HIGH): open-badge + rating + Send + Maps can
            exceed a 390px card — wrap instead of clipping under the
            article's overflow-hidden. */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <OpenNowBadge bar={bar} />
            <RatingBadge barId={bar.id} />
            <WantToGoToggle barId={bar.id} barName={bar.name} />
            {/* Removing the glyph tile removed the lightbox opener with it,
                and the lightbox is where the app's OWN content lives (full
                weekly hours). This restores that one entry point without
                reintroducing any name/photo/Maps duplication. */}
            {isGoogleLive ? (
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                aria-label={`See hours for ${bar.name}`}
                className="text-xs text-accent font-display min-h-[44px] inline-flex items-center touch-manipulation hover:underline underline-offset-4"
              >
                Hours
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
          {/* ONE Maps action per card. On a google-live card the compact
              widget supplies Google's own supported Maps action, so ours
              would be the second one — removed here rather than by hiding
              Google's, which we must never do. */}
          {!isGoogleLive ? (
            <a
              href={mapsSearchHref(bar)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent font-display min-h-[44px] inline-flex items-center touch-manipulation hover:underline underline-offset-4 shrink-0"
            >
              Maps →
            </a>
          ) : null}
        </div>
      </div>

      {lightboxOpen ? <BarLightbox bar={bar} onClose={closeLightbox} /> : null}
    </article>
  );
}
