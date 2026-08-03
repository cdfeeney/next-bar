'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type {
  Bar,
  Coords,
  Neighborhood,
  Radius,
  VibeProfile,
  VibeTag,
} from '@/types';
import { deriveArchetype } from '@/lib/quiz';
import { useGeolocation } from '@/hooks/useGeolocation';
import LocationAccessHelp from '@/components/LocationAccessHelp';
import { loadProfile } from '@/lib/storedProfile';
import { loadNightVibe, saveNightVibe } from '@/lib/vibeNightCache';
import {
  NIGHT_LOG_STORAGE_KEY,
  lastNightKey,
  loadNightVisits,
  recordVisit,
} from '@/lib/nightLog';
import { nycNightKey } from '@/lib/nightKey';
import { useNightRefresh } from '@/hooks/useIntent';
import { deriveNightPhase } from '@/lib/nightPhase';
import { loadIntent, wasOutLastNight } from '@/lib/intent';
import { loadPhaseOverride } from '@/lib/phaseOverride';
import {
  RADIUS_ANYWHERE,
  RADIUS_WALK,
  RESULTS_COUNT,
} from '@/lib/constants';
import { advanceShownIds, isWiderRadius, nextWiderRadius } from '@/lib/resultsRefresh';
import BarPicker from '@/components/BarPicker';
import FreeTextSeed from '@/components/FreeTextSeed';
import DistanceChips from '@/components/DistanceChips';
import VibeTweak from '@/components/VibeTweak';
import ResultsView from '@/components/ResultsView';

const BarMap = dynamic(() => import('@/components/BarMap'), { ssr: false });

type Step =
  // Location-first entry (permission-primed, operator decision 2026-07-25 +
  // web research): with permission already GRANTED we locate silently; with
  // permission undecided we show the PRIMER — our own "share location"
  // button whose tap fires the real browser prompt (gesture-bound asks get
  // shown and approved; load-time auto-prompts get reflex-dismissed and
  // iOS remembers that as a permanent deny). Denied goes straight to
  // pickBar, where the recovery card lives.
  //
  // E2.1 flow collapse (2026-07-25, EPICS-v0.6 + DESIGN-SYSTEM R6): the
  // `confirmGps` and `pickRadius` steps are DELETED, not restyled.
  // Picking a bar goes straight to results — geolocation resolves
  // silently in the background if available and is never narrated
  // (closes audit HIGH-10); the radius fine-tune lives ON the results
  // surface with a walking default. Vibe tweaking is entered from
  // results and returns to results.
  | { kind: 'locating' }
  | { kind: 'askLocation' }
  | { kind: 'autoResults'; coords: Coords }
  // QA1 (2026-07-26): the vibe tweak exists on the LOCATION results too —
  // same VibeTweak surface, but it returns to autoResults (still
  // geo-driven, no seed bar). Tags are not carried in the step: the
  // surface seeds from tonight's cached vibe (falling back to the quiz
  // profile), and Apply writes the same night cache the manual flow uses
  // (E2.2 — one vibe per night, whichever surface picked it).
  | { kind: 'tweakVibeAuto'; coords: Coords }
  | { kind: 'pickBar' }
  | { kind: 'freeTextSeed' }
  | { kind: 'tweakVibe'; seedBar: Bar; tags: VibeTag[] }
  | { kind: 'results'; seedBar: Bar; tags: VibeTag[] };

/**
 * BOTH home surfaces enter on Walkable (operator, 2026-07-27 morning:
 * "I need to see bars that are close to me" — proximity beats a
 * guaranteed-full first page). The earlier review concern (a walking
 * default blanks the page for someone far from any catalog bar) is
 * answered by the AUTO-WIDEN below: zero results at an untouched radius
 * widens one visible step (walking → cab → anywhere) instead of ever
 * stranding an empty list.
 */
const DEFAULT_RADIUS: Radius = { kind: 'walking', maxMiles: RADIUS_WALK };

function defaultProfile(): VibeProfile {
  return { tags: [], archetype: deriveArchetype([]), preferredNeighborhoods: [] };
}

export default function WhereNextFlow() {
  const [step, setStep] = useState<Step>({ kind: 'locating' });
  const geo = useGeolocation();

  // The saved vibe profile (from the quiz) powers the auto-suggest ranking.
  // Loaded client-side to avoid an SSR/localStorage hydration mismatch; falls
  // back to an empty profile (→ distance-only ranking) when the quiz is unseen.
  const [profile, setProfile] = useState<VibeProfile>(defaultProfile);
  useEffect(() => {
    const syncProfile = (): void => {
      const saved = loadProfile();
      // Review MED: a cleared profile (Settings, another tab) must also
      // clear the Tweak-the-vibe pre-fill — fall back to empty, don't
      // keep stale tags in memory.
      setProfile(
        saved
          ? {
              tags: saved.tags,
              archetype: saved.archetype,
              preferredNeighborhoods: saved.preferredNeighborhoods,
            }
          : defaultProfile(),
      );
    };
    syncProfile();
    window.addEventListener('storage', syncProfile);
    return () => window.removeEventListener('storage', syncProfile);
  }, []);

  // Tonight's cached vibe pick (E2.2), mount-loaded for the SAME
  // SSR-hydration reason as the profile above. When present it overrides
  // the quiz profile's tags on the LOCATION results (QA1): a vibe tweaked
  // earlier tonight — on either surface — pre-fills here too. Kept in
  // state (not re-read per render) and updated on Apply so the surface
  // re-ranks immediately.
  const [nightVibe, setNightVibe] = useState<VibeTag[] | null>(null);
  useEffect(() => {
    setNightVibe(loadNightVibe());
  }, []);

  // Operator 2026-07-27: while PLANNING, every result card carries a
  // "Send" share (text the bar to your group — works for recipients with
  // no account via /share/[barId]). Same phase inputs as the home
  // header's chip (small acknowledged duplication with app/page.tsx —
  // extract a useNightPhase hook if a third consumer appears).
  const [isPlanning, setIsPlanning] = useState(false);
  const computePlanning = useCallback((): void => {
    const now = new Date();
    setIsPlanning(
      deriveNightPhase({
        now,
        intent: loadIntent()?.status ?? null,
        wasOutLastNight:
          wasOutLastNight(now) ||
          loadNightVisits(lastNightKey(now)).length > 0,
        override: loadPhaseOverride(now),
      }) === 'planning',
    );
  }, []);
  useNightRefresh(computePlanning);
  useEffect(() => {
    window.addEventListener('storage', computePlanning);
    return () => window.removeEventListener('storage', computePlanning);
  }, [computePlanning]);

  // The profile the LOCATION results rank by (operator 2026-07-27:
  // "showing interesting ones, not near ones — move it into tweak the
  // vibe"): tonight's EXPLICIT vibe pick when one exists, otherwise NO
  // tags — matching.ts's empty-tags branch ranks by pure proximity, so
  // the default home answer is simply "the closest open bars". The saved
  // quiz profile no longer shapes this ranking silently; it lives on as
  // the PRE-FILL inside the Tweak-the-vibe surface (below), where
  // applying it makes the influence explicit and night-scoped.
  const autoProfile = useMemo<VibeProfile>(
    () =>
      nightVibe
        ? {
            tags: nightVibe,
            archetype: deriveArchetype(nightVibe),
            preferredNeighborhoods: [],
          }
        : { tags: [], archetype: deriveArchetype([]), preferredNeighborhoods: [] },
    [nightVibe],
  );

  // Location-first routing. In 'locating' we NEVER fire the browser
  // request ourselves anymore — the hook auto-fetches when permission is
  // already granted (U2-4); an undecided permission routes to the primer,
  // whose TAP calls request() (gesture-bound = the prompt actually shows
  // and gets approved); a denial lands on pickBar with the recovery card.
  useEffect(() => {
    if (step.kind !== 'locating' && step.kind !== 'askLocation') return;
    const status = geo.state.status;
    if (geo.coords) {
      // Fresh auto entry: Walkable — closest bars first (auto-widen
      // covers the zero-results case; see DEFAULT_RADIUS note).
      radiusTouchedRef.current = false;
      setSelectedRadius(DEFAULT_RADIUS);
      setStep({ kind: 'autoResults', coords: geo.coords });
      return;
    }
    if (
      status === 'denied' ||
      status === 'unavailable' ||
      status === 'granted_coarse'
    ) {
      setStep({ kind: 'pickBar' });
      return;
    }
    if (step.kind !== 'locating') return;
    if (status === 'requesting') return; // auto-resume in flight
    if (geo.permissionState === 'granted') return; // hook will fetch
    if (geo.permissionState === 'denied') {
      setStep({ kind: 'pickBar' });
      return;
    }
    // 'prompt' → primer immediately. (Safari can report 'prompt' even when
    // previously granted; the primer tap then succeeds without any dialog,
    // which is fine.)
    if (geo.permissionState === 'prompt') {
      setStep({ kind: 'askLocation' });
    }
    // 'unknown' → grace-handled by the timer effect below (the Permissions
    // API resolves in ms when present; without it — older Safari — the
    // primer is the correct destination anyway).
  }, [step.kind, geo.state.status, geo.coords, geo.permissionState, geo]);

  // Grace timer for 'unknown' permission at startup: don't flash the
  // primer at a granted user whose Permissions API answer is milliseconds
  // away; don't strand a no-Permissions-API Safari on the spinner either.
  useEffect(() => {
    if (step.kind !== 'locating') return;
    if (geo.permissionState !== 'unknown') return;
    const timer = setTimeout(() => setStep({ kind: 'askLocation' }), 400);
    return () => clearTimeout(timer);
  }, [step.kind, geo.permissionState]);

  // Radius fine-tune lives on the results surface (E2.1) — changing it
  // re-ranks live. Walking default.
  const [selectedRadius, setSelectedRadius] = useState<Radius>(DEFAULT_RADIUS);

  // QA-6 one results view: an OPTIONAL neighborhood override (null = rank
  // around the location anchor) and the run-it-again shown-history. The
  // history excludes already-shown bars so refresh deals the NEXT batch;
  // any change of search context (new seed, radius, hood, vibe) starts a
  // fresh deal.
  const [resultsHood, setResultsHood] = useState<Neighborhood | null>(null);
  const [shownIds, setShownIds] = useState<readonly string[]>([]);
  // Fresh-hand mode (g-d3f8d912): non-null after a WIDENING radius tap —
  // holds the radius that was in force before it. While set, shownIds is
  // the soft "seen" set (preferred against, reusable as fallback) instead
  // of a hard exclusion, and the deal is arranged newly-eligible-first.
  // One deal only: the next refresh, narrow, or context change ends it.
  const [widenedFromMiles, setWidenedFromMiles] = useState<number | null>(null);
  const lastRankedRef = useRef<string[]>([]);
  // True once the user taps the distance chips themselves — the
  // auto-widen below must never fight an explicit choice.
  const radiusTouchedRef = useRef(false);
  const [rankedEmpty, setRankedEmpty] = useState(false);
  const handleRanked = useCallback((ids: string[]): void => {
    lastRankedRef.current = ids;
    setRankedEmpty(ids.length === 0);
  }, []);
  // Empty-rank recovery, in priority order: (1) wrap backstop (review
  // HIGH — a refresh cycle that exhausted the pool restarts instead of
  // stranding "No matches found"); (2) AUTO-WIDEN (operator fix
  // 2026-07-27: home opens on Walkable; if an UNTOUCHED radius yields
  // zero, widen one visible chip step walking → cab → anywhere rather
  // than showing an empty first load).
  // Deal-history reset: shown history + widen context. Deliberately does
  // NOT touch lastRankedRef (santa: Codex round 2): descendant effects run
  // before ancestor effects, so by the time a parent-level reset effect
  // fires, ResultsView's onRanked has already stored the NEW context's
  // hand — wiping it here would strand run-it-again and widen folding on
  // an empty mirror. Staleness across remounts is fixed at the SOURCE
  // instead: ResultsView's signature guard now always reports the first
  // commit, empty included, so the mirror is refreshed before any user
  // tap can consume it.
  const resetDealHistory = useCallback((): void => {
    setShownIds([]);
    setWidenedFromMiles(null);
  }, []);
  useEffect(() => {
    if (!rankedEmpty) return;
    if (shownIds.length > 0) {
      setShownIds([]);
      setWidenedFromMiles(null);
      return;
    }
    if (!radiusTouchedRef.current) {
      setSelectedRadius((prev) => nextWiderRadius(prev));
    }
  }, [rankedEmpty, shownIds]);
  // Render-time ref mirrors (same ref-carry pattern as onRankedRef in
  // ResultsView): the two handlers below need the CURRENT radius/widen
  // state without putting either in their deps, and state-updater
  // functions must stay pure (StrictMode double-invokes them).
  const selectedRadiusRef = useRef(selectedRadius);
  selectedRadiusRef.current = selectedRadius;
  const widenedFromMilesRef = useRef(widenedFromMiles);
  widenedFromMilesRef.current = widenedFromMiles;
  const handleRunAgain = useCallback((): void => {
    if (widenedFromMilesRef.current === null) {
      setShownIds((prev) =>
        advanceShownIds(prev, lastRankedRef.current, RESULTS_COUNT),
      );
      return;
    }
    // Refresh after a widened deal: the arranged hand joins the shown
    // history and refresh semantics return to the classic hard-exclusion
    // cycle (advance/wrap unchanged). A double-tap before the re-rank
    // lands takes the branch above, where the classic overlap guard
    // makes it a no-op.
    setShownIds((prev) => Array.from(new Set([...prev, ...lastRankedRef.current])));
    setWidenedFromMiles(null);
  }, []);
  const handleRadiusChange = useCallback((next: Radius): void => {
    radiusTouchedRef.current = true;
    const prev = selectedRadiusRef.current;
    if (isWiderRadius(next, prev)) {
      // WIDEN: fold the visible hand into the seen set and deal the
      // fresh-hand arrangement from the previous radius (g-d3f8d912).
      setShownIds((shown) =>
        Array.from(new Set([...shown, ...lastRankedRef.current])),
      );
      setWidenedFromMiles(prev.maxMiles);
    } else {
      // NARROW/SAME: the long-pinned semantics — forget the dealt hand
      // (distance-widening.spec.ts pins this via the narrow path).
      resetDealHistory();
    }
    setSelectedRadius(next);
  }, [resetDealHistory]);
  const handleHoodChange = useCallback((next: Neighborhood | null): void => {
    setResultsHood(next);
    resetDealHistory();
    // Review MED: "In Harlem" must mean the WHOLE hood — a walking cap
    // measured from the hood's centroid silently drops edge bars. Picking
    // a hood widens the radius chip to Anywhere (visible state change;
    // the user can still narrow it again afterwards).
    if (next !== null) {
      setSelectedRadius({ kind: 'anywhere', maxMiles: RADIUS_ANYWHERE });
    }
  }, [resetDealHistory]);
  const resetResultsControls = useCallback((): void => {
    setResultsHood(null);
    resetDealHistory();
  }, [resetDealHistory]);

  // E3.1: "not the places I've already been tonight." The night log's
  // visited set hard-excludes on the live surfaces (never the quiz).
  // Mount-gated (SSR has no storage); recordVisit's manual storage-event
  // dispatch keeps it fresh same-tab (key-filtered — unrelated writes
  // like rating taps must not churn the memo chain), and useNightRefresh
  // clears an IDLE tab at the 6am rollover (review HIGH: storage events
  // alone never fire for a tab left open past 6am — same F5 class the
  // hook was built for). Identity is preserved when the id list is
  // unchanged so refresh ticks don't re-rank.
  const [visitedIds, setVisitedIds] = useState<string[]>([]);
  const refreshVisits = useCallback((): void => {
    setVisitedIds((prev) => {
      const next = loadNightVisits(nycNightKey()).map((v) => v.barId);
      return prev.length === next.length && prev.every((id, i) => id === next[i])
        ? prev
        : next;
    });
  }, []);
  useNightRefresh(refreshVisits);
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== NIGHT_LOG_STORAGE_KEY) return;
      refreshVisits();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refreshVisits]);

  // Stable identity for the manual-results exclusion list (seed bar +
  // tonight's visits) so ResultsView's memo chain only re-ranks when the
  // contents actually change.
  const seedBarId =
    step.kind === 'results' || step.kind === 'tweakVibe' ? step.seedBar.id : null;
  // In fresh-hand mode shownIds is the SOFT seen set (passed separately as
  // seenIds so the widened deal can still reuse it as fallback) — only
  // visited bars and the seed stay hard-excluded (g-d3f8d912).
  const widenActive = widenedFromMiles !== null;
  const manualExcludeIds = useMemo(
    () =>
      seedBarId
        ? [seedBarId, ...visitedIds, ...(widenActive ? [] : shownIds)]
        : [...visitedIds, ...(widenActive ? [] : shownIds)],
    [seedBarId, visitedIds, shownIds, widenActive],
  );
  const autoExcludeIds = useMemo(
    () => [...visitedIds, ...(widenActive ? [] : shownIds)],
    [visitedIds, shownIds, widenActive],
  );

  // E2.1: EVERY seed-bar entry lands on RESULTS immediately through this
  // one helper (review HIGH: the picker and not-listed paths must behave
  // identically). If permission is already granted but the hook's
  // auto-resume hasn't fired, resolve coords silently in the background —
  // results re-rank when they arrive; failure just means seed-bar coords,
  // never narrated (R6). A NEW seed is a NEW search: the radius resets to
  // the walking default (review MED — sticky radius crossed search
  // contexts).
  const startResultsFrom = (seedBar: Bar) => {
    if (geo.state.status === 'idle' && geo.permissionState === 'granted') {
      geo.request();
    }
    // E4.1: "the bar you're at" IS the visit signal — tonight's Night
    // object records it with zero extra questions. The lib itself
    // refuses synthetic free-text seeds.
    recordVisit(seedBar.id);
    radiusTouchedRef.current = false;
    setSelectedRadius(DEFAULT_RADIUS);
    // QA-6: a new seed is a new search — hood override and run-it-again
    // history reset with the radius.
    resetResultsControls();
    // E2.2 (locked decision 3): the vibe belongs to the NIGHT — a pick
    // applied earlier tonight pre-fills every re-search until the 6am
    // rollover. It never locks: the tweak surface always allows changing
    // it, and a fresh night falls back to the seed bar's own tags.
    const nightVibe = loadNightVibe();
    setStep({
      kind: 'results',
      seedBar,
      tags: nightVibe ?? seedBar.tags,
    });
  };

  const handlePickBar = (bar: Bar) => startResultsFrom(bar);

  const handleNotListed = () => {
    setStep({ kind: 'freeTextSeed' });
  };

  const handleFreeTextSubmit = (synthetic: Bar) => startResultsFrom(synthetic);

  const handleFreeTextCancel = () => {
    setStep({ kind: 'pickBar' });
  };

  const handleApplyTweak = (nextTags: VibeTag[], nextHood?: Neighborhood | null) => {
    if (step.kind !== 'tweakVibe') return;
    // H3: neighborhood now arrives from inside the tweak surface rather than
    // from its own rail. `undefined` means the surface had no hood dimension;
    // `null` is a deliberate "Anywhere". Only the latter should clear it.
    if (nextHood !== undefined) handleHoodChange(nextHood);
    // An APPLIED tweak is tonight's vibe pick — cache it for re-searches
    // (E2.2 night cache). Cancel deliberately does not save. The shared
    // nightVibe state updates too: autoResults is re-reachable this
    // session (pickBar → "use my location") and must see tonight's pick.
    saveNightVibe(nextTags);
    setNightVibe(nextTags);
    // QA-6: a new vibe is a new ranking — the run-it-again history resets
    // (the hood override survives; vibe and hood are orthogonal).
    resetDealHistory();
    setStep({ kind: 'results', seedBar: step.seedBar, tags: nextTags });
  };

  const handleCancelTweak = () => {
    if (step.kind !== 'tweakVibe') return;
    setStep({ kind: 'results', seedBar: step.seedBar, tags: step.tags });
  };

  // QA1: the LOCATION-results twins of the pair above. Apply saves the
  // SAME night cache (one vibe per night) and updates local state so
  // autoResults re-ranks with the tweaked tags immediately; Cancel
  // returns unchanged. Both land back on autoResults with the coords the
  // surface already had — the tweak never disturbs the geo.
  const handleApplyAutoTweak = (nextTags: VibeTag[], nextHood?: Neighborhood | null) => {
    if (step.kind !== 'tweakVibeAuto') return;
    if (nextHood !== undefined) handleHoodChange(nextHood);
    saveNightVibe(nextTags);
    setNightVibe(nextTags);
    resetDealHistory();
    setStep({ kind: 'autoResults', coords: step.coords });
  };

  const handleCancelAutoTweak = () => {
    if (step.kind !== 'tweakVibeAuto') return;
    setStep({ kind: 'autoResults', coords: step.coords });
  };

  // Effective coord for ranking: real geolocation if granted, else seed bar's coord.
  const effectiveCoords = useMemo<Coords | null>(() => {
    if (geo.coords) return geo.coords;
    if (step.kind === 'locating') return null;
    if (step.kind === 'askLocation') return null;
    if (step.kind === 'autoResults') return step.coords;
    if (step.kind === 'tweakVibeAuto') return step.coords;
    if (step.kind === 'pickBar') return null;
    if (step.kind === 'freeTextSeed') return null;
    return { lat: step.seedBar.lat, lng: step.seedBar.lng };
  }, [geo.coords, step]);

  // The ranking anchor can MOVE mid-deal: a pending geo.request() resolving
  // replaces a seed/neighborhood anchor with real GPS coords the moment
  // geo.coords exists (memo above). A dealt hand and any armed widen
  // context are anchored to the coords they were dealt AT — carrying them
  // across an anchor move mis-buckets "newly eligible" and treats a hand
  // from the old anchor as seen at the new one (santa: Codex). Reset on
  // any genuine move; getCurrentPosition is one-shot (no watchPosition),
  // so this fires on discrete transitions, never GPS jitter.
  const anchorKey = effectiveCoords
    ? `${effectiveCoords.lat},${effectiveCoords.lng}`
    : 'none';
  const prevAnchorKeyRef = useRef(anchorKey);
  useEffect(() => {
    if (prevAnchorKeyRef.current === anchorKey) return;
    prevAnchorKeyRef.current = anchorKey;
    resetDealHistory();
  }, [anchorKey, resetDealHistory]);

  if (step.kind === 'askLocation') {
    return (
      <section className="min-h-screen px-6 py-16 flex flex-col items-center justify-center text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-4">
          Next Bar?
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-3 max-w-sm">
          Find bars near you
        </h1>
        <p className="text-muted text-sm mb-8 max-w-xs leading-relaxed">
          See what&apos;s good within a short walk. Your location stays in
          your browser — we never store it.
        </p>
        <button
          type="button"
          onClick={() => {
            // The REAL browser prompt fires from inside this tap —
            // gesture-bound asks are the ones users see and approve.
            geo.request();
            setStep({ kind: 'locating' });
          }}
          className="bg-accent hover:bg-accentDim transition-colors text-bg font-display text-lg px-8 py-3 rounded-full min-h-[44px] touch-manipulation mb-4"
        >
          Share my location
        </button>
        <button
          type="button"
          onClick={() => setStep({ kind: 'pickBar' })}
          className="text-accent underline-offset-4 hover:underline text-sm min-h-[44px] touch-manipulation"
        >
          Pick a bar instead
        </button>
      </section>
    );
  }

  if (step.kind === 'locating') {
    return (
      <section className="min-h-screen px-6 py-16 flex flex-col items-center justify-center text-center">
        <div
          role="status"
          aria-label="Finding bars near you"
          className="h-10 w-10 rounded-full border-2 border-border border-t-accent animate-spin mb-6"
        />
        <h1 className="font-display text-2xl md:text-3xl mb-2">
          Finding bars near you…
        </h1>
        <p className="text-muted text-sm mb-8 max-w-xs">
          Using your location to suggest your next spot.
        </p>
        <button
          type="button"
          onClick={() => setStep({ kind: 'pickBar' })}
          className="text-accent underline-offset-4 hover:underline text-sm min-h-[44px] touch-manipulation"
        >
          Pick a bar instead
        </button>
      </section>
    );
  }

  if (step.kind === 'autoResults') {
    const coords = step.coords;
    const goPickBar = () => {
      geo.reset();
      resetResultsControls();
      setStep({ kind: 'pickBar' });
    };
    return (
      <main>
        {/* QA1 row, copy tightened 2026-07-27 (operator: "too much
            text") — the escape keeps its chip but says just "Pick my
            bar". Both min-h-44. */}
        <div className="px-6 pt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={goPickBar}
            className="min-h-[44px] touch-manipulation rounded-full border border-border px-4 text-sm font-display hover:border-accent transition-colors"
          >
            Pick my bar
          </button>
        </div>
        {/*
          H2 (goal g-44007df6): distance is the ONLY top-level rail. The
          neighborhood picker moved INSIDE Tweak-the-vibe (H3) — the operator
          asked for "just Walkable / Worth a cab / Anywhere, nothing else at
          that level". DistanceChips already had exactly those three, so H2 was
          never about adding chips; it was about removing everything beside
          them.
        */}
        <div className="px-6 pt-3">
          <DistanceChips value={selectedRadius} onChange={handleRadiusChange} />
        </div>
        <ResultsView
          profile={autoProfile}
          location={
            resultsHood
              ? { kind: 'neighborhood', neighborhood: resultsHood }
              : {
                  kind: 'coords',
                  coords,
                  band: geo.accuracyBand,
                  snappedTo: geo.snappedNeighborhood,
                }
          }
          maxMiles={selectedRadius.maxMiles}
          maxResults={RESULTS_COUNT}
          hideClosedNow
          excludeIds={autoExcludeIds}
          widenedFromMiles={widenedFromMiles}
          seenIds={widenActive ? shownIds : undefined}
          onRanked={handleRanked}
          showShare={isPlanning}
        />
        {/* QA-6 refresh: deal the next batch (excluding everything already
            shown this search); wraps on small pools. */}
        <div className="px-6 pt-2 text-center">
          <button
            type="button"
            onClick={handleRunAgain}
            className="min-h-[48px] touch-manipulation rounded-full border border-border px-6 font-display text-base hover:border-accent transition-colors"
          >
            ↻ Run it again
          </button>
        </div>
        {/*
          H1 (goal g-44007df6): "Tweak the vibe" moved from the top control row
          to CENTRED AT THE BOTTOM, beneath the results. It is the deeper
          control — you look at what you got, then reach for it — so it sits
          after the thing it modifies rather than competing with "Pick my bar"
          above the fold.
        */}
        <div className="px-6 pt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setStep({ kind: 'tweakVibeAuto', coords })}
            className="min-h-[48px] touch-manipulation rounded-full border border-border px-6 font-display text-base hover:border-accent transition-colors"
          >
            Tweak the vibe
          </button>
        </div>
        {/* Operator fix 2026-07-27: the bottom duplicate of "Not at these
            bars?" is DELETED — the escape lives once, in the top control
            row. pb-28 spacer still clears the fixed bottom nav (R5). */}
        <div className="pb-28" />
      </main>
    );
  }

  if (step.kind === 'pickBar') {
    return (
      /*
        pb-24 (on top of py-8) reserves scroll clearance for the fixed BottomNav,
        whose raised centre tab otherwise covered the LAST row of the bar list —
        its centre point resolved to the nav tab, so the bottom row was
        untappable. This lives HERE rather than inside BarPicker because this is
        the only one of BarPicker's four call sites that sits in normal flow under
        the nav; the others are z-[1100] dialogs and an inline card panel.
        Padding not margin: a last-child bottom margin collapses out and adds
        nothing to scrollHeight (measured — see the same fix on /settings).
        `pt-8 pb-24` rather than `py-8 pb-24`: both reviewers noted the latter
        relies on utility ordering to resolve the bottom edge and reads as though
        the padding were symmetric. Measured identical output (top 32px, bottom
        96px) with no ordering dependence.
      */
      <section className="min-h-screen px-4 pt-8 pb-24 md:px-6">
        <div className="max-w-2xl mx-auto">
          <h1 className="font-display text-3xl md:text-4xl text-center mb-2">
            Where are you?
          </h1>
          <p className="text-muted text-sm text-center mb-6">
            Pick the bar you&apos;re at — we&apos;ll find the next one.
          </p>
          {/* Location blocked (operator report: iOS "never asks"): explain
              the iOS settings paths instead of failing silently. The picker
              below stays fully usable either way. */}
          {geo.state.status === 'denied' || geo.permissionState === 'denied' ? (
            <div className="mb-6">
              <LocationAccessHelp
                onRetry={() => {
                  geo.reset();
                  setStep({ kind: 'locating' });
                }}
              />
            </div>
          ) : (
            // Location is always ONE TAP away (operator ask 2026-07-25):
            // someone who skipped the primer — or landed here any other
            // way — can still share their location without reloading. The
            // request fires from this tap (gesture-bound prompt).
            <div className="mb-6 text-center">
              <button
                type="button"
                onClick={() => {
                  geo.request();
                  setStep({ kind: 'locating' });
                }}
                className="text-accent font-display text-sm min-h-[44px] touch-manipulation hover:underline underline-offset-4"
              >
                📍 Or use my location
              </button>
            </div>
          )}
          <BarPicker onPick={handlePickBar} onNotListed={handleNotListed} />
        </div>
      </section>
    );
  }

  if (step.kind === 'freeTextSeed') {
    return (
      <FreeTextSeed
        onSubmit={handleFreeTextSubmit}
        onCancel={handleFreeTextCancel}
      />
    );
  }

  if (step.kind === 'tweakVibeAuto') {
    // Same surface as the manual tweak below — only the seed and the
    // return destination differ. Seeds from tonight's cached vibe, else
    // the quiz profile's tags (what the location results are currently
    // ranked by, so the surface opens showing the truth).
    return (
      <VibeTweak
        initialTags={nightVibe ?? profile.tags}
        initialNeighborhood={resultsHood}
        onApply={handleApplyAutoTweak}
        onCancel={handleCancelAutoTweak}
      />
    );
  }

  if (step.kind === 'tweakVibe') {
    return (
      <VibeTweak
        initialTags={step.tags}
        initialNeighborhood={resultsHood}
        onApply={handleApplyTweak}
        onCancel={handleCancelTweak}
      />
    );
  }

  // results
  const seedProfile: VibeProfile = {
    tags: step.tags,
    archetype: deriveArchetype(step.tags),
    preferredNeighborhoods: [],
  };
  const userCoordsForView: Coords = effectiveCoords ?? {
    lat: step.seedBar.lat,
    lng: step.seedBar.lng,
  };
  return (
    <main>
      <section className="px-6 py-6 text-center">
        <p className="text-muted text-sm mb-1">From {step.seedBar.name}</p>
        <p className="font-display text-2xl mb-4">Next bars</p>
        {/* E2.1: the radius fine-tune lives HERE — one screen, live re-rank,
            walking default. E3.2: distance is two intent chips + the Anywhere
            escape, not units.
            H2/H3 (goal g-44007df6): the hood rail that used to sit above this
            has MOVED INSIDE Tweak-the-vibe, so distance is the only top-level
            rail on both results surfaces. Keeping it here would have left the
            two surfaces inconsistent, which is exactly what "land M1+H1+H2+H3
            as one piece" exists to prevent. */}
        <DistanceChips value={selectedRadius} onChange={handleRadiusChange} />
      </section>
      <ResultsView
        profile={seedProfile}
        location={
          resultsHood
            ? { kind: 'neighborhood', neighborhood: resultsHood }
            : {
                kind: 'coords',
                coords: userCoordsForView,
                band: geo.accuracyBand,
                snappedTo: geo.snappedNeighborhood,
              }
        }
        maxMiles={selectedRadius.maxMiles}
        maxResults={RESULTS_COUNT}
        excludeIds={manualExcludeIds}
        widenedFromMiles={widenedFromMiles}
        seenIds={widenActive ? shownIds : undefined}
        hideClosedNow
        onRanked={handleRanked}
        showShare={isPlanning}
      />
      {/* QA-6 refresh: deal the next batch. */}
      <div className="px-6 pt-2 text-center">
        <button
          type="button"
          onClick={handleRunAgain}
          className="min-h-[48px] touch-manipulation rounded-full border border-border px-6 font-display text-base hover:border-accent transition-colors"
        >
          ↻ Run it again
        </button>
      </div>
      {/*
        H1 on THIS surface too. The first pass moved the control on the auto
        results only and left this one as a small underlined link ABOVE the
        results — which reproduced exactly the cross-surface inconsistency that
        "land M1+H1+H2+H3 as one piece" exists to prevent. Same position, same
        affordance, both surfaces.
      */}
      <div className="px-6 pt-6 flex justify-center">
        <button
          type="button"
          onClick={() =>
            setStep({
              kind: 'tweakVibe',
              seedBar: step.seedBar,
              tags: step.tags,
            })
          }
          className="min-h-[48px] touch-manipulation rounded-full border border-border px-6 font-display text-base hover:border-accent transition-colors"
        >
          Tweak the vibe
        </button>
      </div>
      <BarMap
        bars={[step.seedBar]}
        userCoords={userCoordsForView}
        highlightIds={[step.seedBar.id]}
      />
      {/* pb-28 clears the fixed bottom nav — without it the escape
          route is visually present but untappable (R5; caught by e2e
          pointer-interception on Pixel). */}
      <div className="px-6 pt-8 pb-28 text-center">
        <button
          type="button"
          onClick={() => {
            resetResultsControls();
            setStep({ kind: 'pickBar' });
          }}
          className="text-accent underline-offset-4 hover:underline text-sm min-h-[44px] touch-manipulation"
        >
          Pick a different bar
        </button>
      </div>
    </main>
  );
}
