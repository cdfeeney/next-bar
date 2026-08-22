'use client';

import { useState } from 'react';
import { useModalDialog } from '@/hooks/useModalDialog';
import { keepOnly, pairKind, replaceSide, swapMain, type Pair } from './pairing';
import { rotateDataUrl } from './useCamera';

/**
 * Approve-or-retake — the HARD GATE. `next-bar-camera-modes.png`: "You review
 * every image. Nothing auto-publishes." Nothing leaves this screen until the
 * approve action is pressed, and Retake discards the shot and reopens the
 * camera rather than keeping a rejected frame around.
 *
 * For a dual shot this screen is also the paired-composition step: swap which
 * half fills the frame, keep only the one on top, or rotate either half. Each
 * edit produces a new pair — the originals are never mutated — and a rotation
 * is baked into the image so every later surface sees what was approved.
 */
export default function CaptureReview({
  pair,
  onChange,
  onRetake,
  onApprove,
  onCancel,
}: {
  pair: Pair;
  onChange: (next: Pair) => void;
  onRetake: () => void;
  onApprove: () => void;
  onCancel: () => void;
}): JSX.Element {
  const [rotating, setRotating] = useState(false);
  const kind = pairKind(pair);
  const ref = useModalDialog<HTMLDivElement>(onCancel);

  const rotate = async (which: 'main' | 'inset'): Promise<void> => {
    const source = which === 'main' ? pair.main : pair.inset;
    if (source === null || rotating) return;
    setRotating(true);
    try {
      onChange(replaceSide(pair, which, await rotateDataUrl(source)));
    } finally {
      setRotating(false);
    }
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Review your capture"
      data-testid="capture-review"
      data-pair-kind={kind}
      tabIndex={-1}
      className="fixed inset-0 z-[1100] bg-bg flex flex-col outline-none"
    >
      <div className="flex items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top)+8px)]">
        <button
          type="button"
          data-testid="capture-review-cancel"
          onClick={onCancel}
          aria-label="Discard and close"
          className="w-11 h-11 -ml-2 flex items-center justify-center rounded-full text-muted touch-manipulation"
        >
          ✕
        </button>
        <span
          data-testid="capture-draft-chip"
          className="ml-auto rounded-2xl border border-border px-3 py-1.5 text-[11px] font-display uppercase tracking-widest text-muted"
        >
          Draft — not shared
        </span>
        <span className="rounded-2xl border border-accent px-3 py-1.5 text-[11px] font-display uppercase tracking-widest text-accent">
          {kind === 'dual' ? 'Front + back' : 'One photo'}
        </span>
      </div>

      <div className="relative flex-1 mt-3 mx-4 rounded-2xl overflow-hidden border border-border bg-surface">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={pair.main}
          alt="Captured photo"
          data-testid="capture-main"
          className="w-full h-full object-cover"
        />
        {pair.inset !== null ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pair.inset}
            alt="Second captured photo"
            data-testid="capture-inset"
            className="absolute bottom-3 right-3 w-28 aspect-[3/4] object-cover rounded-xl border border-border"
          />
        ) : null}
      </div>

      {kind === 'dual' ? (
        <div className="grid grid-cols-2 gap-2 px-4 mt-3">
          <CompositionButton
            testId="capture-swap-main"
            label="Swap main photo"
            onClick={() => onChange(swapMain(pair))}
          />
          <CompositionButton
            testId="capture-keep-one"
            label="Keep only one"
            onClick={() => onChange(keepOnly(pair, 'main'))}
          />
          <CompositionButton
            testId="capture-rotate-main"
            label="Rotate main"
            onClick={() => {
              void rotate('main');
            }}
          />
          <CompositionButton
            testId="capture-rotate-inset"
            label="Rotate inset"
            onClick={() => {
              void rotate('inset');
            }}
          />
        </div>
      ) : null}

      <div className="flex items-center gap-3 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
        <button
          type="button"
          data-testid="capture-retake"
          onClick={onRetake}
          className="flex-1 min-h-[52px] rounded-2xl border border-border font-display text-sm uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
        >
          Retake
        </button>
        <button
          type="button"
          data-testid="capture-approve"
          onClick={onApprove}
          className="flex-1 min-h-[52px] rounded-2xl bg-accent text-bg font-display text-sm uppercase tracking-widest touch-manipulation hover:bg-accentDim transition-colors"
        >
          {kind === 'dual' ? 'Use photos' : 'Use photo'}
        </button>
      </div>
      <p className="text-muted text-[11px] text-center px-8 pb-6 leading-relaxed">
        Retake discards this shot and reopens the camera. Nothing has left your
        phone.
      </p>
    </div>
  );
}

function CompositionButton({
  testId,
  label,
  onClick,
}: {
  testId: string;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="min-h-[44px] rounded-2xl border border-border text-xs font-display uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
    >
      {label}
    </button>
  );
}
