'use client';

import { useWantToGo } from '@/hooks/useWantToGo';

type WantToGoToggleProps = {
  barId: string;
  barName: string;
  /** Extra classes for the surface hosting the toggle. */
  className?: string;
  /** Compact = icon-ish inline control (result cards); full = labeled CTA. */
  variant?: 'compact' | 'full';
};

/**
 * The ONE Want-to-Go writer (goal g-8557db39). The list had zero production
 * writers after /discover was archived (see src/lib/wantToGo.ts) — this
 * restores saving on the two surfaces where a user meets a bar: the map
 * detail lightbox and the Next Bar result card. Both go through the shared
 * useWantToGo hook, so there is exactly one persistence path and every
 * mounted consumer refreshes via the lib's synthesized storage event.
 *
 * Accessible name carries STATE, not just action, so a screen reader user
 * hears whether the bar is currently saved.
 */
export default function WantToGoToggle({
  barId,
  barName,
  className = '',
  variant = 'compact',
}: WantToGoToggleProps): JSX.Element {
  const { entries, add, remove } = useWantToGo();
  const saved = entries.some((e) => e.barId === barId);

  const label = saved ? 'Saved' : 'Want to go';
  const accessibleName = saved
    ? `Remove ${barName} from Want to go`
    : `Save ${barName} to Want to go`;

  const base =
    'min-h-[44px] touch-manipulation inline-flex items-center justify-center gap-1.5 font-display transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  const shape =
    variant === 'full'
      ? 'flex-1 text-center border rounded-full text-sm py-3 px-4'
      : 'text-xs rounded-full border px-3 shrink-0';
  const tone = saved
    ? 'border-accent text-accent'
    : 'border-border text-text hover:border-accent';

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={accessibleName}
      onClick={() => (saved ? remove(barId) : add(barId))}
      className={`${base} ${shape} ${tone} ${className}`.trim()}
    >
      <span aria-hidden>{saved ? '★' : '☆'}</span>
      {label}
    </button>
  );
}
