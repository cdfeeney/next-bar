'use client';

import type { Bar } from '@/types';
import { barById } from '@/lib/demo';

/**
 * V9-05 / S-06: how many bars the organizer can put on the plan's board from
 * the planning flow — `suggest_night_out_bar`'s own cap of three live
 * suggestions per member (0044:648), so the form cannot offer what the server
 * refuses.
 */
export const SHORTLIST_CAP = 3;

/**
 * README §6 SHORTLIST: "N of 3", the seed line, then bar rows with a trailing
 * "+" / "✓". The rows are offered in this order — what is already picked (so
 * it can be unpicked), then Group Favorites, then whatever the search matched.
 * Group Favorites first closes the gap the README leaves open: a real circle
 * still gets the algorithm's picks before it has to type a name.
 */
export default function ShortlistSection({
  shortlist,
  favoriteIds,
  matches,
  query,
  onQuery,
  onToggle,
  disabled = false,
}: {
  /** Bar ids in pick order, at most SHORTLIST_CAP. */
  shortlist: readonly string[];
  /** Group Favorites bar ids, best first. */
  favoriteIds: readonly string[];
  /** Catalog matches for `query`. */
  matches: readonly Bar[];
  query: string;
  onQuery: (query: string) => void;
  onToggle: (barId: string) => void;
  disabled?: boolean;
}): JSX.Element {
  const full = shortlist.length >= SHORTLIST_CAP;
  const rows = [...new Set([...shortlist, ...favoriteIds, ...matches.map((b) => b.id)])];
  const term = query.trim();
  return (
    <section className="mt-8 text-left" role="group" aria-label="Shortlist for the vote">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="font-label text-xs uppercase tracking-[0.25em] text-muted">Shortlist</h2>
        <p className="font-display text-sm tabular-nums" aria-live="polite" data-testid="shortlist-count">
          {shortlist.length} of {SHORTLIST_CAP}
        </p>
      </div>
      <p className="mb-3 text-sm text-muted">
        Seed the vote with up to three bars. Everyone can suggest more once the plan is live.
      </p>
      <label htmlFor="shortlist-search" className="sr-only">
        Add a bar to the shortlist
      </label>
      <input
        id="shortlist-search"
        type="search"
        value={query}
        disabled={disabled}
        placeholder="Search bars by name"
        className="mb-3 w-full rounded-2xl border border-border bg-surface px-4 py-2 min-h-[44px] text-text"
        onChange={(event) => onQuery(event.target.value)}
      />
      {term !== '' && matches.length === 0 ? (
        <p className="mb-3 text-sm text-muted">No matching bars.</p>
      ) : null}
      <div className="space-y-2" data-testid="shortlist-rows">
        {rows.map((id) => {
          const bar = barById(id);
          const name = bar?.name ?? id;
          const on = shortlist.includes(id);
          return (
            <div
              key={id}
              data-testid="shortlist-row"
              data-bar-id={id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm truncate">{name}</p>
                {bar ? (
                  <p className="text-xs uppercase tracking-wider text-muted truncate">{bar.neighborhood}</p>
                ) : null}
              </div>
              <button
                type="button"
                aria-pressed={on}
                aria-label={on ? `Remove ${name} from the shortlist` : `Add ${name} to the shortlist`}
                disabled={disabled || (!on && full)}
                onClick={() => onToggle(id)}
                className={[
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-lg touch-manipulation',
                  on ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted',
                  'disabled:bg-held disabled:text-muted',
                ].join(' ')}
              >
                <span aria-hidden="true">{on ? '✓' : '+'}</span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
