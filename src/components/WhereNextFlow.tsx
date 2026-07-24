'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Bar, Coords, Radius, VibeProfile, VibeTag } from '@/types';
import { deriveArchetype } from '@/lib/quiz';
import { useGeolocation } from '@/hooks/useGeolocation';
import LocationAccessHelp from '@/components/LocationAccessHelp';
import { loadProfile } from '@/lib/storedProfile';
import { RADIUS_WALK } from '@/lib/constants';
import BarPicker from '@/components/BarPicker';
import FreeTextSeed from '@/components/FreeTextSeed';
import GpsConfirm from '@/components/GpsConfirm';
import RadiusSlider from '@/components/RadiusSlider';
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
  | { kind: 'locating' }
  | { kind: 'askLocation' }
  | { kind: 'autoResults'; coords: Coords }
  | { kind: 'pickBar' }
  | { kind: 'freeTextSeed' }
  | { kind: 'confirmGps'; seedBar: Bar }
  | { kind: 'pickRadius'; seedBar: Bar; tags: VibeTag[] }
  | { kind: 'tweakVibe'; seedBar: Bar; tags: VibeTag[]; radius: Radius }
  | { kind: 'results'; seedBar: Bar; tags: VibeTag[]; radius: Radius };

const DEFAULT_RADIUS: Radius = { kind: 'walking', maxMiles: RADIUS_WALK };
/** How many bars the location-first auto-suggester surfaces. */
const SUGGEST_COUNT = 5;

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

  // Location-first routing. In 'locating' we NEVER fire the browser
  // request ourselves anymore — the hook auto-fetches when permission is
  // already granted (U2-4); an undecided permission routes to the primer,
  // whose TAP calls request() (gesture-bound = the prompt actually shows
  // and gets approved); a denial lands on pickBar with the recovery card.
  useEffect(() => {
    if (step.kind !== 'locating' && step.kind !== 'askLocation') return;
    const status = geo.state.status;
    if (geo.coords) {
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

  // Request geolocation when we move into confirmGps via the manual path.
  useEffect(() => {
    if (step.kind === 'confirmGps' && geo.state.status === 'idle') {
      geo.request();
    }
  }, [step.kind, geo]);

  const handlePickBar = (bar: Bar) => {
    setStep({ kind: 'confirmGps', seedBar: bar });
  };

  const handleNotListed = () => {
    setStep({ kind: 'freeTextSeed' });
  };

  const handleFreeTextSubmit = (synthetic: Bar) => {
    setStep({ kind: 'confirmGps', seedBar: synthetic });
  };

  const handleFreeTextCancel = () => {
    setStep({ kind: 'pickBar' });
  };

  const handleGpsProceed = () => {
    if (step.kind !== 'confirmGps') return;
    setStep({
      kind: 'pickRadius',
      seedBar: step.seedBar,
      tags: step.seedBar.tags,
    });
  };

  const handlePickDifferent = () => {
    geo.reset();
    setStep({ kind: 'pickBar' });
  };

  const [selectedRadius, setSelectedRadius] = useState<Radius>(DEFAULT_RADIUS);

  const handleRadiusChange = (next: Radius) => {
    setSelectedRadius(next);
  };

  const handleShowResults = () => {
    if (step.kind !== 'pickRadius') return;
    setStep({
      kind: 'results',
      seedBar: step.seedBar,
      tags: step.tags,
      radius: selectedRadius,
    });
  };

  const handleOpenTweak = () => {
    if (step.kind !== 'pickRadius') return;
    setStep({
      kind: 'tweakVibe',
      seedBar: step.seedBar,
      tags: step.tags,
      radius: selectedRadius,
    });
  };

  const handleApplyTweak = (nextTags: VibeTag[]) => {
    if (step.kind !== 'tweakVibe') return;
    setStep({
      kind: 'pickRadius',
      seedBar: step.seedBar,
      tags: nextTags,
    });
  };

  const handleCancelTweak = () => {
    if (step.kind !== 'tweakVibe') return;
    setStep({
      kind: 'pickRadius',
      seedBar: step.seedBar,
      tags: step.tags,
    });
  };

  // Effective coord for ranking: real geolocation if granted, else seed bar's coord.
  const effectiveCoords = useMemo<Coords | null>(() => {
    if (geo.coords) return geo.coords;
    if (step.kind === 'locating') return null;
    if (step.kind === 'askLocation') return null;
    if (step.kind === 'autoResults') return step.coords;
    if (step.kind === 'pickBar') return null;
    if (step.kind === 'freeTextSeed') return null;
    if (step.kind === 'confirmGps') return null;
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
    return (
      <main>
        <ResultsView
          profile={profile}
          location={{
            kind: 'coords',
            coords: step.coords,
            band: geo.accuracyBand,
            snappedTo: geo.snappedNeighborhood,
          }}
          maxMiles={null}
          maxResults={SUGGEST_COUNT}
        />
        <div className="px-6 pb-10 text-center">
          <button
            type="button"
            onClick={() => {
              geo.reset();
              setStep({ kind: 'pickBar' });
            }}
            className="text-accent underline-offset-4 hover:underline text-sm min-h-[44px] touch-manipulation"
          >
            Coming from a specific bar?
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

  if (step.kind === 'confirmGps') {
    return (
      <GpsConfirm
        seedBar={step.seedBar}
        userCoords={geo.coords}
        accuracyBand={geo.accuracyBand}
        geoStatus={geo.state.status}
        onProceed={handleGpsProceed}
        onPickDifferent={handlePickDifferent}
      />
    );
  }

  if (step.kind === 'pickRadius') {
    return (
      <section className="min-h-screen px-6 py-12">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-muted text-sm mb-2">From {step.seedBar.name}</p>
          <h1 className="font-display text-3xl md:text-4xl mb-8">
            How far you wanna go?
          </h1>
          <RadiusSlider value={selectedRadius} onChange={handleRadiusChange} />

          <div className="mt-8">
            <button
              type="button"
              onClick={handleOpenTweak}
              className="text-accent underline-offset-4 hover:underline text-sm min-h-[44px] touch-manipulation"
            >
              Tweak the vibe
            </button>
          </div>

          <div className="mt-8">
            <button
              type="button"
              onClick={handleShowResults}
              className="min-h-[44px] touch-manipulation bg-accent text-bg hover:bg-accentDim transition-colors font-display text-lg px-8 py-3 rounded-full"
            >
              Show me bars
            </button>
          </div>
        </div>
      </section>
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
        <p className="font-display text-2xl">
          Next bars · {step.radius.kind === 'walking'
            ? 'within walking'
            : step.radius.kind === 'shortUber'
            ? 'short Uber'
            : 'anywhere in Manhattan'}
        </p>
      </section>
      <ResultsView
        profile={seedProfile}
        location={{
          kind: 'coords',
          coords: userCoordsForView,
          band: geo.accuracyBand,
          snappedTo: geo.snappedNeighborhood,
        }}
        maxMiles={step.radius.maxMiles}
        excludeIds={[step.seedBar.id]}
      />
      <BarMap
        bars={[step.seedBar]}
        userCoords={userCoordsForView}
        highlightIds={[step.seedBar.id]}
      />
      <div className="px-6 py-8 text-center">
        <button
          type="button"
          onClick={() => setStep({ kind: 'pickBar' })}
          className="text-accent underline-offset-4 hover:underline text-sm min-h-[44px] touch-manipulation"
        >
          Pick a different bar
        </button>
      </div>
    </main>
  );
}
