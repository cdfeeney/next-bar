'use client';

import type { VibeProfile } from '@/types';

type ResultCardProps = { profile: VibeProfile };

export default function ResultCard({ profile }: ResultCardProps) {
  const visibleTags = profile.tags.slice(0, 8);

  return (
    <section className="px-6 py-16">
      <div className="max-w-2xl mx-auto bg-surface border border-border rounded-3xl p-10 text-center">
        <p className="text-accent uppercase tracking-widest text-xs mb-4">Your vibe</p>
        <h2 className="font-display text-4xl md:text-5xl mb-6 leading-tight">
          {profile.archetype}
        </h2>
        <div className="flex flex-wrap gap-2 justify-center">
          {visibleTags.map((tag) => (
            <span
              key={tag}
              className="px-3 py-1 text-sm bg-bg border border-border rounded-full text-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
