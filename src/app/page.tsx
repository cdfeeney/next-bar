'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import WhereNextFlow from '@/components/WhereNextFlow';
import PhaseChip from '@/components/PhaseChip';
import RecapCard from '@/components/RecapCard';
import { loadProfile } from '@/lib/storedProfile';
import { deriveNightPhase, type NightPhase } from '@/lib/nightPhase';
import { loadIntent, wasOutLastNight } from '@/lib/intent';
import { loadPhaseOverride, savePhaseOverride } from '@/lib/phaseOverride';
import { assembleNight, lastNightKey, loadNightVisits } from '@/lib/nightLog';
import { composeRecap, type Recap } from '@/lib/recap';
import { useBars } from '@/lib/useBars';
import { useNightRefresh } from '@/hooks/useIntent';

export default function HomePage() {
  // MED-26: `/` never prompted the quiz — profile-less visitors got the
  // location flow with generic (vibe-less) suggestions and no hint that a
  // 60-second quiz personalizes everything. localStorage read must wait
  // for mount (SSR has no storage); until then render nothing extra.
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  useEffect(() => {
    setHasProfile(loadProfile() !== null);
  }, []);

  // E2.4/E3.4 phase-adaptive home (EPICS-v0.6, locked decision 1: content
  // adapts, the 5-tab nav never does). Derived on mount — SSR has neither
  // storage nor a clock worth trusting; until then the default flow
  // renders, which IS the fail-safe 'starting' content (R10). The chip's
  // choice persists for the night (R11) via phaseOverride, and the
  // storage listener keeps the phase honest when intent changes in
  // another tab.
  const [phase, setPhase] = useState<NightPhase | null>(null);
  // The recap composes for THIS key — state (not read at render) so a
  // rollover in a long-lived tab re-keys the effect even when the phase
  // string lands on 'recap' again (review HIGH: same-value deps bail).
  const [recapNightKey, setRecapNightKey] = useState<string | null>(null);
  const computePhase = useCallback(() => {
    const now = new Date();
    setPhase(
      deriveNightPhase({
        now,
        intent: loadIntent()?.status ?? null,
        // E4.2: the night log is the stronger was-out signal — visits
        // recorded last night derive recap even when no intent was set
        // (most solo users never touch intent).
        wasOutLastNight:
          wasOutLastNight(now) || loadNightVisits(lastNightKey(now)).length > 0,
        override: loadPhaseOverride(now),
      }),
    );
    setRecapNightKey(lastNightKey(now));
  }, []);
  // Mount + storage events + the shared "clock moved" signal — without
  // the night refresh an idle tab never re-derives across the 6am
  // rollover (the same F5 class useNightRefresh exists for).
  useNightRefresh(computePhase);
  useEffect(() => {
    window.addEventListener('storage', computePhase);
    return () => window.removeEventListener('storage', computePhase);
  }, [computePhase]);

  // E4.2/E4.5: last night's recap, composed with zero input. Null → the
  // plain rank-last-night card keeps the slot.
  const bars = useBars();
  const [recap, setRecap] = useState<Recap | null>(null);
  useEffect(() => {
    if (phase !== 'recap' || !recapNightKey) {
      setRecap(null);
      return;
    }
    setRecap(composeRecap(assembleNight(recapNightKey), bars));
  }, [phase, recapNightKey, bars]);

  const selectPhase = (p: NightPhase) => {
    savePhaseOverride(p);
    setPhase(p);
  };

  // Planning/recap LEAD with their card but keep the find-a-bar flow on
  // the screen below it: a misdetected phase (or a planner who changes
  // their mind) never loses the app's core surface (R5 — no dead ends;
  // this is the fail-safe half of R10). 'starting' and 'out' ARE the
  // flow — out's re-search entry pre-fills tonight's cached vibe via
  // startResultsFrom (E2.2).
  return (
    <main>
      {/* flex-wrap: with three items the row overflows ~320-360px
          viewports — the chip+link pair wraps under the wordmark there
          instead of breaking the wordmark itself (review finding). */}
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border">
        <p className="font-display text-accent text-sm uppercase tracking-[0.3em] whitespace-nowrap">
          Next Bar
        </p>
        <div className="flex items-center gap-3">
          {phase ? <PhaseChip phase={phase} onSelect={selectPhase} /> : null}
          <Link
            href="/install"
            className="text-muted hover:text-text underline-offset-4 hover:underline text-sm min-h-[44px] inline-flex items-center touch-manipulation"
          >
            Get the app →
          </Link>
        </div>
      </header>
      {/* Operator 2026-07-26: the quiz nudge is gone — this slot teases
          the APP instead (the quiz still lives at /quiz and /install). */}
      {hasProfile === false ? (
        <div className="px-6 pt-4">
          <Link
            href="/install"
            className="block max-w-md mx-auto bg-surface border border-accent/40 rounded-2xl px-5 py-3 touch-manipulation hover:border-accent transition-colors"
          >
            <p className="font-display text-sm">
              Next Bar, on your phone →
            </p>
          </Link>
        </div>
      ) : null}
      {phase === 'planning' ? (
        <div className="px-6 pt-4" data-testid="phase-card-planning">
          <div className="max-w-md mx-auto bg-surface border border-border rounded-2xl px-5 py-4">
            <p className="font-display text-sm mb-1">Making a plan tonight?</p>
            <p className="text-muted text-xs leading-relaxed mb-3">
              Suggest bars, see what your circle wants, and lock tonight in
              together.
            </p>
            <Link
              href="/friends/consensus"
              className="inline-flex items-center min-h-[56px] px-6 rounded-full border border-accent text-accent font-display text-sm touch-manipulation hover:bg-accent hover:text-bg transition-colors"
            >
              Plan tonight →
            </Link>
          </div>
        </div>
      ) : null}
      {phase === 'recap' ? (
        <div className="px-6 pt-4" data-testid="phase-card-recap">
          {recap ? (
            // E4.2: the real thing — last night's route, auto-composed.
            <RecapCard recap={recap} />
          ) : (
            // No captured night (or catalog can't resolve it): the plain
            // rank-last-night nudge keeps the slot.
            <div className="max-w-md mx-auto bg-surface border border-border rounded-2xl px-5 py-4">
              <p className="font-display text-sm mb-1">Out last night?</p>
              <p className="text-muted text-xs leading-relaxed mb-3">
                Rank the bars while you still remember them.
              </p>
              <Link
                href="/rankings"
                className="inline-flex items-center min-h-[56px] px-6 rounded-full border border-accent text-accent font-display text-sm touch-manipulation hover:bg-accent hover:text-bg transition-colors"
              >
                Rank last night →
              </Link>
            </div>
          )}
        </div>
      ) : null}
      <WhereNextFlow />
    </main>
  );
}
