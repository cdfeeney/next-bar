'use client';

import { useEffect, useRef, useState } from 'react';
import { NIGHT_PHASES, type NightPhase } from '@/lib/nightPhase';

/** User-facing phase names (status labels, not commands). */
export const PHASE_LABEL: Record<NightPhase, string> = {
  planning: 'Planning',
  out: 'Out now',
  recap: 'Last night',
};

type PhaseChipProps = {
  phase: NightPhase;
  onSelect: (phase: NightPhase) => void;
};

/**
 * The home header's phase chip (E2.4/E3.4, DESIGN-SYSTEM R10): always
 * shows the current phase; tapping it opens all three phases so any
 * wrong guess is fixed in exactly two taps — a cycle-on-tap chip would
 * need up to three. Selection persists for the night via phaseOverride
 * (the caller's concern).
 */
export default function PhaseChip({ phase, onSelect }: PhaseChipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Escape and outside-tap dismiss the panel — the codebase's overlay
  // convention (BarLightbox et al.); without it a keyboard user's only
  // exit is picking a phase (review finding).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Night phase: ${PHASE_LABEL[phase]}`}
        onClick={() => setOpen((v) => !v)}
        className="min-h-[44px] touch-manipulation inline-flex items-center gap-1.5 rounded-full border border-border px-3 text-xs font-display hover:border-accent transition-colors"
      >
        {PHASE_LABEL[phase]}
        <span aria-hidden="true" className="text-muted text-[10px]">
          ▾
        </span>
      </button>
      {open ? (
        <div
          role="group"
          aria-label="Night phase"
          className="absolute right-0 top-full mt-2 z-[600] flex flex-col gap-1 bg-surface border border-border rounded-2xl p-2 shadow-lg min-w-[10rem]"
        >
          {NIGHT_PHASES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === phase}
              onClick={() => {
                setOpen(false);
                onSelect(p);
              }}
              className={`min-h-[44px] touch-manipulation rounded-xl px-3 text-left text-sm font-display transition-colors hover:bg-bg ${
                p === phase ? 'text-accent' : ''
              }`}
            >
              {PHASE_LABEL[p]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
