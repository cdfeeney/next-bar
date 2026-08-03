'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Bar } from '@/types';
import { resolveMedia } from '@/lib/mediaPolicy';
import { hoursProvenanceNote, weekHoursRows } from '@/lib/openNow';
import GoogleAttribution from '@/components/GoogleAttribution';
import { displayHood } from '@/lib/hoodDisplay';
import OpenNowBadge from '@/components/OpenNowBadge';
import WantToGoToggle from '@/components/WantToGoToggle';

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
  // The slide the carousel is SUPPOSED to be on. Only two things may move
  // the carousel — a user gesture on the track or cyclePhoto — and both
  // update this. Anything else is WebKit's stray re-snap (see below).
  const expectedIndexRef = useRef(0);
  // Timestamp of the last user gesture on the track; scroll events inside
  // the window (self-extending, so swipe momentum stays covered) are
  // treated as user-driven. -Infinity, not 0: performance.now() counts
  // from page navigation, so a 0 start would classify engine scrolls in
  // the page's first second as user input (santa: Codex).
  const lastUserInputRef = useRef(Number.NEGATIVE_INFINITY);
  // Timestamp of the last layout reflow around the carousel. WebKit's
  // stray re-snaps are reflow-TRIGGERED (hours table mounting, images
  // completing), which is what separates them from assistive-technology
  // navigation — a VoiceOver swipe scrolls the track without any
  // accompanying reflow.
  const lastReflowRef = useRef(Number.NEGATIVE_INFINITY);
  // The dialog's content column; observed for reflow (its height changes
  // when the hours table or images land).
  const columnRef = useRef<HTMLDivElement | null>(null);
  // Mount time for the startup grace window (see onScroll).
  const mountedAtRef = useRef(performance.now());
  // Scroll-snap position → active dot, plus stray-snap correction: WebKit
  // intermittently RE-SNAPS a snap-mandatory track to the LAST slide on
  // unrelated reflow (observed at open, ~40ms marks, and mid-interaction —
  // the user-visible form is "the carousel jumps photos on its own").
  // Timer-based pinning lost that timing war twice, so instead every
  // scroll that no user gesture and no arrow initiated is corrected back
  // to the expected slide.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const noteUserInput = (): void => {
      lastUserInputRef.current = performance.now();
    };
    // A vertical wheel over the photo scrolls the DIALOG, not the track,
    // but still bubbles through the track — arming the trust window on it
    // would let a stray snap in the next second be accepted as user input
    // (santa: Claude HIGH). Only horizontal intent counts.
    const noteWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) noteUserInput();
    };
    const onScroll = (): void => {
      const idx = Math.round(track.scrollLeft / track.clientWidth);
      const now = performance.now();
      const userDriven = now - lastUserInputRef.current < 1_000;
      const step = Math.abs(idx - expectedIndexRef.current);
      // A stray snap is either a multi-slide jump or reflow-correlated;
      // both were observed (jump-to-last at open; an ADJACENT stray
      // during the hours-table mount). Assistive-tech navigation
      // (VoiceOver swipe: no pointer/touch/wheel precursor) is a
      // single-slide move with NO accompanying reflow, so it passes
      // (santa: Claude HIGH — an earlier version reverted every AT
      // swipe; a step-only rule then readmitted adjacent strays).
      // Startup grace: for 1.5s after mount, every non-user move is the
      // engine's — a human (or VoiceOver user) cannot have oriented and
      // navigated a just-opened dialog that fast. Needed because under
      // load the scroll handler can run BEFORE the ResizeObserver
      // callback for the same reflow, leaving the correlation stale.
      const inStartup = now - mountedAtRef.current < 1_500;
      const strayEngine =
        !userDriven &&
        (step > 1 || inStartup || now - lastReflowRef.current < 400);
      if (strayEngine) {
        // Put the carousel back where it belongs, via the same
        // snap-aware API cyclePhoto uses (a direct scrollLeft
        // assignment is exactly what WebKit was seen reverting —
        // santa: Claude MEDIUM).
        if (idx !== expectedIndexRef.current) {
          const expected = track.children[expectedIndexRef.current];
          if (expected instanceof HTMLElement) {
            expected.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
          }
          return;
        }
      } else if (userDriven) {
        // Momentum can outlast the gesture — keep the window open while
        // user-mode scroll events continue.
        lastUserInputRef.current = now;
        expectedIndexRef.current = idx;
      } else {
        expectedIndexRef.current = idx; // AT navigation
      }
      setActivePhoto((prev) => (prev === idx ? prev : idx));
    };
    // Reflow tracker: fires once on observe (covering mount) and on every
    // size change of the track or the content column.
    const reflowObserver = new ResizeObserver(() => {
      lastReflowRef.current = performance.now();
    });
    reflowObserver.observe(track);
    if (columnRef.current) reflowObserver.observe(columnRef.current);
    track.addEventListener('scroll', onScroll, { passive: true });
    // A stray snap can land BEFORE this effect attaches — then no scroll
    // event ever follows and the correction above can never run
    // (observed: track already sitting on slide 1 at attach). Effects run
    // within milliseconds of first paint, before any human gesture is
    // possible, so a non-zero position here is always the engine's doing.
    if (Math.round(track.scrollLeft / track.clientWidth) !== 0) {
      const first = track.children[0];
      if (first instanceof HTMLElement) {
        first.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
      }
    }
    track.addEventListener('pointerdown', noteUserInput, { passive: true });
    track.addEventListener('touchstart', noteUserInput, { passive: true });
    track.addEventListener('wheel', noteWheel, { passive: true });
    return () => {
      reflowObserver.disconnect();
      track.removeEventListener('scroll', onScroll);
      track.removeEventListener('pointerdown', noteUserInput);
      track.removeEventListener('touchstart', noteUserInput);
      track.removeEventListener('wheel', noteWheel);
    };
  }, []);
  // Arrow cycling (operator, 2026-08-02): the snap track is swipe-only,
  // which is unusable with a mouse. Arrows scroll the track; the scroll
  // listener above stays the single source of truth for activePhoto, so
  // dots/attribution update identically for swipe, arrows, and keys.
  const cyclePhoto = (delta: number): void => {
    const track = trackRef.current;
    if (!track) return;
    const count = Math.max(1, track.children.length);
    // From the EXPECTED index, not a scrollLeft read — mid-correction the
    // physical position may briefly be wherever the stray snap left it.
    const current = expectedIndexRef.current;
    const next = (current + delta + count) % count; // wrap both directions
    expectedIndexRef.current = next;
    // scrollIntoView on the target SLIDE, not scrollTo/scrollLeft math on
    // the track: on a snap-mandatory container Chromium can cancel a
    // smooth scrollTo mid-flight, and WebKit intermittently reverts a
    // direct scrollLeft assignment (both observed as a click advancing
    // nothing). scrollIntoView is snap-aware in every engine.
    // block:'nearest' keeps the dialog's vertical scroll untouched.
    const slide = track.children[next];
    if (slide instanceof HTMLElement) {
      slide.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    }
  };
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Ref-carried close handler (Opus review): ResultCard passes an inline
  // lambda, and having it in the effect deps re-ran the whole effect on
  // every parent re-render — stealing focus back to ✕ mid-interaction.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Same ref-carry for cyclePhoto: the key handler effect must not re-run
  // (and re-steal focus) because a render produced a new function identity.
  const cyclePhotoRef = useRef(cyclePhoto);
  cyclePhotoRef.current = cyclePhoto;
  // Hours are time-dependent → client-only state, set after mount (same
  // hydration rule as OpenNowBadge).
  const [rows, setRows] = useState<ReturnType<typeof weekHoursRows>>(null);

  // Data refresh (hours) tracks the OBJECT — a catalog swap delivers fresh
  // hours for the same bar and the panel must show them.
  useEffect(() => {
    setRows(weekHoursRows(bar.hours, new Date()));
  }, [bar]);

  // Dialog lifecycle (focus steal/restore, key handlers, scroll lock) tracks
  // the bar IDENTITY only. Keying this on the object meant the async catalog
  // swap — which replaces every Bar's identity while ids survive — re-ran it
  // on an open dialog and yanked focus back to ✕ mid-interaction, e.g. a
  // keyboard user tabbing toward the Want-to-Go toggle on /search
  // (santa: Codex, round 3). Handlers read refs, so nothing here goes stale.
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      // Photo cycling from the keyboard (same wrap semantics as the
      // arrow buttons). Guarded to plain arrow presses so nothing with
      // focus that consumes arrows is fought over. preventDefault is
      // LOAD-BEARING: without it WebKit also scrolls the snap track
      // natively for the same press, advancing two slides per key.
      if (
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        // Plain presses only: Alt+Left is browser back, and any other
        // modifier combo is a shortcut, not a carousel command
        // (santa: Codex).
        !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        // Only when there is genuinely something to cycle — a 0/1-photo
        // bar must not have its arrow keys swallowed (santa: Claude).
        const track = trackRef.current;
        if (!track || track.children.length < 2) return;
        e.preventDefault();
        cyclePhotoRef.current(e.key === 'ArrowRight' ? 1 : -1);
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
  }, [bar.id]);

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
      <div
        ref={columnRef}
        className="max-w-lg mx-auto min-h-full px-4 py-6 flex flex-col gap-4"
      >
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
                on touch, scroll on desktop, no library. Arrows added for
                mouse users (operator, 2026-08-02): swipe has no pointer
                equivalent on a laptop. */}
            <div className="relative">
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
                    // Eager on purpose (was lazy for i>0): a lazy slide
                    // completing its load re-flows the track, and WebKit
                    // responds by RE-SNAPPING a snap-mandatory container —
                    // observed landing on the LAST slide mid-interaction.
                    // These are small local webp files; loading all of a
                    // handful eagerly is cheaper than a carousel that
                    // jumps slides on its own.
                    loading="eager"
                    className="w-full shrink-0 snap-center h-auto max-h-[55vh] object-cover"
                  />
                ))}
              </div>
              {photoUrls.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => cyclePhoto(-1)}
                    aria-label="Previous photo"
                    className="absolute left-2 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] touch-manipulation rounded-full bg-bg/70 border border-border text-text text-xl leading-none backdrop-blur-sm hover:bg-bg/90"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => cyclePhoto(1)}
                    aria-label="Next photo"
                    className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] touch-manipulation rounded-full bg-bg/70 border border-border text-text text-xl leading-none backdrop-blur-sm hover:bg-bg/90"
                  >
                    ›
                  </button>
                </>
              ) : null}
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

        <div className="flex items-center gap-3 pb-4 flex-wrap">
          <WantToGoToggle barId={bar.id} barName={bar.name} variant="full" />
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
