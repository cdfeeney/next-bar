'use client';

import { useModalDialog } from '@/hooks/useModalDialog';
import { useCamera, type CameraFacing } from './useCamera';

/**
 * The live viewfinder and the shutter — one screen, used for the single
 * photo and for each half of the dual shot. `next-bar-camera-modes.png`:
 * "Nothing is captured on entry. Only the shutter creates an image."
 *
 * The three non-live statuses are rendered, not thrown: a denied permission
 * and a device with no camera both leave the library row as a working way
 * forward, which is why this component never dead-ends on either.
 */
export default function CameraStage({
  facing,
  stepLabel,
  onCancel,
  onFrame,
  onUseLibrary,
}: {
  facing: CameraFacing;
  /** "1 of 2 · Outward" — absent on the single-photo path. */
  stepLabel: string | null;
  onCancel: () => void;
  onFrame: (dataUrl: string) => void;
  onUseLibrary: () => void;
}): JSX.Element {
  const camera = useCamera(facing, true);
  const live = camera.status === 'live';
  const ref = useModalDialog<HTMLDivElement>(onCancel);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Camera"
      data-testid="camera-stage"
      data-camera-status={camera.status}
      tabIndex={-1}
      className="fixed inset-0 z-[1100] bg-bg flex flex-col outline-none"
    >
      <div className="flex items-center gap-3 px-4 pt-[calc(env(safe-area-inset-top)+8px)]">
        <button
          type="button"
          data-testid="camera-cancel"
          onClick={onCancel}
          aria-label="Close camera"
          className="w-11 h-11 -ml-2 flex items-center justify-center rounded-full text-muted touch-manipulation"
        >
          ✕
        </button>
        <span className="flex-1" />
        {stepLabel !== null ? (
          <span
            data-testid="camera-step"
            className="rounded-2xl border border-accent px-3 py-1.5 text-[11px] font-display uppercase tracking-widest text-accent"
          >
            {stepLabel}
          </span>
        ) : null}
      </div>

      <div className="relative flex-1 mt-3 mx-4 rounded-2xl overflow-hidden border border-border bg-surface">
        <video
          ref={camera.videoRef}
          data-testid="camera-preview"
          playsInline
          muted
          className="w-full h-full object-cover"
        />
        {live ? null : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <p data-testid="camera-notice" className="text-sm leading-relaxed">
              {noticeFor(camera.status)}
            </p>
            <div className="flex items-center gap-2">
              {camera.status === 'denied' || camera.status === 'unavailable' ? (
                <button
                  type="button"
                  data-testid="camera-retry"
                  onClick={camera.retry}
                  className="min-h-[44px] px-4 rounded-2xl border border-border text-xs font-display uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
                >
                  Try again
                </button>
              ) : null}
              <button
                type="button"
                data-testid="camera-use-library"
                onClick={onUseLibrary}
                className="min-h-[44px] px-4 rounded-2xl border border-border text-xs font-display uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
              >
                Choose from library
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center justify-center py-6 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <button
          type="button"
          data-testid="camera-shutter"
          aria-label="Take photo"
          aria-disabled={live ? undefined : 'true'}
          onClick={() => {
            if (!live) return;
            const frame = camera.capture();
            if (frame !== null) onFrame(frame);
          }}
          className={[
            'w-[72px] h-[72px] rounded-full border-4 border-text touch-manipulation',
            live ? 'bg-accent' : 'bg-border',
          ].join(' ')}
        />
      </div>
    </div>
  );
}

function noticeFor(status: string): string {
  if (status === 'denied') {
    return 'Camera access is off for Next Bar. Turn it on in your browser settings, or use a photo you already have.';
  }
  if (status === 'unavailable') {
    return 'No camera is available on this device. You can still use a photo you already have.';
  }
  return 'Starting the camera…';
}
