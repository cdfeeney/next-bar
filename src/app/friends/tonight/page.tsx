'use client';

import TonightPresence from '../_components/TonightPresence';

/**
 * /friends/tonight — YOU TONIGHT, pushed from the Social header's pin icon
 * (Social redesign 2026-09-13, README §4 and §5). One state machine, three
 * pushed screens: You tonight → Where are you? → Pin your spot (`?step=`), and
 * the pin sequence writes once, on Pin it. Owner decision: this is the ONLY
 * entry to presence — Tonight itself carries no status row. The header
 * (back + title) is drawn per step by TonightPresence.
 */
export default function YouTonightPage(): JSX.Element {
  return (
    <main className="min-h-screen pb-28">
      <TonightPresence />
    </main>
  );
}
