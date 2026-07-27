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
  loadNightVisits,
  recordVisit,
} from '@/lib/nightLog';
import { nycNightKey } from '@/lib/nightKey';
import { useNightRefresh } from '@/hooks/useIntent';
import {
  RADIUS_ANYWHERE,
  RADIUS_WALK,
  RESULTS_COUNT,
} from '@/lib/constants';
import { advanceShownIds } from '@/lib/resultsRefresh';
import BarPicker from '@/components/BarPicker';
import FreeTextSeed from '@/components/FreeTextSeed';
import DistanceChips from '@/components/DistanceChips';
import ResultsHoodChips from '@/components/ResultsHoodChips';
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

const DEFAULT_RADIUS: Radius = { kind: 'walking', maxMiles: RADIUS_WALK };
/**
 * The location-first auto surface enters on Anywhere (review HIGH: it
 * always guaranteed a full first load pre-QA-6 — maxMiles was null — and
 * a walking default would blank it for anyone >1.5mi from a catalog bar).
 * Manual seed-bar entries keep the walking default: "at a bar" implies
 * the next one is walkable.
 */
const AUTO_ENTRY_RADIUS: Radius = { kind: 'anywhere', maxMiles: RADIUS_ANYWHERE };

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
    const saved = loadProfile();
    if (saved) {
      setProfile({
        tags: saved.tags,
        archetype: saved.archetype,
        preferredNeighborhoods: saved.preferredNeighborhoods,
      });
    }
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

  // The profile the LOCATION results rank by: tweaked night vibe when one
  // exists, else the stored quiz profile. preferredNeighborhoods mirrors
  // the manual seedProfile ([]) — ResultsView ignores it for coords
  // locations anyway (the geo IS the neighborhood signal).
  const autoProfile = useMemo<VibeProfile>(
    () =>
      nightVibe
        ? {
            tags: nightVibe,
            archetype: deriveArchetype(nightVibe),
            preferredNeighborhoods: [],
          }
        : profile,
    [nightVibe, profile],
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
      // Fresh auto entry: full-coverage first load (see AUTO_ENTRY_RADIUS).
      setSelectedRadius(AUTO_ENTRY_RADIUS);
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
  const lastRankedRef = useRef<string[]>([]);
  const handleRanked = useCallback((ids: string[]): void => {
    lastRankedRef.current = ids;
    // Wrap backstop (review HIGH): a pool that's an EXACT multiple of the
    // page size accumulates fully without advanceShownIds ever seeing a
    // short page — when the exclusions empty the rank, restart the cycle
    // instead of stranding the user on "No matches found".
    if (ids.length === 0) {
      setShownIds((prev) => (prev.length > 0 ? [] : prev));
    }
  }, []);
  const handleRunAgain = useCallback((): void => {
    setShownIds((prev) =>
      advanceShownIds(prev, lastRankedRef.current, RESULTS_COUNT),
    );
  }, []);
  const handleRadiusChange = useCallback((next: Radius): void => {
    setSelectedRadius(next);
    setShownIds([]);
  }, []);
  const handleHoodChange = useCallback((next: Neighborhood | null): void => {
    setResultsHood(next);
    setShownIds([]);
    // Review MED: "In Harlem" must mean the WHOLE hood — a walking cap
    // measured from the hood's centroid silently drops edge bars. Picking
    // a hood widens the radius chip to Anywhere (visible state change;
    // the user can still narrow it again afterwards).
    if (next !== null) {
      setSelectedRadius({ kind: 'anywhere', maxMiles: RADIUS_ANYWHERE });
    }
  }, []);
  const resetResultsControls = useCallback((): void => {
    setResultsHood(null);
    setShownIds([]);
  }, []);

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
  const manualExcludeIds = useMemo(
    () =>
      seedBarId
        ? [seedBarId, ...visitedIds, ...shownIds]
        : [...visitedIds, ...shownIds],
    [seedBarId, visitedIds, shownIds],
  );
  const autoExcludeIds = useMemo(
    () => [...visitedIds, ...shownIds],
    [visitedIds, shownIds],
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

  const handleApplyTweak = (nextTags: VibeTag[]) => {
    if (step.kind !== 'tweakVibe') return;
    // An APPLIED tweak is tonight's vibe pick — cache it for re-searches
    // (E2.2 night cache). Cancel deliberately does not save. The shared
    // nightVibe state updates too: autoResults is re-reachable this
    // session (pickBar → "use my location") and must see tonight's pick.
    saveNightVibe(nextTags);
    setNightVibe(nextTags);
    // QA-6: a new vibe is a new ranking — the run-it-again history resets
    // (the hood override survives; vibe and hood are orthogonal).
    setShownIds([]);
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
  const handleApplyAutoTweak = (nextTags: VibeTag[]) => {
    if (step.kind !== 'tweakVibeAuto') return;
    saveNightVibe(nextTags);
    setNightVibe(nextTags);
    setShownIds([]);
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
        {/* QA1 (operator 2026-07-26 mobile QA): the two controls the
            operator couldn't find get a compact, visible row ABOVE the
            results — the pick-my-bar escape (duplicated from the bottom
            link, same action) and the vibe tweak entry the location
            results were missing entirely. Both min-h-44. */}
        <div className="px-6 pt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={goPickBar}
            className="min-h-[44px] touch-manipulation rounded-full border border-border px-4 text-sm font-display hover:border-accent transition-colors"
          >
            Not at these bars? Pick yours →
          </button>
          <button
            type="button"
            onClick={() => setStep({ kind: 'tweakVibeAuto', coords })}
            className="min-h-[44px] touch-manipulation rounded-full border border-border px-4 text-sm font-display hover:border-accent transition-colors"
          >
            Tweak the vibe
          </button>
        </div>
        {/* QA-6 one results view: the SAME control set as the manual
            results — optional hood override + distance chips. */}
        <div className="px-6 pt-3">
          <ResultsHoodChips
            value={resultsHood}
            onChange={handleHoodChange}
            anchorLabel="Near me"
          />
          <div className="mt-3">
            <DistanceChips
              value={selectedRadius}
              onChange={handleRadiusChange}
            />
          </div>
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
          onRanked={handleRanked}
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
        {/* pb-28 clears the fixed bottom nav (operator: "never able to
            see the bottom option on mobile" — same R5 class as the
            manual results' escape). */}
        <div className="px-6 pt-2 pb-28 text-center">
          <button
            type="button"
            onClick={goPickBar}
            className="text-accent underline-offset-4 hover:underline text-sm min-h-[44px] touch-manipulation"
          >
            Not at these bars? Pick yours →
          </button>
        </div>
      </main>
    );
  }

  if (step.kind === 'pickBar') {
    return (
      <section className="min-h-screen px-4 py-8 md:px-6">
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
        onApply={handleApplyAutoTweak}
        onCancel={handleCancelAutoTweak}
      />
    );
  }

  if (step.kind === 'tweakVibe') {
    return (
      <VibeTweak
        initialTags={step.tags}
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
        {/* E2.1: the radius fine-tune lives HERE now — one screen, live
            re-rank, walking default. E3.2: distance is two intent chips
            + the Anywhere escape, not units. QA-6: plus the optional
            hood override — the same control set as the location results. */}
        <div className="mb-3">
          <ResultsHoodChips
            value={resultsHood}
            onChange={handleHoodChange}
            anchorLabel="Near here"
          />
        </div>
        <DistanceChips value={selectedRadius} onChange={handleRadiusChange} />
        <div className="mt-3">
          <button
            type="button"
            onClick={() =>
              setStep({
                kind: 'tweakVibe',
                seedBar: step.seedBar,
                tags: step.tags,
              })
            }
            className="text-accent underline-offset-4 hover:underline text-sm min-h-[44px] touch-manipulation"
          >
            Tweak the vibe
          </button>
        </div>
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
        hideClosedNow
        onRanked={handleRanked}
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
