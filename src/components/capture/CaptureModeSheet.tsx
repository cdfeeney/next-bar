'use client';

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
}: {
  title: string;
  subtitle: string;
  onSingle: () => void;
  onDual: () => void;
  /** Opens the picker the flow owns — there is one file input, not two. */
  onLibrary: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="capture-modes"
      className="fixed inset-0 z-[1100] bg-bg flex flex-col justify-end"
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
            glyph="●"
            label="Take one photo"
            hint="One fresh shot — rear or front camera."
            onClick={onSingle}
          />
          <ModeRow
            testId="capture-mode-dual"
            glyph="●●"
            label="Front + back"
            hint="Two shots, paired: the room and you."
            onClick={onDual}
          />
          <ModeRow
            testId="capture-mode-library"
            glyph="▤"
            label="Choose from library"
            hint="Use a photo you already have."
            onClick={onLibrary}
          />
        </div>

        <p className="text-muted text-[11px] text-center mt-5 leading-relaxed">
          Nothing is shared until you review it and pick an audience.
        </p>
      </div>
    </div>
  );
}

function ModeRow({
  testId,
  glyph,
  label,
  hint,
  onClick,
}: {
  testId: string;
  glyph: string;
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
        className="w-9 h-9 shrink-0 rounded-full bg-surface text-accent flex items-center justify-center text-[10px] tracking-tighter"
      >
        {glyph}
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
