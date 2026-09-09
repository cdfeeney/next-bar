'use client';

import { useEffect, useRef, useState } from 'react';
import type { Bar, Coords } from '@/types';
import { directionsHref, type TravelMode } from '@/lib/travelTime';
import { barVisual } from '@/lib/barVisual';
import { fetchBarDetails, type BarDetails } from '@/lib/barReviews';
import { resolveMedia } from '@/lib/mediaPolicy';
import { weekHoursRows } from '@/lib/openNow';
import { displayHood } from '@/lib/hoodDisplay';
import { displayTag, topVenueTags } from '@/lib/tagDisplay';
import { lockBodyScroll } from '@/lib/bodyScrollLock';
import { useWantToGo } from '@/hooks/useWantToGo';
import { cycleFocusWithin } from '@/lib/focusTrap';
import OpenNowBadge from '@/components/OpenNowBadge';
import GooglePlacePhotoLazy from '@/components/GooglePlacePhotoLazy';

/**
 * Bar identity plus optional private directions context.
 *
 * Everything the panel renders comes from `bar` or is fetched from `bar.id`,
 * so no caller passes surface-specific configuration and the component
 * imports nothing from a map, rankings or search module. A new caller needs
 * only a `Bar` and somewhere to put the open/closed flag.
 */
export type BarLightboxProps = {
  origin?: Coords;
  directionsMode?: TravelMode;
  /**
   * The bar to show.
   *
   * A lean catalog `Bar` is enough for identity, tags and the action pair: the
   * detail fields `BarDetails` carries (address, blurb, reviews, photo
   * attributions, place id) are absent from the catalog payload and are
   * fetched per-id on mount, so a map marker, a ranking row and a search
   * result can each pass the object they already hold with no pre-fetching.
   *
   * TWO fields the fetch cannot supply, so they must ride the passed bar:
   * `bar.hours` and `bar.tags`. `BarDetails` has no member for either, and the
   * panel reads both straight off `bar` — pass a bar without `hours` and the
   * Hours card and its open-now state simply never appear, with no request
   * that recovers them.
   *
   * Safe to swap while mounted: every piece of state filled in by an effect —
   * the fetched details, the client-only weekly hours, and the carousel photo
   * index — is keyed by the bar it was computed for and ignored the moment
   * `bar.id` changes, so no render can attribute one bar's details, schedule or
   * photo credit to another. The photo subtree and the open-now badge carry
   * `key={bar.id}` for the part no state keying reaches: imperatively mounted
   * children and the track's own scroll position.
   */
  bar: Bar;
  /**
   * Called on ✕, Escape and a backdrop tap. The caller owns the open/closed
   * state — the lightbox never unmounts itself. Focus returns to whatever was
   * focused when it opened, so the caller does not restore it.
   */
  onClose: () => void;
};

/**
 * U2-2: photo headliner. Tapping a card's photo opens this full-screen
 * overlay — big image, the bar's identity, FULL weekly hours (U2-1), the
 * review quote, and the two actions (Maps, and saving to Want to go). Single cached
 * today; when the ingest starts storing multiple photoRefs this becomes a
 * swipeable carousel without changing the entry point.
 *
 * V8-1a: this is the ONE shared bar-detail surface. Map markers, ranking rows
 * and search results all mount this component rather than growing their own
 * detail panel — see BarLightboxProps for the whole contract.
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
  origin,
  directionsMode = 'walking',
  bar,
  onClose,
}: BarLightboxProps): JSX.Element {
  // Keyed by the bar the fetch was for. `bar` can change between renders, and
  // clearing this in the effect below would clear it one render too LATE: the
  // effect is passive, so the first render after a swap had already merged the
  // previous bar's details under the new bar's name.
  const [fetched, setFetched] = useState<
    { barId: string; details?: BarDetails; status: 'ready' | 'unavailable' }
    | undefined
  >(undefined);
  const current = fetched?.barId === bar.id ? fetched : undefined;
  const detailStatus = current?.status ?? 'loading';
  const displayBar = current?.details ? { ...bar, ...current.details } : bar;
  const media = resolveMedia(displayBar);
  const photoUrls =
    media.source === 'glyph' || media.source === 'google-live' ? [] : media.urls;
  const fallbackVisual = barVisual(displayBar);
  // Third instance of the swap-safety rule (round-1 panel): the carousel index
  // is state that outlives a `bar` swap, and the figcaption credits
  // photoAttributions[activePhoto]. Left unkeyed it credits the previous bar's
  // photographer for the photo now on screen. Keyed and resolved at RENDER for
  // the same reason `fetched` and `hoursFor` are — a passive reset lands one
  // render late, which is exactly the window the attribution is wrong in.
  const [photoFor, setPhotoFor] = useState<{ barId: string; index: number }>(
    { barId: bar.id, index: 0 },
  );
  const activePhoto = photoFor.barId === bar.id ? photoFor.index : 0;
  // Heavy detail fields are absent from the initial catalog payload and
  // load only for the bar the user opens.
  useEffect(() => {
    // No clearing step here: `current` above already ignores a result whose
    // barId is not the bar being rendered, so the stale details are gone from
    // the very first render of the new bar rather than from the next one.
    let cancelled = false;
    const barId = bar.id;
    void (async () => {
      const result = await fetchBarDetails(barId);
      if (cancelled) return;
      setFetched({
        barId,
        details: result ?? undefined,
        status: result ? 'ready' : 'unavailable',
      });
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
    const barId = bar.id;
    const onScroll = (): void => {
      const idx = Math.round(track.scrollLeft / track.clientWidth);
      setPhotoFor((prev) =>
        prev.barId === barId && prev.index === idx ? prev : { barId, index: idx },
      );
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => track.removeEventListener('scroll', onScroll);
  }, [photoUrls.length, bar.id]);
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
  // hydration rule as OpenNowBadge). Keyed by bar for the same reason `fetched`
  // is: the effect that fills it is passive, so on a `bar` swap the first
  // committed render would otherwise show the PREVIOUS bar's weekly schedule
  // under the new bar's name.
  const [hoursFor, setHoursFor] = useState<
    { barId: string; rows: ReturnType<typeof weekHoursRows> } | undefined
  >(undefined);
  const rows = hoursFor?.barId === bar.id ? hoursFor.rows : null;

  useEffect(() => {
    setHoursFor({ barId: bar.id, rows: weekHoursRows(bar.hours, new Date()) });
  }, [bar.id, bar.hours]);

  // Mount-only. This used to depend on the whole `bar` object, so a parent
  // deriving its bar inline re-ran focus-steal to the close button and the
  // scroll unlock/relock cycle on every one of its renders — the same
  // unstable-prop hazard `onCloseRef` above exists to fix, left half-fixed
  // for `bar`.
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // A modal owns Escape while it is open. Registered in the CAPTURE
        // phase and stopped here so nothing underneath sees it: Leaflet's
        // keyboard handler listens on `document` and closes the open venue
        // popup on Escape (closeOnEscapeKey), which took the map's selection
        // — and the element this dialog returns focus to — away with it
        // (V9-07 marker journey, Pixel 7).
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      // Minimal focus trap (Opus review): Tab cycles within the dialog. Now
      // shared with the other two aria-modal overlays via cycleFocusWithin —
      // triplicating this is how they drifted apart.
      cycleFocusWithin(dialogRef.current, e);
    };
    window.addEventListener('keydown', onKey, true);
    const unlockScroll = lockBodyScroll();
    return () => {
      window.removeEventListener('keydown', onKey, true);
      unlockScroll();
      // preventScroll: focus() otherwise scrolls the opener back into view and
      // overrides the position unlockScroll() just restored (observed landing
      // ~43px short in native-shell-contract.spec.ts).
      opener?.focus({ preventScroll: true });
    };
  }, []);

  // V8-5: at most five tags, chosen by the one priority rule in tagDisplay.
  // BarDetails cannot carry tags, so `bar` is the whole truth here.
  const venueTags = topVenueTags(bar.tags);

  const { entries: wantToGoEntries, add: addWantToGo } = useWantToGo();
  const wantsToGo = wantToGoEntries.some((e) => e.barId === bar.id);

  const mapsHref = directionsHref(origin, bar, directionsMode);

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
      {/* V9-07: the header (and its top-right ✕) clears the status bar and
          notch — this overlay is edge to edge, so without the safe-area inset
          the close control sits under iOS chrome on the map surface. */}
      <div className="max-w-lg mx-auto min-h-full px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-6 flex flex-col gap-4">
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
          // key: GooglePlacePhoto mounts its <gmp-place-details-compact>
          // imperatively and only tears the old one down in a passive effect,
          // so without this the previous bar photo and its attribution survive
          // into committed renders of the new bar.
          <figure key={bar.id} className="rounded-3xl border border-border">
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
          // key: also resets the track DOM scrollLeft, which no amount of
          // state keying reaches.
          <figure key={bar.id} className="rounded-3xl overflow-hidden border border-border">
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
        ) : (
          <p role="status" className="text-sm text-muted">
            {detailStatus === 'loading' ? 'Loading photos…' : 'No photos available for this bar yet.'}
          </p>
        )}

        <div>
          <h2 className="font-display text-3xl leading-tight mb-1">
            {bar.name}
          </h2>
          <div className="flex items-center gap-3">
            <p className="text-muted text-xs">{displayBar.address}</p>
            <OpenNowBadge key={bar.id} bar={bar} />
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
          {/* Round-1 panel, both families: this linked to /rankings?add=, which
              opens QuickAddBar straight in its pick-score stage. That is RATING,
              and rank-vs-rate is a pinned product boundary — a control labelled
              "Want to go" that demands a score for a bar you have not been to is
              a mislabel, not a shortcut. The product already has the real list
              (src/lib/wantToGo.ts); this writes to it. */}
          {/* aria-disabled, not disabled — the same rule the carousel controls
              above follow: this button is FOCUSED at the moment it flips to
              saved, and `disabled` would drop that focus to <body> and pull it
              out of the dialog's tab cycle. addWantToGo is idempotent, so a
              repeat activation is a harmless no-op. */}
          <button
            type="button"
            aria-pressed={wantsToGo}
            onClick={() => addWantToGo(bar.id)}
            aria-disabled={wantsToGo}
            className="flex-1 text-center border border-border text-text font-display text-sm py-3 rounded-full min-h-[44px] touch-manipulation hover:border-accent transition-colors aria-disabled:opacity-40"
          >
            {wantsToGo ? 'On your list' : 'Want to go'}
          </button>
        </div>
      </div>
    </div>
  );
}
