'use client';

import Link from 'next/link';
import TonightPresence from '../_components/TonightPresence';

/**
 * /friends/tonight — YOU TONIGHT, pushed from the Social header's pin icon
 * (Social redesign 2026-09-13, README §4 and §5). One screen answers both
 * "are you going out?" and "where are you?"; the pin sequence writes once, on
 * Pin it. Owner decision: this is the ONLY entry to presence — Tonight itself
 * carries no status row.
 */
export default function YouTonightPage(): JSX.Element {
  return (
    <main className="min-h-screen pb-28">
      <header className="max-w-md mx-auto w-full flex items-center gap-2 px-4 pt-2.5 pb-2">
        <Link
          href="/friends"
          aria-label="Back to Social"
          data-testid="tonight-back"
          className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-2xl text-text text-lg touch-manipulation"
        >
          <span aria-hidden="true">‹</span>
        </Link>
        <h1 className="font-display text-base font-bold min-w-0 flex-1">You tonight</h1>
      </header>

      <div className="max-w-md mx-auto px-6 pt-2">
        <TonightPresence />
      </div>
    </main>
  );
}
