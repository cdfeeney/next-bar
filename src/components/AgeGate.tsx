'use client';

import { useEffect, useState } from 'react';

/**
 * 21+ age gate (H1 App-Store pack). Full-screen overlay on first visit;
 * a tap on "I'm 21 or older" acknowledges and never shows again on this
 * device.
 *
 * The ack is a DEVICE-level statement, deliberately NOT registered in
 * accountCache ALL_KEYS (nightlog N2 spec): it is not account data, and a
 * sign-out must not un-acknowledge the age gate — the person at the
 * keyboard did not change.
 *
 * Render contract: nothing until the localStorage read resolves (no flash
 * of the overlay for acked users, no flash of content for new ones — the
 * page underneath renders regardless, but the overlay mounts within the
 * first client frame).
 */
const KEY = 'next-bar:age-ack:v1';

type AckState = 'unknown' | 'acked' | 'unacked';

export default function AgeGate(): JSX.Element | null {
  const [state, setState] = useState<AckState>('unknown');

  useEffect(() => {
    try {
      setState(window.localStorage.getItem(KEY) === '1' ? 'acked' : 'unacked');
    } catch {
      // Storage unavailable (private-mode edge cases): show the gate; the
      // ack just won't persist. Fail toward asking, never toward skipping.
      setState('unacked');
    }
  }, []);

  if (state !== 'unacked') return null;

  const acknowledge = (): void => {
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      // Non-fatal: the session continues; the gate returns next visit.
    }
    setState('acked');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
      // z-[2000]: above BottomNav's z-[1000] — the gate must cover the nav
      // too, or an unacked user can browse right under it (caught by the
      // app-store-pack e2e blocking test).
      className="fixed inset-0 z-[2000] bg-bg/95 backdrop-blur-sm flex items-center justify-center px-6"
    >
      <div className="max-w-sm w-full bg-surface border border-border rounded-3xl p-8 text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          Before you head in
        </p>
        <h2 id="age-gate-title" className="font-display text-2xl mb-3">
          Are you 21 or older?
        </h2>
        <p className="text-muted text-sm leading-relaxed mb-6">
          Next Bar is a guide to NYC bars and nightlife. You need to be of
          legal drinking age in the US to use it.
        </p>
        <button
          type="button"
          onClick={acknowledge}
          className="w-full bg-accent hover:bg-accentDim transition-colors text-bg font-display text-lg py-3 rounded-xl min-h-[44px] touch-manipulation"
        >
          I&apos;m 21 or older
        </button>
        <p className="text-muted text-xs leading-relaxed mt-4">
          Under 21? We&apos;ll see you in a few years. Please drink
          responsibly.
        </p>
      </div>
    </div>
  );
}
