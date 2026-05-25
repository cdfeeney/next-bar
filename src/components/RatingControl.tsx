'use client';

import { useMemo } from 'react';
import type { Rating } from '@/types/ratings';
import { useRatings } from '@/hooks/useRatings';
import { usePairwise } from '@/hooks/usePairwise';
import { bars } from '@/lib/bars';
import PairwiseSheet from '@/components/PairwiseSheet';

type RatingControlProps = {
  barId: string;
};

type RatingOption = {
  rating: Rating;
  label: string;
};

const OPTIONS: RatingOption[] = [
  { rating: 'loved', label: 'Loved' },
  { rating: 'liked', label: 'Liked' },
  { rating: 'pass', label: 'Pass' },
];

const BASE_BUTTON_CLASSES =
  'min-h-[44px] touch-manipulation rounded-full px-3 py-2 font-display text-sm transition-colors';

const UNSELECTED_CLASSES = 'bg-surface border border-border text-text';

function selectedClassesFor(rating: Rating): string {
  switch (rating) {
    case 'loved':
      return 'bg-accent text-bg';
    case 'liked':
      return 'bg-surface border border-accent text-accent';
    case 'pass':
      return 'bg-surface border border-border text-muted line-through';
  }
}

export default function RatingControl({ barId }: RatingControlProps) {
  const { getRating, setRating, clearRating } = useRatings();
  const { pendingPrompt, requestPrompt, addComparison, dismissPrompt } =
    usePairwise();
  const current = getRating(barId);

  // Resolve the prompt's bar pair into actual Bar objects so PairwiseSheet
  // has names + neighborhoods to render. Hook only stores ids to keep the
  // state shape small + serializable.
  const promptForThisBar =
    pendingPrompt && pendingPrompt.justRatedBarId === barId
      ? pendingPrompt
      : null;
  const promptPair = useMemo(() => {
    if (!promptForThisBar) return null;
    const justRated = bars.find((b) => b.id === promptForThisBar.justRatedBarId);
    const peer = bars.find((b) => b.id === promptForThisBar.peerBarId);
    if (!justRated || !peer) return null;
    return { justRated, peer, tier: promptForThisBar.tier };
  }, [promptForThisBar]);

  const handleTap = (rating: Rating) => {
    if (current === rating) {
      clearRating(barId);
      return;
    }
    setRating(barId, rating);
    // requestPrompt is a no-op for 'pass', for signed-in users (server-mode
    // pairwise lands later), and when no same-tier peer exists. The hook
    // gates internally — RatingControl just always asks.
    requestPrompt(barId, rating);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted text-xs uppercase tracking-wider">Been here?</p>
      <div role="group" aria-label="Rate this bar" className="grid grid-cols-3 gap-2">
        {OPTIONS.map((option) => {
          const isSelected = current === option.rating;
          const classes = [
            BASE_BUTTON_CLASSES,
            isSelected ? selectedClassesFor(option.rating) : UNSELECTED_CLASSES,
          ].join(' ');
          return (
            <button
              key={option.rating}
              type="button"
              aria-pressed={isSelected}
              onClick={() => handleTap(option.rating)}
              className={classes}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {promptPair ? (
        <PairwiseSheet
          justRated={promptPair.justRated}
          peer={promptPair.peer}
          tier={promptPair.tier}
          onPick={(winnerBarId, loserBarId) =>
            addComparison(winnerBarId, loserBarId)
          }
          onSkip={dismissPrompt}
        />
      ) : null}
    </div>
  );
}
