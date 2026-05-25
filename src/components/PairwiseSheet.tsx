'use client';

import { useEffect, useRef } from 'react';
import type { Bar } from '@/types';
import type { Rating } from '@/types/ratings';

const TIER_LABEL: Record<Rating, string> = {
  loved: 'Loved',
  liked: 'Liked',
  pass: 'Pass',
};

type PairwiseSheetProps = {
  /** The bar the user just rated, prompting this comparison. */
  justRated: Bar;
  /** A previously-rated peer in the same tier. */
  peer: Bar;
  /** The tier both bars sit in — drives the prompt copy. */
  tier: Rating;
  /**
   * Called with the bar the user picked as preferred. The other bar is the
   * loser. The host is expected to insert one PairwiseComparison and close
   * the sheet.
   */
  onPick: (winnerBarId: string, loserBarId: string) => void;
  /** Skip this comparison; no comparison is recorded. */
  onSkip: () => void;
};

const PROMPT_BY_TIER: Record<Rating, string> = {
  loved: 'Which did you love more?',
  liked: 'Which did you like more?',
  pass: 'Which did you like more?',
};

/**
 * Modal "A vs B" sheet shown after a Loved/Liked rating per PRD §D3(c) —
 * one inline prompt per rating, skippable, never modal-stacked. The
 * caller is responsible for deciding whether to mount this (i.e. whether
 * `pickComparisonTarget` returned a peer); this component just renders
 * the chrome and dispatches the pick.
 *
 * Accessibility:
 *   - role="dialog" + aria-modal="true" + aria-labelledby on the heading
 *   - focus moves to the first pick button on mount
 *   - Escape key triggers onSkip (matches "tap outside to dismiss" UX)
 *   - body scroll is locked while the sheet is open
 *   - all interactive elements meet the 44px tap target rule
 *
 * The sheet is intentionally not portal'd — it sits inline in its host
 * tree because Next.js client components have no app-level portal root
 * yet. The fixed positioning is enough to cover the viewport on mobile.
 */
export default function PairwiseSheet({
  justRated,
  peer,
  tier,
  onPick,
  onSkip,
}: PairwiseSheetProps): JSX.Element {
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    firstButtonRef.current?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onSkip();
      }
    }
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onSkip]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pairwise-prompt"
      className="fixed inset-0 z-50 flex flex-col bg-bg/95 backdrop-blur-sm overscroll-contain"
    >
      <div
        className="absolute inset-0"
        aria-hidden="true"
        onClick={onSkip}
      />

      <div className="relative flex flex-1 flex-col max-w-md w-full mx-auto px-6 pt-12 pb-8 gap-6">
        <header className="text-center">
          <p className="text-accent uppercase tracking-[0.25em] text-xs mb-2">
            Tier · {TIER_LABEL[tier]}
          </p>
          <h2
            id="pairwise-prompt"
            className="font-display text-3xl md:text-4xl leading-tight"
          >
            {PROMPT_BY_TIER[tier]}
          </h2>
          <p className="text-muted text-sm mt-2">
            Helps your rankings refine over time. Skip if it&apos;s a toss-up.
          </p>
        </header>

        <div className="flex-1 flex flex-col gap-4 justify-center">
          <PickButton
            innerRef={firstButtonRef}
            bar={justRated}
            onClick={() => onPick(justRated.id, peer.id)}
            accent
          />
          <div className="text-center font-display text-muted text-sm tracking-widest">
            vs
          </div>
          <PickButton
            bar={peer}
            onClick={() => onPick(peer.id, justRated.id)}
          />
        </div>

        <button
          type="button"
          onClick={onSkip}
          className="text-muted text-sm underline-offset-4 hover:underline self-center min-h-[44px] touch-manipulation"
        >
          Skip — it&apos;s a tie
        </button>
      </div>
    </div>
  );
}

type PickButtonProps = {
  bar: Bar;
  onClick: () => void;
  accent?: boolean;
  /**
   * Plain prop (not React's reserved `ref`) so the parent can pass a ref
   * without us needing React.forwardRef. React 18 ignores `ref` on
   * function components; this is the simpler alternative.
   */
  innerRef?: React.Ref<HTMLButtonElement>;
};

function PickButton({ bar, onClick, accent, innerRef }: PickButtonProps): JSX.Element {
  return (
    <button
      ref={innerRef}
      type="button"
      onClick={onClick}
      className={[
        'w-full text-left rounded-3xl p-5 border transition-colors',
        'min-h-[44px] touch-manipulation',
        accent
          ? 'bg-surface border-accent hover:bg-accent hover:text-bg focus:bg-accent focus:text-bg'
          : 'bg-surface border-border hover:border-accent focus:border-accent',
      ].join(' ')}
    >
      <p className="font-display text-2xl leading-tight">{bar.name}</p>
      <p className="text-muted text-xs uppercase tracking-wider mt-1">
        {bar.neighborhood} · {'$'.repeat(bar.priceTier)}
      </p>
      <p className="text-sm italic mt-2 line-clamp-2">{bar.blurb}</p>
    </button>
  );
}
