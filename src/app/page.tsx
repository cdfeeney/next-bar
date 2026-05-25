'use client';

import Link from 'next/link';
import WhereNextFlow from '@/components/WhereNextFlow';

export default function HomePage() {
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
      <WhereNextFlow />
    </main>
  );
}
