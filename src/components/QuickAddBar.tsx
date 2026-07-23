'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Bar } from '@/types';
import type { Rating } from '@/types/ratings';
import { useRatings } from '@/hooks/useRatings';
import { usePairwise } from '@/hooks/usePairwise';
import { getBarById } from '@/lib/catalog';
import BarPicker from '@/components/BarPicker';
import PairwiseSheet from '@/components/PairwiseSheet';

type Stage = 'idle' | 'pick-bar' | 'pick-tier';

type TierOption = {
  rating: Rating;
  label: string;
  hint: string;
};

const TIER_OPTIONS: TierOption[] = [
  { rating: 'loved', label: 'Loved', hint: 'One of my favorites' },
  { rating: 'liked', label: 'Liked', hint: 'Solid — would go back' },
  { rating: 'pass', label: 'Pass', hint: 'Not for me' },
];

const TIER_BUTTON_CLASSES: Record<Rating, string> = {
  loved: 'border-accent bg-accent text-bg',
  liked: 'border-accent text-accent bg-surface',
  pass: 'border-border text-muted bg-surface',
};

/**
 * B4 quick-add flow on /rankings: "+ Add a bar" → BarPicker search →
 * tier pick → the pairwise comparison CHAIN (binary insert) runs via
 * usePairwise + PairwiseSheet. Works identically anonymous and signed-in —
 * the hook owns both persistence paths.
 *
 * Mount exactly ONE instance per page (the /rankings header xor its empty
 * state) — each instance owns its own usePairwise prompt state.
 */
export default function QuickAddBar(): JSX.Element {
  const [stage, setStage] = useState<Stage>('idle');
  const [selectedBar, setSelectedBar] = useState<Bar | null>(null);
  const { setRating } = useRatings();
  const {
    pendingPrompt,
    requestPrompt,
    addComparison,
    dismissPrompt,
    sessionProgress,
  } = usePairwise();

  const isModalOpen = stage !== 'idle';

  // Escape closes the picker modal (parity with PairwiseSheet). Body
  // scroll-lock also matches the sheet so the rankings list doesn't
  // scroll behind the overlay.
  useEffect(() => {
    if (!isModalOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        setStage('idle');
        setSelectedBar(null);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isModalOpen]);

  // Resolve the pending prompt's ids into Bar objects for PairwiseSheet —
  // same pattern as RatingControl.
  const promptPair = useMemo(() => {
    if (!pendingPrompt) return null;
    const justRated = getBarById(pendingPrompt.justRatedBarId);
    const peer = getBarById(pendingPrompt.peerBarId);
    if (!justRated || !peer) return null;
    return { justRated, peer, tier: pendingPrompt.tier };
  }, [pendingPrompt]);

  const handlePick = (bar: Bar): void => {
    setSelectedBar(bar);
    setStage('pick-tier');
  };

  const handleTier = (rating: Rating): void => {
    if (!selectedBar) return;
    // setRating writes through the localStorage cache synchronously in
    // both modes, so requestPrompt's loadRatings() sees the new bar.
    setRating(selectedBar.id, rating);
    requestPrompt(selectedBar.id, rating);
    setStage('idle');
    setSelectedBar(null);
  };

  const closeModal = (): void => {
    setStage('idle');
    setSelectedBar(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setStage('pick-bar')}
        className="bg-surface border border-accent text-accent rounded-full px-5 py-2 min-h-[44px] touch-manipulation font-display text-sm inline-flex items-center justify-center hover:bg-accent hover:text-bg transition-colors"
      >
        + Add a bar
      </button>

      {isModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add a bar"
          className="fixed inset-0 z-[1100] flex flex-col bg-bg/95 backdrop-blur-sm overscroll-contain"
        >
          <div className="relative flex flex-1 flex-col max-w-2xl w-full mx-auto px-6 pt-8 pb-8 min-h-0">
            <header className="flex items-center justify-between gap-3 mb-4">
              <h2 className="font-display text-2xl leading-tight">
                {stage === 'pick-bar'
                  ? 'Add a bar'
                  : `How was ${selectedBar?.name ?? 'it'}?`}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation shrink-0"
              >
                Close
              </button>
            </header>

            {stage === 'pick-bar' ? (
              <div className="flex-1 overflow-y-auto min-h-0">
                <BarPicker onPick={handlePick} />
              </div>
            ) : (
              <div className="flex flex-col gap-3 pt-4">
                {TIER_OPTIONS.map((option) => (
                  <button
                    key={option.rating}
                    type="button"
                    onClick={() => handleTier(option.rating)}
                    className={[
                      'w-full text-left rounded-3xl p-5 border transition-colors',
                      'min-h-[44px] touch-manipulation',
                      TIER_BUTTON_CLASSES[option.rating],
                    ].join(' ')}
                  >
                    <p className="font-display text-xl leading-tight">
                      {option.label}
                    </p>
                    <p className="text-xs mt-1 opacity-80">{option.hint}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {promptPair ? (
        <PairwiseSheet
          justRated={promptPair.justRated}
          peer={promptPair.peer}
          tier={promptPair.tier}
          onPick={(winnerBarId, loserBarId) =>
            addComparison(winnerBarId, loserBarId)
          }
          onSkip={dismissPrompt}
          progress={sessionProgress ?? undefined}
        />
      ) : null}
    </>
  );
}
