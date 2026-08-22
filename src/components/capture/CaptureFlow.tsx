'use client';

import { useRef, useState } from 'react';
import { useModalDialog } from '@/hooks/useModalDialog';
import CameraStage from './CameraStage';
import CaptureModeSheet from './CaptureModeSheet';
import CaptureReview from './CaptureReview';
import { fileToDataUrl } from './useCamera';
import type { Pair } from './pairing';

/**
 * The capture pipeline, end to end: mode chooser → live preview → the
 * approve-or-retake gate (which is also the paired-composition step for a
 * dual shot). `next-bar-camera-modes.png` is the source for every screen and
 * every rule here.
 *
 * There is exactly ONE of these in the app. Add to Story mounts it with a
 * different sheet title and nothing else changed — no parallel camera, no
 * second review gate.
 *
 * What the caller gets back is an APPROVED pair, never a raw frame: the flow
 * has no path from the shutter to `onApproved` that skips review.
 */

export type CaptureStep =
  | 'modes'
  | 'single'
  | 'dual-explain'
  | 'dual-outward'
  | 'dual-selfie'
  | 'review';

export default function CaptureFlow({
  title,
  subtitle,
  onCancel,
  onApproved,
}: {
  title: string;
  subtitle: string;
  onCancel: () => void;
  onApproved: (pair: Pair) => void;
}): JSX.Element {
  const [step, setStep] = useState<CaptureStep>('modes');
  const [outward, setOutward] = useState<string | null>(null);
  const [pair, setPair] = useState<Pair | null>(null);
  // The single-photo mode's own copy says "rear or front camera", so it has to
  // BE switchable: it was pinned to `environment` with no control anywhere, so
  // the chooser promised a side the pipeline could not take. The dual shot is
  // deliberately not switchable — its two steps name their own cameras.
  const [singleFacing, setSingleFacing] = useState<'environment' | 'user'>(
    'environment',
  );
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    // Reset first: re-picking the SAME file must still fire a change event.
    event.target.value = '';
    if (file === undefined) return;
    const url = await fileToDataUrl(file);
    if (url === null) return;
    // A library photo takes the same review gate as a fresh capture.
    setPair({ main: url, inset: null });
    setStep('review');
  };

  const retake = (): void => {
    // Retake DISCARDS — the rejected frames are dropped here, not carried
    // forward, so nothing rejected can reach the compose screen.
    setPair(null);
    setOutward(null);
    setStep('modes');
  };

  return (
    <>
      <input
        ref={fileRef}
        data-testid="capture-library-input"
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          void handleFile(event);
        }}
      />

      {step === 'modes' ? (
        <CaptureModeSheet
          title={title}
          subtitle={subtitle}
          onSingle={() => setStep('single')}
          onDual={() => setStep('dual-explain')}
          onLibrary={() => fileRef.current?.click()}
          onCancel={onCancel}
        />
      ) : null}

      {step === 'single' ? (
        <CameraStage
          facing={singleFacing}
          stepLabel={null}
          onCancel={onCancel}
          onFlip={() =>
            setSingleFacing((current) =>
              current === 'environment' ? 'user' : 'environment',
            )
          }
          onUseLibrary={() => fileRef.current?.click()}
          onFrame={(url) => {
            setPair({ main: url, inset: null });
            setStep('review');
          }}
        />
      ) : null}

      {step === 'dual-explain' ? (
        <DualExplainer
          onStart={() => setStep('dual-outward')}
          onSingleInstead={() => setStep('single')}
          onCancel={onCancel}
        />
      ) : null}

      {step === 'dual-outward' ? (
        <CameraStage
          facing="environment"
          stepLabel="1 of 2 · Outward"
          onCancel={onCancel}
          onUseLibrary={() => fileRef.current?.click()}
          onFrame={(url) => {
            setOutward(url);
            setStep('dual-selfie');
          }}
        />
      ) : null}

      {step === 'dual-selfie' ? (
        <CameraStage
          facing="user"
          stepLabel="2 of 2 · Selfie"
          onCancel={onCancel}
          onUseLibrary={() => fileRef.current?.click()}
          onFrame={(url) => {
            setPair({ main: outward ?? url, inset: outward === null ? null : url });
            setStep('review');
          }}
        />
      ) : null}

      {step === 'review' && pair !== null ? (
        <CaptureReview
          pair={pair}
          onChange={setPair}
          onRetake={retake}
          onApprove={() => onApproved(pair)}
          onCancel={onCancel}
        />
      ) : null}
    </>
  );
}

/**
 * "Explain first" — the dual-shot mode says what the two counted steps are
 * before the camera opens, because the user has to know a second shot is
 * coming before the first one is taken.
 *
 * The third line describes exactly the three composition edits this pipeline
 * has (swap main, keep only one, rotate either) plus the one Retake it has.
 * It used to promise "retake either one", a per-side recapture that the
 * locked composition set does not include and `retake()` — which discards
 * BOTH frames by design, so nothing rejected survives — never offered.
 */
function DualExplainer({
  onStart,
  onSingleInstead,
  onCancel,
}: {
  onStart: () => void;
  onSingleInstead: () => void;
  onCancel: () => void;
}): JSX.Element {
  const steps = [
    ['Outward photo', 'The room, the bar, the drink — rear camera.'],
    ['Selfie', 'Front camera, taken right after.'],
    ['You approve both', 'Swap, rotate, keep only one — or retake both.'],
  ] as const;
  const ref = useModalDialog<HTMLDivElement>(onCancel);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Front + back"
      data-testid="capture-dual-explainer"
      tabIndex={-1}
      className="fixed inset-0 z-[1100] bg-bg flex flex-col px-6 pt-[calc(env(safe-area-inset-top)+16px)] outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-xl">Front + back</h2>
        <button
          type="button"
          data-testid="capture-dual-cancel"
          onClick={onCancel}
          aria-label="Close capture"
          className="w-11 h-11 -mr-2 -mt-1 shrink-0 flex items-center justify-center rounded-full text-muted touch-manipulation"
        >
          ✕
        </button>
      </div>
      <p className="text-muted text-sm mt-1">
        Two shots, paired. You approve both before anything is shared.
      </p>

      <ol className="mt-6 space-y-3">
        {steps.map(([label, hint], index) => (
          <li
            key={label}
            className="flex items-start gap-3 rounded-2xl border border-border bg-surface px-4 py-3"
          >
            <span
              aria-hidden="true"
              className="w-6 h-6 shrink-0 rounded-full bg-accent text-bg flex items-center justify-center text-xs font-display"
            >
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-sm">{label}</span>
              <span className="block text-muted text-[11px]">{hint}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-auto pb-[calc(env(safe-area-inset-bottom)+24px)] space-y-3">
        <button
          type="button"
          data-testid="capture-dual-start"
          onClick={onStart}
          className="w-full min-h-[52px] rounded-2xl bg-accent text-bg font-display text-sm uppercase tracking-widest touch-manipulation hover:bg-accentDim transition-colors"
        >
          Start — outward photo first
        </button>
        <button
          type="button"
          data-testid="capture-dual-single-instead"
          onClick={onSingleInstead}
          className="w-full min-h-[52px] rounded-2xl border border-border font-display text-sm uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
        >
          Take one photo instead
        </button>
      </div>
    </div>
  );
}
