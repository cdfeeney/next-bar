'use client';

import { useEffect, useRef, useState } from 'react';
import type { Bar } from '@/types';
import type { Rating } from '@/types/ratings';
import { useRatings } from '@/hooks/useRatings';
import { getBarById } from '@/lib/catalog';
import BarPicker from '@/components/BarPicker';

type Stage = 'idle' | 'pick-bar' | 'pick-score';

function ratingForScore(score: number): Rating {
  if (score >= 8) return 'loved';
  if (score >= 5) return 'liked';
  return 'pass';
}

/** Numeric-first ranking: pick a bar, then enter its exact 0-10 score. */
export default function QuickAddBar({
  initialBarId,
  onInitialConsumed,
}: {
  initialBarId?: string;
  onInitialConsumed?: () => void;
} = {}): JSX.Element {
  const [stage, setStage] = useState<Stage>('idle');
  const [selectedBar, setSelectedBar] = useState<Bar | null>(null);
  const [score, setScore] = useState('');
  const consumedInitialRef = useRef(false);
  const { setRating } = useRatings();

  useEffect(() => {
    if (!initialBarId || consumedInitialRef.current) return;
    consumedInitialRef.current = true;
    onInitialConsumed?.();
    const bar = getBarById(initialBarId);
    if (!bar) return;
    setSelectedBar(bar);
    setStage('pick-score');
  }, [initialBarId, onInitialConsumed]);

  const isModalOpen = stage !== 'idle';

  const closeModal = (): void => {
    setStage('idle');
    setSelectedBar(null);
    setScore('');
  };

  useEffect(() => {
    if (!isModalOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isModalOpen]);

  const saveScore = (): void => {
    if (!selectedBar) return;
    const parsed = Number(score);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) return;
    const rounded = Math.round(parsed * 10) / 10;
    setRating(selectedBar.id, ratingForScore(rounded), rounded);
    closeModal();
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
                  : `Score ${selectedBar?.name ?? 'this bar'}`}
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
                <BarPicker
                  onPick={(bar) => {
                    setSelectedBar(bar);
                    setStage('pick-score');
                  }}
                />
              </div>
            ) : (
              <form
                className="flex flex-col gap-4 pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveScore();
                }}
              >
                <label htmlFor="bar-score" className="font-display text-sm">
                  Your score
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id="bar-score"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="10"
                    step="0.1"
                    required
                    autoFocus
                    value={score}
                    onChange={(event) => setScore(event.target.value)}
                    placeholder="9.3"
                    className="min-w-0 flex-1 bg-surface border border-border rounded-2xl px-4 py-3 text-2xl font-display tabular-nums focus:border-accent outline-none"
                  />
                  <span className="text-muted font-display">/ 10</span>
                </div>
                <p className="text-xs text-muted">
                  Use one decimal if you want. Ties are allowed.
                </p>
                <button
                  type="submit"
                  className="w-full rounded-full bg-accent px-5 py-3 min-h-[44px] font-display text-bg touch-manipulation"
                >
                  Save score
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
