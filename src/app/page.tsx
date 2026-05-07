'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { VibeProfile } from '@/types';
import Hero from '@/components/Hero';
import VibeQuiz from '@/components/VibeQuiz';
import ResultCard from '@/components/ResultCard';
import WaitlistForm from '@/components/WaitlistForm';

const BarMap = dynamic(() => import('@/components/BarMap'), { ssr: false });

type Phase = 'hero' | 'quiz' | 'result';

export default function Page() {
  const [phase, setPhase] = useState<Phase>('hero');
  const [profile, setProfile] = useState<VibeProfile | null>(null);

  return (
    <main>
      {phase === 'hero' && <Hero onStart={() => setPhase('quiz')} />}
      {phase === 'quiz' && (
        <VibeQuiz
          onComplete={(p) => {
            setProfile(p);
            setPhase('result');
          }}
        />
      )}
      {phase === 'result' && profile && (
        <>
          <ResultCard profile={profile} />
          <BarMap profile={profile} />
          <WaitlistForm profile={profile} />
          <footer className="px-6 py-10 text-center text-muted text-sm">
            Next Bar · NYC · 2026
          </footer>
        </>
      )}
    </main>
  );
}
