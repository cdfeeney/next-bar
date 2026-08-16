'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Bar } from '@/types';
import { barVisual } from '@/lib/barVisual';
import { fetchBarDetails, type BarDetails } from '@/lib/barReviews';
import { resolveMedia } from '@/lib/mediaPolicy';
import { weekHoursRows } from '@/lib/openNow';
import { displayHood } from '@/lib/hoodDisplay';
import { displayTag, topVenueTags } from '@/lib/tagDisplay';
import { lockBodyScroll } from '@/lib/bodyScrollLock';
import { cycleFocusWithin } from '@/lib/focusTrap';
import OpenNowBadge from '@/components/OpenNowBadge';
import GooglePlacePhotoLazy from '@/components/GooglePlacePhotoLazy';

/**
 * U2-2: photo headliner. Tapping a card's photo opens this full-screen
 * overlay — big image, the bar's identity, FULL weekly hours (U2-1), the
 * review quote, and the two actions (Maps, Rank it). Single cached photo
 * today; when the ingest starts storing multiple photoRefs this becomes a
 * swipeable carousel without changing the entry point.
 *
 * Scroll lock is shared with the other overlays and restores both body
 * styles and the page position when the dialog closes.
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
  const [details, setDetails] = useState<BarDetails | undefined>(undefined);
  const [detailStatus, setDetailStatus] = useState<
    'loading' | 'ready' | 'unavailable'
  >('loading');
  const displayBar = details ? { ...bar, ...details } : bar;
  const media = resolveMedia(displayBar);
  const photoUrls =
    media.source === 'glyph' || media.source === 'google-live' ? [] : media.urls;
  const fallbackVisual = barVisual(displayBar);
  const [activePhoto, setActivePhoto] = useState(0);
  // Heavy detail fields are absent from the initial catalog payload and
  // load only for the bar the user opens.
  useEffect(() => {
    // Drop the previous bar's fetched details FIRST. Today ResultCard
    // unmounts the lightbox on close so this can't bite, but any future
    // caller that keeps it mounted and swaps `bar` would otherwise
    // attribute one bar's details to a different bar.
    setDetails(undefined);
    setDetailStatus('loading');
    let cancelled = false;
    void (async () => {
      const fetched = await fetchBarDetails(bar.id);
      if (cancelled) return;
      if (fetched) {
        setDetails(fetched);
        setDetailStatus('ready');
      } else {
        setDetailStatus('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bar.id]);
  const reviews = displayBar.reviews;
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
  }, [photoUrls.length]);
  // The non-swipe path: drive the same scroll-snap track the swipe uses, so
  // there is one source of truth for which photo is showing.
  const scrollToPhoto = (index: number): void => {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.max(0, Math.min(index, photoUrls.length - 1));
    // An EXPLICIT ScrollToOptions behavior is not overridden by CSS
    // scroll-behavior, and the reduced-motion rule targets <html> (the property
    // does not inherit to this track). Hard-coding 'smooth' would make the very
    // control added for the non-swipe contract violate the reduced-motion one,
    // so ask the media query directly.
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    track.scrollTo({
      left: clamped * track.clientWidth,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  };
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
      // Minimal focus trap (Opus review): Tab cycles within the dialog. Now
      // shared with the other two aria-modal overlays via cycleFocusWithin —
      // triplicating this is how they drifted apart.
      cycleFocusWithin(dialogRef.current, e);
    };
    window.addEventListener('keydown', onKey);
    const unlockScroll = lockBodyScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      unlockScroll();
      // preventScroll: focus() otherwise scrolls the opener back into view and
      // overrides the position unlockScroll() just restored (observed landing
      // ~43px short in native-shell-contract.spec.ts).
      opener?.focus({ preventScroll: true });
    };
  }, [bar]);

  // V8-5: at most five tags, chosen by the one priority rule in tagDisplay.
  // BarDetails cannot carry tags, so `bar` is the whole truth here.
  const venueTags = topVenueTags(bar.tags);

  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    displayBar.address
      ? `${bar.name} ${displayBar.address}`
      : `${bar.lat},${bar.lng}`,
  )}`;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${bar.name} details`}
      className="fixed inset-0 z-[1500] bg-bg/95 backdrop-blur-sm overflow-y-auto overscroll-contain scrollbar-none"
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

        {media.source === 'google-live' ? (
          <figure className="rounded-3xl border border-border">
            <GooglePlacePhotoLazy
              placeId={media.placeId}
              surface="bar-lightbox"
              fallback={(
                <div
                  className="relative w-full aspect-[21/9] rounded-3xl flex items-center justify-center"
                  style={{
                    backgroundColor: fallbackVisual.bg,
                    color: fallbackVisual.fg,
                  }}
                >
                  <span aria-hidden="true" className="font-display text-5xl">
                    {fallbackVisual.glyph}
                  </span>
                </div>
              )}
            />
          </figure>
        ) : photoUrls.length > 0 ? (
          <figure className="rounded-3xl overflow-hidden border border-border">
            {/* U2-2 carousel (photos-multi ingest): CSS scroll-snap — swipe
                on touch, scroll on desktop, no library. */}
            <div
              ref={trackRef}
              // data-carousel marks this as the ONE intentional horizontal
              // scroller (V8 contract 5); native-shell-contract.spec.ts fails
              // any untagged one, and requires a tagged one to carry the
              // non-swipe controls below.
              data-carousel
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
                {(displayBar.photoAttributions?.[activePhoto] || displayBar.photoAttribution)
                  ? `Photo: ${displayBar.photoAttributions?.[activePhoto] || displayBar.photoAttribution} · Google`
                  : 'Photo · Google'}
              </span>
              {photoUrls.length > 1 ? (
                // Contract 5: a carousel needs an accessible NON-SWIPE path.
                // The dots alone are decorative (aria-hidden) and unreachable
                // by keyboard, so pair them with real Prev/Next buttons that
                // drive the same scroll-snap track.
                <span className="flex items-center gap-2">
                  {/* aria-disabled, not disabled: a focused button that becomes
                      `disabled` at an end drops focus to <body>, so a keyboard
                      user paging to the last photo loses their place. */}
                  <button
                    type="button"
                    onClick={() => scrollToPhoto(activePhoto - 1)}
                    aria-disabled={activePhoto === 0}
                    aria-label="Previous photo"
                    className="min-h-[44px] min-w-[44px] touch-manipulation rounded-full text-muted aria-disabled:opacity-40 hover:text-text"
                  >
                    ‹
                  </button>
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
                  <button
                    type="button"
                    onClick={() => scrollToPhoto(activePhoto + 1)}
                    aria-disabled={activePhoto === photoUrls.length - 1}
                    aria-label="Next photo"
                    className="min-h-[44px] min-w-[44px] touch-manipulation rounded-full text-muted aria-disabled:opacity-40 hover:text-text"
                  >
                    ›
                  </button>
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
            <p className="text-muted text-xs">{displayBar.address}</p>
            <OpenNowBadge bar={bar} />
          </div>
        </div>

        {detailStatus === 'loading' ? (
          <p role="status" className="text-xs text-muted">Loading details…</p>
        ) : detailStatus === 'unavailable' ? (
          <p role="alert" className="text-xs text-muted">
            Extra details are unavailable right now.
          </p>
        ) : null}

        {displayBar.blurb ? <p className="text-sm italic">{displayBar.blurb}</p> : null}

        {reviews?.[0] ? (
          <p className="text-xs text-muted">
            &ldquo;{reviews[0].text}&rdquo; &mdash; {reviews[0].author}, Google
            review
          </p>
        ) : null}

        {rows ? (
          <div className="bg-surface border border-border rounded-2xl p-4">
            <h3 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
              Hours
            </h3>
            <table className="w-full text-sm">
              <tbody>
                {/* Locked reference POLISH 4: the current row is labelled
                    "Today" with a restrained accent rule and tint — NOT colour
                    alone. `text-accent` on its own is invisible to anyone who
                    cannot separate coral from grey, which is the one thing the
                    recovered token list rules out ("state never conveyed by
                    color alone"). */}
                {rows.map((r) => (
                  <tr
                    key={r.day}
                    data-today={r.isToday ? 'true' : undefined}
                    className={
                      r.isToday
                        ? 'text-text bg-accent/10 border-l-2 border-accent'
                        : 'text-muted border-l-2 border-transparent'
                    }
                  >
                    <td className="py-0.5 pl-2 pr-4 font-display w-14">{r.day}</td>
                    <td className="py-0.5">{r.hours}</td>
                    <td className="py-0.5 pr-2 text-right">
                      {r.isToday ? (
                        <span className="inline-block rounded-full border border-accent px-2 py-0.5 text-[10px] font-display uppercase tracking-wider text-accent">
                          Today
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-muted mt-2">
              Hours are best-effort — confirm before a special trip.
            </p>
          </div>
        ) : null}

        {venueTags.length > 0 ? (
          // Bottom of the lightbox, directly above the action pair (PRD §P1 /
          // checklist §2: "at the bottom … without crowding the result card";
          // the approved refinement keeps the actions last with safe-area
          // padding, so this is the one slot below the hours card).
          // flex-wrap, never a scroll strip — V8 contract 5 fails any
          // horizontal scroller that isn't the tagged photo carousel.
          <ul
            data-venue-tags
            aria-label={`${bar.name} tags`}
            className="flex flex-wrap gap-2"
          >
            {venueTags.map((tag) => (
              <li
                key={tag}
                className="rounded-full border border-border bg-surface text-muted font-display text-xs px-3 py-1.5"
              >
                {displayTag(tag)}
              </li>
            ))}
          </ul>
        ) : null}

        {/* Locked reference POLISH 5: ONE clear primary — filled coral "View on
            Maps" — with the quieter outline beside it, and safe-area padding so
            the row clears the home indicator. The filled/outline pair was the
            other way round, which made the app's own funnel the loudest thing
            on a panel whose job is getting the user to the bar. */}
        <div className="flex items-center gap-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center bg-accent hover:bg-accentDim transition-colors text-bg font-display text-sm py-3 rounded-full min-h-[44px] touch-manipulation"
          >
            View on Maps
          </a>
          <Link
            href={`/rankings?add=${bar.id}`}
            className="flex-1 text-center border border-border text-text font-display text-sm py-3 rounded-full min-h-[44px] touch-manipulation hover:border-accent transition-colors"
          >
            Rank it
          </Link>
        </div>
      </div>
    </div>
  );
}
