'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AccuracyBand,
  Coords,
  ManhattanNeighborhood,
  VibeProfile,
  VibeTag,
} from '@/types';
import { useBars } from '@/lib/useBars';
import { excludeClosedBars } from '@/lib/openNow';
import { matches } from '@/lib/matching';
import { haversineMiles } from '@/lib/distance';
import { NEIGHBORHOOD_CENTROIDS, OPENS_SOON_WINDOW_MIN } from '@/lib/constants';
import { useRatings } from '@/hooks/useRatings';
import ResultCard from '@/components/ResultCard';

type ResolvedLocation =
  | { kind: 'coords'; coords: Coords; band: AccuracyBand; snappedTo: ManhattanNeighborhood | null }
  | { kind: 'neighborhood'; neighborhood: ManhattanNeighborhood };

type ResultsViewProps = {
  profile: VibeProfile;
  location: ResolvedLocation;
  maxMiles: number | null;
  excludeIds?: string[];
  maxResults?: number;
  /**
   * E3.3: hard-filter bars KNOWN closed right now (live "find a bar"
   * surfaces only — quiz/planning surfaces browse the full catalog).
   * No-hours bars always stay; unknown never reads as closed.
   */
  hideClosedNow?: boolean;
  /**
   * Fires with the ranked bar ids whenever the list changes — the single
   * source of truth for any companion surface (quiz map highlights,
   * MED-11: the parent must NOT recompute matches with different inputs).
   */
  onRanked?: (ids: string[]) => void;
};

export default function ResultsView({
  profile,
  location,
  maxMiles,
  excludeIds,
  maxResults,
  hideClosedNow,
  onRanked,
}: ResultsViewProps) {
  const userCoords: Coords =
    location.kind === 'coords'
      ? location.coords
      : NEIGHBORHOOD_CENTROIDS[location.neighborhood];

  // Memoized: a fresh array identity here cascades into `ranked` (useMemo
  // dep) and from there into the onRanked effect — an unstable identity
  // turned that into an infinite render loop (caught by rating-and-nav
  // e2e when MED-11 landed).
  const preferredNeighborhoods = useMemo(
    () =>
      location.kind === 'neighborhood'
        ? [location.neighborhood]
        : profile.preferredNeighborhoods,
    [location, profile.preferredNeighborhoods],
  );

  const { ratings, setRating, clearRating } = useRatings();
  const bars = useBars();

  // E3.3 clock for the hard filter: null until mount (the filter would
  // otherwise change the card list between SSR and hydration — same
  // rationale as OpenNowBadge computing after mount), then re-checked
  // each minute so a long-open results page drops bars as they close.
  // ACCEPTED TRADEOFF (review): the first committed frame renders the
  // unfiltered pool, so a closed bar can flash for one paint before the
  // effect narrows it — the same hydration-safe flash OpenNowBadge
  // already accepts for its pill.
  const [filterNow, setFilterNow] = useState<Date | null>(null);
  useEffect(() => {
    if (!hideClosedNow) {
      setFilterNow(null);
      return;
    }
    setFilterNow(new Date());
    const t = setInterval(() => setFilterNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, [hideClosedNow]);

  const pool = useMemo(
    () =>
      hideClosedNow && filterNow
        ? excludeClosedBars(bars, filterNow, OPENS_SOON_WINDOW_MIN)
        : bars,
    [bars, hideClosedNow, filterNow],
  );

  const effectiveExcludeIds = useMemo(() => {
    const merged = new Set(excludeIds ?? []);
    for (const r of ratings) {
      if (r.rating === 'pass') merged.add(r.barId);
    }
    return Array.from(merged);
  }, [excludeIds, ratings]);

  // Flatten the vibe tags of every bar the user has Loved, so matches() can
  // nudge bars with a similar taste profile up the rank (loved-affinity term).
  const lovedTags = useMemo(() => {
    const lovedBarIds = new Set(
      ratings.filter((r) => r.rating === 'loved').map((r) => r.barId),
    );
    if (lovedBarIds.size === 0) return [] as VibeTag[];
    const tags = new Set<VibeTag>();
    for (const b of bars) {
      if (lovedBarIds.has(b.id)) {
        for (const t of b.tags) tags.add(t);
      }
    }
    return Array.from(tags);
  }, [ratings, bars]);

  const ranked = useMemo(
    () =>
      matches({
        profile,
        coords: userCoords,
        preferredNeighborhoods,
        maxMiles,
        bars: pool,
        excludeIds: effectiveExcludeIds,
        maxResults,
        lovedTags,
      }),
    [profile, userCoords, preferredNeighborhoods, maxMiles, pool, effectiveExcludeIds, maxResults, lovedTags],
  );

  // MED-11: companion surfaces (quiz map) mirror THIS list, not their own
  // recompute. Signature guard: fire only when the id SEQUENCE changes —
  // never on mere array-identity churn (belt-and-braces against the
  // render-loop class above).
  const lastRankedSigRef = useRef('');
  // Ref-carried callback (DeepSeek review): an inline-lambda parent must
  // not re-trigger the effect on every render — only a ranked change does.
  const onRankedRef = useRef(onRanked);
  onRankedRef.current = onRanked;
  useEffect(() => {
    const ids = ranked.map((b) => b.id);
    const sig = ids.join(',');
    if (sig === lastRankedSigRef.current) return;
    lastRankedSigRef.current = sig;
    onRankedRef.current?.(ids);
  }, [ranked]);

  // MED-14: a Pass tap yanks the card out from under the finger — give it
  // an 8s undo window. Detect "newly passed AND was on screen" by diffing
  // the pass-set against the previous render's ranked list.
  const [undoTarget, setUndoTarget] = useState<{
    barId: string;
    name: string;
    /** The tier the bar held BEFORE the pass — Undo restores it, not
     *  "unrated" (DeepSeek review: liked→pass→Undo must give liked back,
     *  or the snackbar is a Clear button wearing an Undo label). */
    prior: 'loved' | 'liked' | null;
  } | null>(null);
  const prevRankedRef = useRef<string[]>([]);
  const prevPassRef = useRef<Set<string>>(new Set());
  const prevTierRef = useRef<Map<string, 'loved' | 'liked'>>(new Map());
  const prevRatingIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const passNow = new Set(
      ratings.filter((r) => r.rating === 'pass').map((r) => r.barId),
    );
    const ratingIdsNow = new Set(ratings.map((r) => r.barId));
    const newlyPassedAll = [...passNow].filter(
      (id) => !prevPassRef.current.has(id) && prevRankedRef.current.includes(id),
    );
    // Live-tap fingerprint (Opus review): a real Pass tap changes exactly
    // one bar and never REMOVES ratings. A wholesale ratings swap
    // (sign-in/out, account switch hydrate) can also diff as "new pass on
    // an on-screen bar" — firing there offers an Undo that would mutate
    // the OTHER account's data. Guard on the delta shape.
    const removedCount = [...prevRatingIdsRef.current].filter(
      (id) => !ratingIdsNow.has(id),
    ).length;
    const addedCount = [...ratingIdsNow].filter(
      (id) => !prevRatingIdsRef.current.has(id),
    ).length;
    const isSingleLiveTap =
      newlyPassedAll.length === 1 && removedCount === 0 && addedCount <= 1;
    if (isSingleLiveTap) {
      const bar = bars.find((b) => b.id === newlyPassedAll[0]);
      if (bar) {
        setUndoTarget({
          barId: bar.id,
          name: bar.name,
          prior: prevTierRef.current.get(bar.id) ?? null,
        });
      }
    }
    prevPassRef.current = passNow;
    prevRatingIdsRef.current = ratingIdsNow;
    prevRankedRef.current = ranked.map((b) => b.id);
    // Snapshot the non-pass tiers as of THIS render — next render's diff
    // reads them as "what the bar was before".
    prevTierRef.current = new Map(
      ratings
        .filter((r): r is typeof r & { rating: 'loved' | 'liked' } =>
          r.rating === 'loved' || r.rating === 'liked',
        )
        .map((r) => [r.barId, r.rating]),
    );
  }, [ratings, ranked, bars]);
  const snackbarRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!undoTarget) return;
    // 8s window; while keyboard/SR focus is INSIDE the snackbar the
    // dismissal re-arms instead of yanking the control away (Opus a11y
    // review, WCAG 2.2.1 — the recovery affordance must not race focus).
    let timer: ReturnType<typeof setTimeout>;
    const arm = (): void => {
      timer = setTimeout(() => {
        if (
          snackbarRef.current &&
          snackbarRef.current.contains(document.activeElement)
        ) {
          arm();
          return;
        }
        setUndoTarget(null);
      }, 8000);
    };
    arm();
    return () => clearTimeout(timer);
  }, [undoTarget]);

  // MED-12 honesty: "Using your location" was a half-truth whenever the
  // quiz's neighborhood filter was ALSO narrowing the pool — say so.
  const neighborhoodFiltered =
    location.kind === 'coords' && preferredNeighborhoods.length > 0;
  const locationLabel =
    location.kind === 'neighborhood'
      ? `In ${location.neighborhood}`
      : location.snappedTo
      ? `Approximate — based on ${location.snappedTo}`
      : neighborhoodFiltered
        ? 'Near you · limited to your picked neighborhoods'
        : 'Using your location';

  return (
    <section className="px-6 py-8">
      <div className="max-w-2xl mx-auto">
        <p className="text-muted text-sm text-center mb-2">{locationLabel}</p>
        <h2 className="font-display text-3xl md:text-4xl text-center mb-8">
          {ranked.length === 1
            ? 'Your next bar'
            : `Your next ${ranked.length} bars`}
        </h2>

        {ranked.length === 0 ? (
          <p className="text-muted text-center">
            No matches found nearby.
            <br />
            Try a different neighborhood or widen your radius.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {ranked.map((bar, idx) => {
              const miles = haversineMiles(userCoords, {
                lat: bar.lat,
                lng: bar.lng,
              });
              return (
                <ResultCard
                  key={bar.id}
                  bar={bar}
                  rank={idx + 1}
                  miles={miles}
                  userTags={profile.tags}
                />
              );
            })}
          </div>
        )}

        {/* MED-14 undo snackbar: floats above BottomNav; disappears after
            8s (focus-aware) or on undo. */}
        {undoTarget ? (
          <div
            ref={snackbarRef}
            role="status"
            className="fixed left-1/2 -translate-x-1/2 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[500] flex items-center gap-3 bg-surface border border-border rounded-full pl-4 pr-2 py-2 shadow-lg"
          >
            <p className="text-sm text-muted">
              Passed on{' '}
              <span className="text-text font-display">{undoTarget.name}</span>
            </p>
            <button
              type="button"
              onClick={() => {
                if (undoTarget.prior) {
                  setRating(undoTarget.barId, undoTarget.prior);
                } else {
                  clearRating(undoTarget.barId);
                }
                setUndoTarget(null);
              }}
              className="min-h-[36px] touch-manipulation px-3 rounded-full text-sm font-display text-accent hover:bg-bg transition-colors"
            >
              Undo
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
