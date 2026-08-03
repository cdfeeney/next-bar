'use client';

import Link from 'next/link';
import type { Bar } from '@/types';
import type { WantToGoEntry } from '@/lib/wantToGo';
import { getBarById } from '@/lib/catalog';
import BarVisualTile from '@/components/BarVisualTile';

type WantToGoListProps = {
  /** Saved entries (oldest-first) — the page owns useWantToGo. */
  entries: WantToGoEntry[];
  onRemove: (barId: string) => void;
};

/**
 * QA5-S2: the "Want to go" tab body on /rankings — bars saved for later.
 * Presentational only; the rankings page owns the hook state and the
 * rated-bar auto-prune.
 *
 * Each row: visual tile, name, neighborhood/$ meta, a ✕ remove, and
 * "Been — rank it" into the EXISTING /rankings?add=<barId> tier-sheet
 * flow. That link is a plain <a> on purpose: the page reads ?add from
 * location.search on MOUNT only, and a same-route next/link navigation
 * doesn't remount, so a client-side transition would never open the
 * sheet. The full-page load also means the post-rating auto-prune (page
 * effect) runs on the fresh mount.
 */
export default function WantToGoList({
  entries,
  onRemove,
}: WantToGoListProps): JSX.Element {
  // Unknown ids (e.g. seeded by another slice against a newer catalog)
  // render nothing but are NOT pruned — the catalog may simply be behind.
  const rows: Array<{ entry: WantToGoEntry; bar: Bar }> = [];
  for (const entry of entries) {
    const bar = getBarById(entry.barId);
    if (bar) rows.push({ entry, bar });
  }

  if (rows.length === 0) {
    return (
      <section
        data-testid="want-to-go-empty"
        className="flex flex-col items-center justify-center text-center px-6 py-[120px]"
      >
        <h2 className="font-display text-2xl mb-2">Nothing saved yet.</h2>
        {/* Was /discover (archived, g-12d33864), then /map; /search is now the
            dedicated find-a-bar-and-save surface (g-7b6021a8). Link (not a
            plain <a>): unlike the ?add deep-link below there is no remount
            reason to force a full load. */}
        <Link
          href="/search"
          className="bg-accent text-bg rounded-full px-6 py-3 min-h-[44px] touch-manipulation font-display text-lg inline-flex items-center justify-center"
        >
          Find bars to add →
        </Link>
      </section>
    );
  }

  return (
    <section
      data-testid="want-to-go-list"
      className="max-w-2xl mx-auto px-6 flex flex-col gap-4"
    >
      {rows.map(({ entry, bar }, idx) => (
        <article
          key={entry.barId}
          className="rise bg-surface border border-border rounded-3xl p-4 flex items-center gap-4"
          style={{ ['--rise-delay' as string]: `${Math.min(idx, 10) * 50}ms` }}
        >
          <BarVisualTile bar={bar} size={56} />
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-xl leading-tight truncate">
              {bar.name}
            </h2>
            <p className="text-muted text-xs uppercase tracking-wider mt-1">
              {bar.neighborhood} · {'$'.repeat(bar.priceTier)}
            </p>
            <a
              href={`/rankings?add=${bar.id}`}
              className="text-accent text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation inline-flex items-center"
            >
              Been — rank it →
            </a>
          </div>
          <button
            type="button"
            aria-label={`Remove ${bar.name} from Want to go`}
            onClick={() => onRemove(entry.barId)}
            className="shrink-0 min-h-[44px] min-w-[44px] touch-manipulation rounded-full border border-border text-muted hover:text-text flex items-center justify-center text-lg"
          >
            ✕
          </button>
        </article>
      ))}
    </section>
  );
}
