'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Bar, Coords, Radius, VibeProfile, VibeTag } from '@/types';
import { deriveArchetype } from '@/lib/quiz';
import { useGeolocation } from '@/hooks/useGeolocation';
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
  // Location-first entry: on open we try to locate the user and jump straight
  // to suggestions. Only if we can't locate them do we fall back to pickBar.
  | { kind: 'locating' }
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

  // Location-first: request GPS on open, then route to suggestions (precise or
  // snapped fix) or fall back to the manual pickBar flow (denied / unavailable /
  // too-coarse-to-place).
  useEffect(() => {
    if (step.kind !== 'locating') return;
    const status = geo.state.status;
    if (status === 'idle') {
      geo.request();
      return;
    }
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
    }
  }, [step.kind, geo.state.status, geo.coords, geo]);

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
    if (step.kind === 'autoResults') return step.coords;
    if (step.kind === 'pickBar') return null;
    if (step.kind === 'freeTextSeed') return null;
    if (step.kind === 'confirmGps') return null;
    return { lat: step.seedBar.lat, lng: step.seedBar.lng };
  }, [geo.coords, step]);

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
