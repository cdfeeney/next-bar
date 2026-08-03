'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRatings } from '@/hooks/useRatings';
import { useAuth } from '@/hooks/useAuth';
import { useWantToGo } from '@/hooks/useWantToGo';
import { sortRatingsByScore, tierMidpoint } from '@/lib/pairwise';
import { seedSampleNight } from '@/lib/demo';
import { getBarById } from '@/lib/catalog';
import { useBars } from '@/lib/useBars';
import { displayHood } from '@/lib/hoodDisplay';
import QuickAddBar from '@/components/QuickAddBar';
import WantToGoList from '@/components/WantToGoList';
import ShareButton from '@/components/ShareButton';
import { useLists } from '@/hooks/useLists';
import { WANT_TO_GO_LIST_ID } from '@/lib/wantToGo';
import { buildListShareText } from '@/lib/share';
import type { Bar } from '@/types';
import type { BarRating, Rating } from '@/types/ratings';

/**
 * The Lists switcher (g-ac3a291c crit 1-3): the crowded
 * All/Loved/Liked/Pass/Want-to-go chip row is gone. "Best Bars" — the
 * personal ranking — is the default view; the top-right switcher swaps
 * between it, Want to go, and every named list. Rating-tier FILTERING is
 * deliberately not re-added: the ranking is the product, the chips were
 * noise (operator).
 */
const BEST_VIEW_ID = 'best';

const RATING_LABEL: Record<Rating, string> = {
  loved: 'Loved',
  liked: 'Liked',
  pass: 'Pass',
};

const RATING_BADGE_CLASSES: Record<Rating, string> = {
  loved: 'bg-accent text-bg',
  liked: 'bg-surface border border-accent text-accent',
  pass: 'bg-surface border border-border text-muted',
};

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

function formatRatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return DATE_FORMATTER.format(date);
}

type RatedEntry = {
  rating: BarRating;
  bar: Bar;
};

export default function RankingsPage(): JSX.Element {
  // 0019 swap-day rule: getBarById reader — subscribe for live swaps.
  useBars();
  const { ratings } = useRatings();
  const auth = useAuth();
  // viewId: BEST_VIEW_ID or a list id (the reserved want-to-go list, or a
  // named one). The switcher is the only writer.
  const [viewId, setViewId] = useState<string>(BEST_VIEW_ID);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const { lists, removeBarFromList } = useLists();
  // U2-3 deep link (?add=<barId> from "Rank it →" on suggestion cards):
  // read once from location.search on mount — window-only, so no
  // useSearchParams/Suspense prerender dance — then strip the param so a
  // refresh doesn't re-open the tier sheet.
  const [deepLinkBarId, setDeepLinkBarId] = useState<string | undefined>();
  const clearDeepLink = useCallback(() => setDeepLinkBarId(undefined), []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const add = params.get('add');
    if (!add) return;
    setDeepLinkBarId(add);
    params.delete('add');
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}`,
    );
  }, []);

  const sortedEntries: RatedEntry[] = useMemo(() => {
    // sortRatingsByScore puts pairwise-scored bars first (score desc), then
    // falls back to tier-then-recency for bars that haven't had a
    // comparison yet (BarRating.score === null/undefined).
    const sorted = sortRatingsByScore(ratings);
    const result: RatedEntry[] = [];
    for (const r of sorted) {
      const bar = getBarById(r.barId);
      if (bar) result.push({ rating: r, bar });
    }
    return result;
  }, [ratings]);

  // Best Bars shows the full personal ranking — tier filtering is gone
  // with the chip row (crit 1/3).
  const visibleEntries = sortedEntries;

  // The named lists shown by the switcher: the reserved want-to-go list is
  // pinned as its own entry, so exclude it from the generic tail.
  const namedLists = useMemo(
    () => lists.filter((l) => l.id !== WANT_TO_GO_LIST_ID),
    [lists],
  );
  const activeNamedList =
    viewId === BEST_VIEW_ID || viewId === WANT_TO_GO_LIST_ID
      ? null
      : namedLists.find((l) => l.id === viewId) ?? null;
  // A list deleted (another tab, /lists) while being viewed falls back to
  // the default ranking rather than a blank screen.
  useEffect(() => {
    if (viewId === BEST_VIEW_ID || viewId === WANT_TO_GO_LIST_ID) return;
    if (!namedLists.some((l) => l.id === viewId)) setViewId(BEST_VIEW_ID);
  }, [viewId, namedLists]);
  const viewLabel =
    viewId === BEST_VIEW_ID
      ? 'Best Bars'
      : viewId === WANT_TO_GO_LIST_ID
        ? 'Want to go'
        : activeNamedList?.name ?? 'Best Bars';

  const hasNoRatings = ratings.length === 0;

  // QA5-S2 "Want to go" list. Rated bars leave the list automatically
  // ("Been — rank it" completes → the bar now lives in the rankings
  // proper): the guard makes the effect terminate — pruneRated rewrites
  // entries, the rerun then finds nothing rated and bails.
  const { entries: wantEntries, remove: removeWant, pruneRated } = useWantToGo();
  const ratedIds = useMemo(
    () => new Set(ratings.map((r) => r.barId)),
    [ratings],
  );
  useEffect(() => {
    if (!wantEntries.some((e) => ratedIds.has(e.barId))) return;
    pruneRated(ratedIds);
  }, [wantEntries, ratedIds, pruneRated]);

  return (
    <main className="min-h-screen">
      <header className="relative px-6 pt-8 pb-2 text-center">
        {/* Top-right Lists switcher (crit 2): a disclosure, not a chip row.
            The current view's name is the control's label; opening it lists
            Best Bars, Want to go, and every named list. */}
        <div className="absolute right-4 top-6 z-20 text-right">
          <button
            type="button"
            aria-expanded={switcherOpen}
            aria-label={`Lists — showing ${viewLabel}`}
            onClick={() => setSwitcherOpen((o) => !o)}
            className="min-h-[44px] touch-manipulation inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 font-display text-sm text-text hover:border-accent transition-colors"
          >
            {viewLabel}
            <span aria-hidden="true" className="text-muted">
              {switcherOpen ? '▴' : '▾'}
            </span>
          </button>
          {switcherOpen ? (
            <div
              role="group"
              aria-label="Switch list"
              className="mt-2 min-w-[180px] rounded-2xl border border-border bg-surface p-1.5 text-left shadow-lg"
            >
              {[
                { id: BEST_VIEW_ID, name: 'Best Bars' },
                { id: WANT_TO_GO_LIST_ID, name: 'Want to go' },
                ...namedLists.map((l) => ({ id: l.id, name: l.name })),
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={viewId === opt.id}
                  onClick={() => {
                    setViewId(opt.id);
                    setSwitcherOpen(false);
                  }}
                  className={[
                    'block w-full truncate rounded-xl px-3 py-2.5 text-left font-display text-sm',
                    'min-h-[44px] touch-manipulation',
                    viewId === opt.id
                      ? 'bg-accent text-bg'
                      : 'text-text hover:bg-bg',
                  ].join(' ')}
                >
                  {opt.name}
                </button>
              ))}
              <Link
                href="/lists"
                className="block w-full rounded-xl px-3 py-2.5 text-left text-xs text-muted underline-offset-4 hover:underline min-h-[44px] touch-manipulation inline-flex items-center"
              >
                Manage lists →
              </Link>
            </div>
          ) : null}
        </div>
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          Your nights, ranked
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-2">Rankings</h1>
        <p className="text-muted text-sm max-w-md mx-auto">
          Bars you&apos;ve rated, ordered by your personal 0–10 score.
          A ~score is tentative — it sits at your tier&apos;s midpoint and
          firms up as you answer comparison prompts.
        </p>
        <div className="flex items-center justify-center gap-5">
          <Link
            href="/lists"
            className="text-accent text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation mt-1"
          >
            Your lists →
          </Link>
          <Link
            href="/search"
            className="text-accent text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation mt-1"
          >
            Search bars →
          </Link>
        </div>
        {!hasNoRatings ? (
          // Persistent quick-add entry (B4). The empty state below mounts
          // its own instance — exactly one QuickAddBar renders at a time.
          <div className="mt-3">
            <QuickAddBar initialBarId={deepLinkBarId} onInitialConsumed={clearDeepLink} />
          </div>
        ) : null}
      </header>

      {viewId === WANT_TO_GO_LIST_ID ? (
        // Want-to-go is a list, not a tier — it renders regardless of
        // whether any ratings exist yet.
        <>
          <WantToGoList entries={wantEntries} onRemove={removeWant} />
          {wantEntries.length > 0 ? (
            <ListShareRow
              listName="Want to go"
              bars={wantEntries
                .map((e) => getBarById(e.barId))
                .filter((b): b is Bar => b !== undefined)}
            />
          ) : null}
        </>
      ) : activeNamedList !== null ? (
        <NamedListPanel
          list={activeNamedList}
          onRemoveBar={(barId) => removeBarFromList(activeNamedList.id, barId)}
        />
      ) : hasNoRatings ? (
        <section className="flex flex-col items-center justify-center text-center px-6 py-[120px]">
          <h2 className="font-display text-2xl mb-2">Nothing here yet.</h2>
          {/* Auth-aware sync claim (g-65a31bdf crit 11): signed-in ratings DO
              sync — the old unconditional "stay on this device" contradicted
              the signed-in footer below (santa: Sonnet verifier, g-7b6021a8). */}
          <p className="text-muted text-sm mb-6 max-w-sm">
            Rate a bar after you check it out and it&apos;ll show up here, scored
            0–10 by your own taste.{' '}
            {auth.status === 'signed-in'
              ? 'Your ratings sync to your account.'
              : 'Ratings stay on this device — sign in to sync.'}
          </p>
          <div className="mb-4">
            <QuickAddBar initialBarId={deepLinkBarId} onInitialConsumed={clearDeepLink} />
          </div>
          <Link
            href="/"
            className="bg-accent text-bg rounded-full px-6 py-3 min-h-[44px] touch-manipulation font-display text-lg inline-flex items-center justify-center"
          >
            Find a bar →
          </Link>
          <button
            type="button"
            onClick={() => seedSampleNight()}
            className="mt-4 text-accent text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
          >
            Or load a sample night to see it in action →
          </button>
        </section>
      ) : (
        <section className="max-w-2xl mx-auto px-6 flex flex-col gap-4">
          {visibleEntries.length === 0 ? (
            <p className="text-muted text-center">No bars rated yet.</p>
          ) : (
            visibleEntries.map(({ rating, bar }, idx) => {
              const hasScore = typeof rating.score === 'number';
              return (
                <article
                  key={rating.barId}
                  className="rise bg-surface border border-border rounded-3xl p-5 flex flex-col gap-2"
                  style={{ ['--rise-delay' as string]: `${Math.min(idx, 10) * 50}ms` }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="font-display text-xl leading-tight">
                      <span className="text-accent mr-2 tabular-nums">
                        {idx + 1}.
                      </span>
                      {bar.name}
                    </h2>
                    <div className="flex items-baseline gap-3 shrink-0">
                      {hasScore ? (
                        <span
                          className="font-display text-2xl tabular-nums text-accent"
                          aria-label={`Score ${(rating.score as number).toFixed(1)} out of 10`}
                        >
                          {(rating.score as number).toFixed(1)}
                        </span>
                      ) : (
                        // N6b (operator): EVERY ranked bar shows its number.
                        // No comparisons yet → tentative tier-band midpoint
                        // (what the sort already uses), muted + ~ so it
                        // reads as provisional, firming up via comparisons.
                        <span
                          className="font-display text-2xl tabular-nums text-muted"
                          aria-label={`Tentative score ${tierMidpoint(rating.rating).toFixed(1)} out of 10 — firms up as you compare`}
                        >
                          ~{tierMidpoint(rating.rating).toFixed(1)}
                        </span>
                      )}
                      <span className="text-muted text-xs">
                        {'$'.repeat(bar.priceTier)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted text-xs uppercase tracking-wider">
                      {displayHood(bar.neighborhood)}
                    </span>
                    <span
                      className={[
                        'text-xs font-display px-2 py-0.5 rounded-full',
                        RATING_BADGE_CLASSES[rating.rating],
                      ].join(' ')}
                    >
                      {RATING_LABEL[rating.rating]}
                    </span>
                    {!hasScore ? (
                      <span className="text-muted text-xs italic">
                        Rank as you compare
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm italic">{bar.blurb}</p>
                  <p className="text-xs text-muted pt-1">
                    Rated {formatRatedAt(rating.ratedAt)}
                  </p>
                </article>
              );
            })
          )}
        </section>
      )}

      <p className="text-muted text-xs text-center mt-8 pb-24">
        {/* Want-to-go saves are localStorage-only on every auth path — the
            signed-in "Synced" claim is true for RATINGS but was false on this
            tab, contradicting /search's honest device-only disclosure
            (santa: Codex, round 3). */}
        {viewId !== BEST_VIEW_ID
          ? "Lists stay on this device — sharing sends text, not a link"
          : auth.status === 'signed-in'
            ? 'Synced to your account'
            : 'Stored on this device · sign in to sync'}
      </p>
    </main>
  );
}

/**
 * Text-only native share for a device-local list (crit 7/8/9/11): the
 * payload is the numbered list itself — deliberately NO URL, because
 * these lists exist only on this device and a link would 404 for every
 * recipient. Public list pages are future server work; until then the
 * truthful share is text.
 */
function ListShareRow({
  listName,
  bars,
}: {
  listName: string;
  bars: Array<Pick<Bar, 'name' | 'neighborhood'>>;
}): JSX.Element {
  return (
    <div className="px-6 pb-2 text-center">
      <ShareButton
        text={buildListShareText(
          listName,
          bars.map((b) => ({
            name: b.name,
            neighborhood: displayHood(b.neighborhood),
          })),
        )}
        label={`Share "${listName}"`}
        ariaLabel={`Share the list ${listName} as text`}
        variant="outline"
      />
    </div>
  );
}

/**
 * A named list, viewed inside Rankings via the switcher (crit 5): bars in
 * list order with remove; adding bars stays on /lists (its picker owns
 * that flow).
 */
function NamedListPanel({
  list,
  onRemoveBar,
}: {
  list: { id: string; name: string; barIds: string[] };
  onRemoveBar: (barId: string) => void;
}): JSX.Element {
  const bars = list.barIds
    .map((barId) => getBarById(barId))
    .filter((b): b is Bar => b !== undefined);
  return (
    <section
      data-testid="named-list-panel"
      className="max-w-md mx-auto px-6 pb-4"
    >
      {bars.length === 0 ? (
        <div className="bg-surface border border-border rounded-3xl p-6 text-center">
          <p className="font-display text-xl mb-2">
            &ldquo;{list.name}&rdquo; is empty so far.
          </p>
          <Link
            href="/lists"
            className="text-accent text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation"
          >
            Add bars on Your lists →
          </Link>
        </div>
      ) : (
        <>
          <ul className="mb-4">
            {bars.map((bar, i) => (
              <li
                key={bar.id}
                className="flex items-center justify-between gap-3 py-3 border-b border-border last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="font-display">
                    <span className="text-accent mr-2 tabular-nums">
                      {i + 1}.
                    </span>
                    {bar.name}
                  </span>
                  <span className="text-muted text-xs uppercase tracking-wider ml-2">
                    {displayHood(bar.neighborhood)}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${bar.name} from ${list.name}`}
                  onClick={() => onRemoveBar(bar.id)}
                  className="text-muted text-xs underline-offset-4 hover:underline min-h-[44px] touch-manipulation shrink-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <ListShareRow listName={list.name} bars={bars} />
        </>
      )}
    </section>
  );
}
