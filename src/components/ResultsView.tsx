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
import { deriveLearnedTaste } from '@/lib/tasteAffinity';
import { matches } from '@/lib/matching';
import { haversineMiles } from '@/lib/distance';
import { NEIGHBORHOOD_CENTROIDS, OPENS_SOON_WINDOW_MIN } from '@/lib/constants';
import { displayHood } from '@/lib/hoodDisplay';
import { useRatings } from '@/hooks/useRatings';
import { useTravelRoutes } from '@/hooks/useTravelRoutes';
import { isWalkable, ROUTE_CANDIDATE_CAP, ROUTE_RESULT_CAP } from '@/lib/travelTime';
import { RADIUS_CAB, RADIUS_WALK } from '@/lib/constants';
import ResultCard from '@/components/ResultCard';

type ResolvedLocation =
  | { kind: 'coords'; coords: Coords; band: AccuracyBand; snappedTo: ManhattanNeighborhood | null; originLabel?: string }
  | { kind: 'neighborhood'; neighborhood: ManhattanNeighborhood };

type ResultsViewProps = {
  profile: VibeProfile;
  location: ResolvedLocation;
  minMilesExclusive?: number | null;
  maxMiles: number | null;
  /** Quiz results have no distance selector and retain their nearby default. */
  nearbyFirst?: boolean;
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
  /** Planning phase (operator 2026-07-27): cards carry a "Send" share. */
  showShare?: boolean;
};

export default function ResultsView({
  profile,
  location,
  maxMiles,
  nearbyFirst,
  excludeIds,
  maxResults,
  hideClosedNow,
  onRanked,
  showShare,
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

  // V8 (Option B, resolved 2026-08-19): a low score is negative evidence, not
  // an exclusion. Only caller-supplied excludeIds (tonight-exclusion, manual)
  // suppress a bar — never a rating tier.
  const effectiveExcludeIds = useMemo(() => excludeIds ?? [], [excludeIds]);

  // V8 P1: graded learned taste from numeric scores, replacing the old
  // Set-of-loved-tags term (under which one Loved bar equalled two hundred).
  const taste = useMemo(
    () => deriveLearnedTaste(ratings, bars),
    [ratings, bars],
  );

  const walkingSearch = maxMiles === RADIUS_WALK;
  const nearbyCandidates = nearbyFirst ?? walkingSearch;
  const candidates = useMemo(
    () => {
      const preferred = matches({
        profile,
        coords: userCoords,
        preferredNeighborhoods,
        minMilesExclusive: null,
        maxMiles: null,
        bars: maxMiles === RADIUS_CAB
          ? pool.filter(b => haversineMiles(userCoords, b) <= RADIUS_CAB) : pool,
        distanceBands: nearbyCandidates,
        excludeIds: effectiveExcludeIds,
        maxResults: pool.length,
        taste,
        // Late-night bias rides the SAME live clock as the open-now
        // filter — quiz/planning surfaces (no hideClosedNow) never bias.
        biasNow: filterNow ?? undefined,
      });
      if (!nearbyCandidates) return preferred.slice(0, ROUTE_CANDIDATE_CAP);
      // Bound route lookups by proximity without erasing taste/applied-vibe order.
      const nearbyIds = new Set([...preferred]
        .sort((a, b) => haversineMiles(userCoords, a) - haversineMiles(userCoords, b))
        .slice(0, ROUTE_CANDIDATE_CAP).map(b => b.id));
      return preferred.filter(b => nearbyIds.has(b.id));
    },
    [profile, userCoords, preferredNeighborhoods, pool, effectiveExcludeIds, taste, filterNow, maxMiles, nearbyCandidates],
  );
  const mode = maxMiles === RADIUS_CAB ? 'driving' : 'walking';
  const travel = useTravelRoutes(userCoords, candidates, mode, walkingSearch);
  const count = Math.min(maxResults ?? ROUTE_RESULT_CAP, ROUTE_RESULT_CAP);
  const ranked = useMemo(() => travel.data
    ? travel.data.routes.flatMap(r => candidates.filter(b => b.id === r.id)).slice(0, count)
    : candidates.slice(0, count), [travel.data, candidates, count]);
  const routeById = new Map(travel.data?.routes.map(r => [r.id, r]));
  const firstFarther = walkingSearch && travel.data
    ? ranked.findIndex(b => !isWalkable(routeById.get(b.id)?.walking)) : -1;

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
      ? `In ${displayHood(location.neighborhood)}`
      : location.originLabel
      ? location.originLabel
      : location.snappedTo
      ? `Approximate — based on ${location.snappedTo}`
      : neighborhoodFiltered
        ? 'Near you · limited to your picked neighborhoods'
        : 'Near you';

  return (
    <section className="px-6 py-8">
      <div className="max-w-2xl mx-auto">
        <p className="text-muted text-sm text-center mb-2">{locationLabel}</p>
        <div className="text-sm text-muted text-center mb-4" aria-live="polite">
          {travel.status === 'disabled' ? <p>Route times unavailable. These suggestions are not confirmed within a 15-minute walk.</p> : null}
          {travel.status === 'loading' ? <p>Checking street routes…</p> : null}
          {travel.status === 'error' || travel.status === 'stale' ? <>
            <p>{travel.status === 'stale' ? 'Travel times expired.' : 'Travel times unavailable.'} Walkable is not confirmed.</p>
            <button type="button" onClick={travel.calculate} className="min-h-[44px] text-accent underline">Recalculate from this starting point</button>
          </> : null}
          {travel.data ? <>
            {travel.data.incomplete ? <p>Some route checks failed; only confirmed estimates are shown.</p> : null}
            {ranked.length < count ? <p>Only {ranked.length} routes confirmed in this search.</p> : null}
          </> : null}
        </div>
        <h2 className="font-display text-3xl md:text-4xl text-center mb-8">
          {ranked.length === 1
            ? 'Your next bar'
            : `Your next ${ranked.length} bars`}
        </h2>

        {ranked.length === 0 ? (
          <p className="text-muted text-center">
            {travel.data ? 'Not enough routes could be confirmed in this search.' : 'No eligible bars found in this search.'}
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
                <div key={bar.id}>
                {idx === firstFarther ? <h3 className="font-display text-lg mb-3">A little farther away</h3> : null}
                <ResultCard
                  bar={bar}
                  rank={idx + 1}
                  miles={miles}
                  origin={userCoords}
                  travel={routeById.get(bar.id)}
                  travelLoading={travel.status === 'loading'}
                  directionsMode={mode}
                  userTags={profile.tags}
                  showShare={showShare}
                />
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5 text-sm text-muted text-center">
          <details>
            <summary className="min-h-[44px] py-3 cursor-pointer">About travel times</summary>
            <p>{walkingSearch ? 'Walkable: estimated route of 15 minutes or less.' : nearbyCandidates ? 'Matching nearby bars.' : maxMiles === RADIUS_CAB ? 'Matching across the wider area, within 4 miles straight-line.' : 'Matching across the full service area.'}</p>
            <p>Times are estimates; driving excludes traffic and pickup waits.</p>
            {travel.status !== 'disabled' ? <p>Travel times calculate automatically from this starting point. No location history is saved by Next Bar.</p> : null}
            {travel.data?.limited ? <p>Checked {travel.data.checked} candidates; this is not an exhaustive search.</p> : null}
          </details>
          {travel.data ? <p className="text-xs">© <a href="https://openrouteservice.org/" target="_blank" rel="noopener noreferrer" className="underline">openrouteservice</a> by HeiGIT · Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">OpenStreetMap contributors</a></p> : null}
        </div>

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
              className="min-h-[44px] touch-manipulation px-3 rounded-full text-sm font-display text-accent hover:bg-bg transition-colors"
            >
              Undo
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
