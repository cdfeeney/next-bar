'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import type {
  AccuracyBand,
  Coords,
  ManhattanNeighborhood,
  VibeProfile,
} from '@/types';
import VibeQuiz from '@/components/VibeQuiz';
import LocationPrompt from '@/components/LocationPrompt';
import ResultsView from '@/components/ResultsView';
import InstallNudge from '@/components/InstallNudge';
import { bars } from '@/lib/bars';
import { matches } from '@/lib/matching';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';
import { saveProfile } from '@/lib/storedProfile';

const QUIZ_TOP_N = 10;

const BarMap = dynamic(() => import('@/components/BarMap'), { ssr: false });

type Phase = 'quiz' | 'locate' | 'result';

type ResolvedLocation =
  | { kind: 'coords'; coords: Coords; band: AccuracyBand; snappedTo: ManhattanNeighborhood | null }
  | { kind: 'neighborhood'; neighborhood: ManhattanNeighborhood };

export default function QuizPage() {
  const [phase, setPhase] = useState<Phase>('quiz');
  const [profile, setProfile] = useState<VibeProfile | null>(null);
  const [location, setLocation] = useState<ResolvedLocation | null>(null);

  return (
    <main>
      <header className="px-6 py-4 flex items-center justify-between border-b border-border">
        <Link
          href="/"
          className="font-display text-accent text-sm uppercase tracking-widest min-h-[44px] touch-manipulation flex items-center"
        >
          Next Bar
        </Link>
        <Link
          href="/"
          className="text-muted underline-offset-4 hover:underline text-sm min-h-[44px] touch-manipulation flex items-center"
        >
          Skip
        </Link>
      </header>

      {phase === 'quiz' && (
        <VibeQuiz
          onComplete={(p) => {
            saveProfile(p);
            setProfile(p);
            setPhase('locate');
          }}
        />
      )}

      {phase === 'locate' && profile && (
        <section className="min-h-screen flex flex-col justify-center">
          <LocationPrompt
            onResolved={(input) => {
              setLocation(input);
              setPhase('result');
            }}
          />
        </section>
      )}

      {phase === 'result' && profile && location && (
        <QuizResults profile={profile} location={location} />
      )}
    </main>
  );
}

type QuizResultsProps = {
  profile: VibeProfile;
  location: ResolvedLocation;
};

function QuizResults({ profile, location }: QuizResultsProps) {
  const userCoords: Coords =
    location.kind === 'coords'
      ? location.coords
      : NEIGHBORHOOD_CENTROIDS[location.neighborhood];

  const preferredNeighborhoods =
    location.kind === 'neighborhood'
      ? [location.neighborhood]
      : profile.preferredNeighborhoods;

  const ranked = matches({
    profile,
    coords: userCoords,
    preferredNeighborhoods,
    maxMiles: null,
    bars,
    maxResults: QUIZ_TOP_N,
  });

  const highlightIds = ranked.map((b) => b.id);

  return (
    <>
      <ResultsView
        profile={profile}
        location={location}
        maxMiles={null}
        maxResults={QUIZ_TOP_N}
      />
      <BarMap bars={bars} userCoords={userCoords} highlightIds={highlightIds} />
      <InstallNudge />
      <div className="px-6 py-6 text-center">
        <Link
          href="/"
          className="text-accent underline-offset-4 hover:underline text-sm min-h-[44px] touch-manipulation inline-flex items-center"
        >
          Back to home
        </Link>
      </div>
      <footer className="px-6 py-6 text-center text-muted text-sm">
        Next Bar · Manhattan · 2026
      </footer>
    </>
  );
}
