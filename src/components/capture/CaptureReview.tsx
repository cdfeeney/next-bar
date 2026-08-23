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

      {/* Every composition edit and the approve action are held while a
          rotation is decoding. `rotate` closes over the pair it started with,
          so a swap or a second edit accepted mid-flight was overwritten when
          the stale rotation resolved — and approving mid-flight submitted the
          PRE-rotation pair, i.e. a composition the user had already changed.
          aria-disabled, not `disabled`: these can hold focus (BarLightbox.tsx:322). */}
      {kind === 'dual' ? (
        <div className="grid grid-cols-2 gap-2 px-4 mt-3">
          <CompositionButton
            testId="capture-swap-main"
            label="Swap main photo"
            busy={rotating}
            onClick={() => onChange(swapMain(pair))}
          />
          <CompositionButton
            testId="capture-keep-one"
            label="Keep only one"
            busy={rotating}
            onClick={() => onChange(keepOnly(pair, 'main'))}
          />
          <CompositionButton
            testId="capture-rotate-main"
            label="Rotate main"
            busy={rotating}
            onClick={() => {
              void rotate('main');
            }}
          />
          <CompositionButton
            testId="capture-rotate-inset"
            label="Rotate inset"
            busy={rotating}
            onClick={() => {
              void rotate('inset');
            }}
          />
        </div>
      ) : null}

      <div className="flex items-center gap-3 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
        {/* Retake is held during a decode for the same reason approve is: it
            discards and reopens the camera, and the in-flight rotation would
            then resolve and call onChange with its closed-over OLD pair,
            planting the rejected composition back over the replacement. */}
        <button
          type="button"
          data-testid="capture-retake"
          onClick={() => {
            if (rotating) return;
            onRetake();
          }}
          aria-disabled={rotating}
          className="flex-1 min-h-[52px] rounded-2xl border border-border font-display text-sm uppercase tracking-widest touch-manipulation hover:border-accent transition-colors aria-disabled:opacity-40"
        >
          Retake
        </button>
        <button
          type="button"
          data-testid="capture-approve"
          onClick={() => {
            if (rotating) return;
            onApprove();
          }}
          aria-disabled={rotating}
          className="flex-1 min-h-[52px] rounded-2xl bg-accent text-bg font-display text-sm uppercase tracking-widest touch-manipulation hover:bg-accentDim transition-colors aria-disabled:opacity-40"
        >
          {kind === 'dual' ? 'Use photos' : 'Use photo'}
        </button>
      </div>
      <p className="text-muted text-[11px] text-center px-8 pb-6 leading-relaxed">
        Retake discards this shot and reopens the capture options. Nothing has
        left your phone.
      </p>
    </div>
  );
}

function CompositionButton({
  testId,
  label,
  busy = false,
  onClick,
}: {
  testId: string;
  label: string;
  /** Held while a rotation is decoding — see the block comment above. */
  busy?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => {
        if (busy) return;
        onClick();
      }}
      aria-disabled={busy}
      className="min-h-[44px] rounded-2xl border border-border text-xs font-display uppercase tracking-widest touch-manipulation hover:border-accent transition-colors aria-disabled:opacity-40"
    >
      {label}
    </button>
  );
}
