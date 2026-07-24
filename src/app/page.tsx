'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import WhereNextFlow from '@/components/WhereNextFlow';
import { loadProfile } from '@/lib/storedProfile';

export default function HomePage() {
  // MED-26: `/` never prompted the quiz — profile-less visitors got the
  // location flow with generic (vibe-less) suggestions and no hint that a
  // 60-second quiz personalizes everything. localStorage read must wait
  // for mount (SSR has no storage); until then render nothing extra.
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  useEffect(() => {
    setHasProfile(loadProfile() !== null);
  }, []);

  return (
    <main>
      <header className="px-6 py-4 flex items-center justify-between border-b border-border">
        <p className="font-display text-accent text-sm uppercase tracking-[0.3em]">
          Next Bar
        </p>
        <Link
          href="/install"
          className="text-muted hover:text-text underline-offset-4 hover:underline text-sm min-h-[44px] inline-flex items-center touch-manipulation"
        >
          Get the app →
        </Link>
      </header>
      {hasProfile === false ? (
        <div className="px-6 pt-4">
          <Link
            href="/quiz"
            className="block max-w-md mx-auto bg-surface border border-accent/40 rounded-2xl px-5 py-4 touch-manipulation hover:border-accent transition-colors"
          >
            <p className="font-display text-sm mb-1">
              New here? Take the vibe quiz →
            </p>
            <p className="text-muted text-xs leading-relaxed">
              60 seconds, and every suggestion gets picked for your taste —
              not just what&apos;s nearby.
            </p>
          </Link>
        </div>
      ) : null}
      <WhereNextFlow />
    </main>
  );
}
