'use client';

import { useModalDialog } from '@/hooks/useModalDialog';

/**
 * The capture mode chooser — `next-bar-camera-modes.png`, "two camera modes,
 * library as the quieter third row". Add to Story reuses it unchanged and
 * only renames the sheet title; there is no second chooser.
 *
 * The footer line is the promise the rest of the pipeline keeps: nothing is
 * shared until it has been reviewed and given an audience.
 */
export default function CaptureModeSheet({
  title,
  subtitle,
  onSingle,
  onDual,
  onLibrary,
  onCancel,
  failure = null,
}: {
  /** A library pick that could not be read, said on the screen that offered it. */
  failure?: string | null;
  title: string;
  subtitle: string;
  onSingle: () => void;
  onDual: () => void;
  /** Opens the picker the flow owns — there is one file input, not two. */
  onLibrary: () => void;
  onCancel: () => void;
}): JSX.Element {
  const ref = useModalDialog<HTMLDivElement>(onCancel);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="capture-modes"
      tabIndex={-1}
      className="fixed inset-0 z-[1100] bg-bg flex flex-col justify-end outline-none"
    >
      <div className="rounded-t-3xl border-t border-border bg-surface px-5 pt-5 pb-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl">{title}</h2>
            <p className="text-muted text-sm mt-1">{subtitle}</p>
          </div>
          <button
            type="button"
            data-testid="capture-cancel"
            onClick={onCancel}
            aria-label="Close capture"
            className="w-11 h-11 -mr-2 -mt-1 shrink-0 flex items-center justify-center rounded-full text-muted touch-manipulation"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <ModeRow
            testId="capture-mode-single"
            icon="camera"
            label="Take one photo"
            hint="One fresh shot — rear or front camera."
            onClick={onSingle}
          />
          <ModeRow
            testId="capture-mode-dual"
            icon="frames"
            label="Front + back"
            hint="Two shots, paired: the room and you."
            onClick={onDual}
          />
          <ModeRow
            testId="capture-mode-library"
            icon="picture"
            label="Choose from library"
            hint="Use a photo you already have."
            onClick={onLibrary}
          />
        </div>

        {failure !== null ? (
          <p
            data-testid="capture-library-failed"
            role="alert"
            className="text-sm text-center mt-4 leading-relaxed"
          >
            {failure}
          </p>
        ) : null}

        <p className="text-muted text-[11px] text-center mt-5 leading-relaxed">
          Nothing is shared until you review it and pick an audience.
        </p>
      </div>
    </div>
  );
}

type ModeIcon = 'camera' | 'frames' | 'picture';

/**
 * README §9.1: a 40px accent-tinted tile holding a 21px STROKED icon — a
 * camera, two paired frames, a picture. Inline so the sheet ships no asset and
 * the stroke takes the accent token through `currentColor`.
 */
function ModeGlyph({ icon }: { icon: ModeIcon }): JSX.Element {
  const common = {
    width: 21,
    height: 21,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (icon === 'camera') {
    return (
      <svg {...common}>
        <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.4-2h5.2L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" />
        <circle cx="12" cy="13" r="3.25" />
      </svg>
    );
  }
  if (icon === 'frames') {
    return (
      <svg {...common}>
        <rect x="3.5" y="6.5" width="11" height="13" rx="1.5" />
        <rect x="9.5" y="4" width="11" height="13" rx="1.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M20 15.5 15.5 11 8 18.5" />
    </svg>
  );
}

function ModeRow({
  testId,
  icon,
  label,
  hint,
  onClick,
}: {
  testId: string;
  icon: ModeIcon;
  label: string;
  hint: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="w-full flex items-center gap-3 min-h-[64px] px-4 rounded-2xl border border-border bg-bg text-left touch-manipulation hover:border-accent transition-colors"
    >
      <span
        aria-hidden="true"
        className="w-10 h-10 shrink-0 rounded-xl bg-accent/10 text-accent flex items-center justify-center"
      >
        <ModeGlyph icon={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        <span className="block text-muted text-[11px] truncate">{hint}</span>
      </span>
      <span aria-hidden="true" className="text-muted">
        ›
      </span>
    </button>
  );
}
