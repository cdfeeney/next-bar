'use client';

/**
 * README §7 — the decided banner, rendered only once the plan is locked:
 * "DECIDED", the bar and its neighbourhood, one line of reassurance, then two
 * 44px outlined actions — Directions and Share.
 *
 * "Doors at 9:00 PM" is not stated: the member read carries no start time
 * (see PlanHeader), and a time this surface cannot know is not one it should
 * print.
 */
import { getBarById } from '@/lib/catalog';
import { directionsHref } from '@/lib/travelTime';

export default function DecidedBanner({
  barId,
  onShare,
  shareNotice,
}: {
  barId: string;
  onShare: () => void;
  /** R-03 item 2: the copy confirmation (or the by-hand URL) shows HERE, beside Share. */
  shareNotice: string | null;
}): JSX.Element {
  const bar = getBarById(barId);
  const name = bar?.name ?? barId;
  const actionClass =
    'inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-text px-4 text-sm font-semibold text-text touch-manipulation';
  return (
    <section
      data-testid="decided-banner"
      className="mt-6 rounded-3xl border border-accent bg-gradient-to-b from-accent/[0.14] to-surface p-5"
    >
      <p className="font-label text-[10px] font-bold uppercase tracking-[0.25em] text-accent">Decided</p>
      {/* The words the e2e (and a screen reader) look for. */}
      <p className="sr-only">It&apos;s decided: {name}</p>
      <p className="mt-1 font-display text-2xl font-bold leading-tight">
        {name}
        {bar?.neighborhood ? <span className="text-muted"> · {bar.neighborhood}</span> : null}
      </p>
      <p className="mt-2 text-sm text-muted">Everyone invited has been told.</p>
      <div className="mt-4 flex gap-3">
        {bar ? (
          <a
            href={directionsHref(undefined, { lat: bar.lat, lng: bar.lng }, 'walking')}
            target="_blank"
            rel="noopener noreferrer"
            className={actionClass}
          >
            Directions
          </a>
        ) : null}
        <button type="button" onClick={onShare} className={actionClass}>
          Share
        </button>
      </div>
      {shareNotice !== null ? (
        <p className="mt-3 break-all text-xs text-muted" role="status" data-testid="decided-share-notice">
          {shareNotice}
        </p>
      ) : null}
    </section>
  );
}
