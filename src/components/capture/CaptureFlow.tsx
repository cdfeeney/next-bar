'use client';

import { useRef, useState } from 'react';
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

/** Shown when a picked file could not be read as a publishable photo. */
export const LIBRARY_FAILURE =
  'That photo could not be read. Nothing was added — try another one.';

/**
 * "Front + back" has NO explainer step (owner, 2026-09-14): choosing it opens
 * the rear camera at once with a shutter, and the first shot flips the stage
 * to the front camera for the second. The two `CameraStage`s label themselves
 * ("1 of 2 · Outward", "2 of 2 · Selfie"), which is all the telling needed.
 */
export type CaptureStep =
  | 'modes'
  | 'single'
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
  /**
   * Which library pick is the current one. Two decodes can be in flight at
   * once — pick a large image, reopen the picker, pick a small one — and they
   * finish in size order, not pick order, so the older promise could resolve
   * last and replace the newer reviewed image with the one the user had just
   * moved on from. The counter makes a stale decode a no-op instead.
   */
  const pickRef = useRef(0);
  /** Said out loud rather than swallowed: a pick that could not be read. */
  const [pickFailed, setPickFailed] = useState(false);

  const handleFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    // Reset first: re-picking the SAME file must still fire a change event.
    event.target.value = '';
    if (file === undefined) return;
    const pick = ++pickRef.current;
    setPickFailed(false);
    const url = await fileToDataUrl(file);
    // A newer pick started while this one was decoding: it owns the review
    // screen now, and this result is discarded rather than overwriting it.
    if (pick !== pickRef.current) return;
    if (url === null) {
      // fileToDataUrl returns null for a non-image AND for an image that
      // cannot be re-encoded — the re-encode being the only thing that strips
      // EXIF/GPS on this path, a photo that will not go through it is not
      // published. Silently returning made that look like a dead button.
      setPickFailed(true);
      return;
    }
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
          failure={pickFailed ? LIBRARY_FAILURE : null}
          onSingle={() => setStep('single')}
          onDual={() => setStep('dual-outward')}
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

