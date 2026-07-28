'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Bar } from '@/types';
import { resolveMedia } from '@/lib/mediaPolicy';
import { hoursProvenanceNote, weekHoursRows } from '@/lib/openNow';
import GoogleAttribution from '@/components/GoogleAttribution';
import { displayHood } from '@/lib/hoodDisplay';
import OpenNowBadge from '@/components/OpenNowBadge';

/**
 * U2-2: photo headliner. Tapping a card's photo opens this full-screen
 * overlay — big image, the bar's identity, FULL weekly hours (U2-1), the
 * review quote, and the two actions (Maps, Rank it). Single cached photo
 * today; when the ingest starts storing multiple photoRefs this becomes a
 * swipeable carousel without changing the entry point.
 *
 * Scroll-lock note: plain save/restore is safe here because no overlay
 * ever NESTS inside the lightbox — "Rank it" navigates to /rankings,
 * unmounting this first (reviewed; revisit with a lock-counter if an
 * in-place sheet is ever added).
 *
 * A11y (Opus review): dialog semantics; Escape + backdrop close; focus
 * moves to ✕ on open, Tab CYCLES inside the dialog (minimal trap), and
 * on unmount focus RETURNS to whatever opened the lightbox (captured
 * activeElement) — unmounting a focused node otherwise drops focus to
 * <body> and strands keyboard users at the top of the page.
 */
export default function BarLightbox({
  bar,
  onClose,
}: {
  bar: Bar;
  onClose: () => void;
}): JSX.Element {
  // Criterion 12 permits Google media in the OPEN lightbox, but criterion 13
  // requires the kill switch to reach every Google surface — so this resolves
  // through the one policy rather than building /bar-photos/... URLs itself.
  // Visible attribution is already rendered below via <GoogleAttribution>.
  const decision = resolveMedia(bar);
  const photoUrls =
    decision.source === 'glyph' || decision.source === 'google-live'
      ? []
      : decision.urls;
  const [activePhoto, setActivePhoto] = useState(0);
  // Google review text and author names are no longer rendered anywhere, and no
  // longer exist to render: migration 0023 nulled bars.reviews (220 rows / 660
  // items) and the 2026-07-28 sidecar strip removed 750 more items from 250
  // entries in bars.places.ts. Places terms do not permit storing review
  // content, and unlike hours it has no compliant first-party equivalent — the
  // fix is not to keep it. The fetch path (lib/barReviews.ts) and the merge in
  // lib/bars.ts went with it, so there is no route back for this data.
  const trackRef = useRef<HTMLDivElement | null>(null);
  // Scroll-snap position → active dot (passive listener; index from the
  // nearest slide edge).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = (): void => {
      const idx = Math.round(track.scrollLeft / track.clientWidth);
      setActivePhoto((prev) => (prev === idx ? prev : idx));
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => track.removeEventListener('scroll', onScroll);
  }, []);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Ref-carried close handler (Opus review): ResultCard passes an inline
  // lambda, and having it in the effect deps re-ran the whole effect on
  // every parent re-render — stealing focus back to ✕ mid-interaction.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Hours are time-dependent → client-only state, set after mount (same
  // hydration rule as OpenNowBadge).
  const [rows, setRows] = useState<ReturnType<typeof weekHoursRows>>(null);

  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeRef.current?.focus();
    setRows(weekHoursRows(bar.hours, new Date()));
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      // Minimal focus trap (Opus review): Tab cycles within the dialog.
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!dialogRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    // Lock background scroll while open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
  }, [bar]);

  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${bar.name} ${bar.address}`,
  )}`;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${bar.name} details`}
      className="fixed inset-0 z-[1500] bg-bg/95 backdrop-blur-sm overflow-y-auto overscroll-contain"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-w-lg mx-auto min-h-full px-4 py-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-accent uppercase tracking-[0.25em] text-xs">
            {displayHood(bar.neighborhood)} · {'$'.repeat(bar.priceTier)}
          </p>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] touch-manipulation rounded-full border border-border text-muted hover:text-text text-lg"
          >
            ✕
          </button>
        </div>

        {photoUrls.length > 0 ? (
          <figure className="rounded-3xl overflow-hidden border border-border">
            {/* U2-2 carousel (photos-multi ingest): CSS scroll-snap — swipe
                on touch, scroll on desktop, no library. */}
            <div
              ref={trackRef}
              className="flex overflow-x-auto snap-x snap-mandatory scrollbar-none"
              style={{ scrollbarWidth: 'none' }}
              aria-label={`${bar.name} photos, ${photoUrls.length} total`}
            >
              {photoUrls.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- local cached JPEGs
                <img
                  key={url}
                  src={url}
                  alt={`${bar.name} — photo ${i + 1} of ${photoUrls.length}`}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  className="w-full shrink-0 snap-center h-auto max-h-[55vh] object-cover"
                />
              ))}
            </div>
            <figcaption className="flex items-center justify-between text-[10px] text-muted px-3 py-1.5">
              <span>
                {(bar.photoAttributions?.[activePhoto] || bar.photoAttribution)
                  ? `Photo: ${bar.photoAttributions?.[activePhoto] || bar.photoAttribution} · Google`
                  : 'Photo · Google'}
              </span>
              {photoUrls.length > 1 ? (
                <span className="flex items-center gap-1.5" aria-hidden>
                  {photoUrls.map((url, i) => (
                    <span
                      key={url}
                      className={[
                        'inline-block h-1.5 w-1.5 rounded-full transition-colors',
                        i === activePhoto ? 'bg-accent' : 'bg-border',
                      ].join(' ')}
                    />
                  ))}
                </span>
              ) : null}
            </figcaption>
          </figure>
        ) : null}

        <div>
          <h2 className="font-display text-3xl leading-tight mb-1">
            {bar.name}
          </h2>
          <div className="flex items-center gap-3">
            <p className="text-muted text-xs">{bar.address}</p>
            <OpenNowBadge bar={bar} />
          </div>
        </div>

        <p className="text-sm italic">{bar.blurb}</p>


        {rows ? (
          <div className="bg-surface border border-border rounded-2xl p-4">
            <h3 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
              Hours
            </h3>
            <table className="w-full text-sm">
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.day}
                    className={r.isToday ? 'text-accent' : 'text-muted'}
                  >
                    <td className="py-0.5 pr-4 font-display w-14">{r.day}</td>
                    <td className="py-0.5">{r.hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Names the actual source rather than asserting a generic
                "confirmed with the venue", which stopped being true once
                OpenStreetMap rows existed. Also carries the ODbL credit for
                OSM-derived hours, at the point of display. */}
            <p className="text-[10px] text-muted mt-2">{hoursProvenanceNote(bar)}</p>
          </div>
        ) : null}

        {/* Required whenever Places-derived content is on screen without a
            Google map — this is the permission that lets us keep Leaflet. */}
        <GoogleAttribution bar={bar} />

        <div className="flex items-center gap-3 pb-4">
          <Link
            href={`/rankings?add=${bar.id}`}
            className="flex-1 text-center bg-accent hover:bg-accentDim transition-colors text-bg font-display text-sm py-3 rounded-full min-h-[44px] touch-manipulation"
          >
            Rank it →
          </Link>
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center border border-border text-text font-display text-sm py-3 rounded-full min-h-[44px] touch-manipulation hover:border-accent transition-colors"
          >
            View on Maps
          </a>
        </div>
      </div>
    </div>
  );
}
