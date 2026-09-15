'use client';

import Link from 'next/link';
import ShareButton from '@/components/ShareButton';
import { buildPickPath, sharePickText } from '@/lib/share';
import { barById, type ConsensusEntry } from '@/lib/demo';

/**
 * A consensus entry plus the partition it came from. Near-misses stay in the
 * one Group Favorites list (the standing UX-B invariant — unanimous picks
 * lead) but must never be *labelled* as Group Favorites, so the flag travels
 * with the entry all the way to the card.
 */
export type RankedEntry = ConsensusEntry & { isGroupFavorite: boolean };

/**
 * Compact tile (operator 2026-07-26: "the tiles need to be smaller") —
 * name, score, one meta line. Blurb and per-person score chips are gone;
 * the top pick keeps its glow + the share moment.
 *
 * S-06: the shortlist toggle left this card — the SHORTLIST section offers the
 * Group Favorites as its first rows, so the card is display only again.
 */
export function ConsensusCard({
  entry,
  rank,
  index = 0,
  highlight = false,
}: {
  entry: RankedEntry;
  rank?: number;
  index?: number;
  highlight?: boolean;
}): JSX.Element {
  const bar = barById(entry.barId);
  if (!bar) return <></>;
  const nearMiss = !entry.isGroupFavorite;
  return (
    <article
      className={[
        'rise rounded-2xl px-4 py-3 border',
        highlight
          ? 'glow-accent border-accent bg-gradient-to-b from-accent/[0.08] to-surface'
          : 'bg-surface border-border',
      ].join(' ')}
      style={{ ['--rise-delay' as string]: `${Math.min(index, 8) * 70}ms` }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base leading-tight truncate">
          {rank ? (
            <span className="text-accent mr-2 tabular-nums">{rank}.</span>
          ) : null}
          {highlight ? (
            <span className="text-accent" aria-hidden="true">★ </span>
          ) : null}
          {bar.name}
        </h3>
        <span
          className="font-display text-lg tabular-nums text-accent shrink-0"
          aria-label={`Group score ${entry.avgScore.toFixed(1)} out of 10`}
        >
          {entry.avgScore.toFixed(1)}
        </span>
      </div>
      <p className="text-muted text-xs uppercase tracking-wider truncate mt-0.5">
        {bar.neighborhood} · {'$'.repeat(bar.priceTier)}
      </p>
      {/* A near-miss shares the one list (UX-B) but must not read as a Group
          Favorite: someone here scored it under 8.0, or has not scored it at
          all. Said in words, not colour alone. */}
      {nearMiss ? (
        <p
          data-testid="near-miss-badge"
          className="mt-1.5 inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] text-muted"
        >
          Not a Group Favorite yet
        </p>
      ) : null}
      {/* The winner-share moment lives on the TOP pick (works signed-out
          too — the share-card loop's entry). QA3: a labeled solid-outline
          button spanning the card so it's findable on mobile. */}
      {highlight ? (
        <div className="mt-3">
          <ShareButton
            path={buildPickPath(bar.id)}
            text={sharePickText(bar)}
            label="Share the pick"
            ariaLabel={`Share the pick: ${bar.name}`}
            variant="outline"
            wide
          />
        </div>
      ) : null}
    </article>
  );
}

export function EmptyState({
  youHasRatings,
  anyFollowed,
}: {
  youHasRatings: boolean;
  anyFollowed: boolean;
}): JSX.Element {
  return (
    <div className="bg-surface border border-border rounded-3xl p-6 text-center">
      <p className="font-display text-xl mb-2">Pick at least two people.</p>
      <p className="text-muted text-sm leading-relaxed mb-5">
        Consensus needs a group. Select two or more of the people above to find
        the bars you all agree on.
      </p>
      {!anyFollowed ? (
        <Link
          href="/friends"
          className="inline-flex items-center justify-center bg-accent text-bg font-display text-sm px-5 py-3 rounded-full min-h-[44px] touch-manipulation"
        >
          Follow some friends →
        </Link>
      ) : !youHasRatings ? (
        <Link
          href="/rankings"
          className="inline-flex items-center justify-center bg-accent text-bg font-display text-sm px-5 py-3 rounded-full min-h-[44px] touch-manipulation"
        >
          Add your own ratings →
        </Link>
      ) : null}
    </div>
  );
}
