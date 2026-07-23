/**
 * /share/[barId] — the recipient side of a shared "Tonight's pick"
 * (blueprint B3). Server-rendered so the link works logged-out, with its
 * own OG image (./opengraph-image.tsx) for branded unfurls. The CTA sends
 * the recipient into the app — invite attribution comes with D1.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { bars } from '@/lib/bars';

type ShareParams = { params: { barId: string } };

function barFor(barId: string) {
  return bars.find((b) => b.id === decodeURIComponent(barId));
}

export function generateMetadata({ params }: ShareParams): Metadata {
  const bar = barFor(params.barId);
  if (!bar) return { title: 'Next Bar' };
  return {
    title: `Tonight's pick: ${bar.name} — Next Bar`,
    description: `${bar.name}, ${bar.neighborhood}. ${bar.blurb}`,
  };
}

export default function SharePickPage({ params }: ShareParams): JSX.Element {
  const bar = barFor(params.barId);
  if (!bar) notFound();

  return (
    <main className="min-h-screen pb-28 flex flex-col justify-center">
      <section className="max-w-md mx-auto px-6 w-full">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3 text-center">
          Tonight&apos;s pick
        </p>

        <article className="rounded-3xl p-6 border glow-accent border-accent bg-gradient-to-b from-accent/[0.08] to-surface text-center">
          <h1 className="font-display text-3xl leading-tight mb-1">
            {bar.name}
          </h1>
          <p className="text-muted text-xs uppercase tracking-wider">
            {bar.neighborhood} · {'$'.repeat(bar.priceTier)}
          </p>
          <p className="text-sm italic mt-3">{bar.blurb}</p>
          <p className="text-muted text-xs mt-3">{bar.address}</p>
        </article>

        <div className="text-center mt-8">
          <p className="text-muted text-sm mb-4 leading-relaxed">
            Your friends settled it on Next Bar — the app that finds the bar
            your whole group agrees on.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center bg-accent text-bg font-display text-lg px-6 py-3 rounded-full min-h-[44px] touch-manipulation"
          >
            Get Next Bar →
          </Link>
        </div>
      </section>
    </main>
  );
}
