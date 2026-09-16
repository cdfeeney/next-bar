'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import MediaThumb from '@/lib/nightOutMedia/MediaThumb';
import { savedNightSummary } from '@/lib/nightOutMedia';
import { fetchSavedNight, type SavedNightRead } from '@/lib/nightOutMedia/server';
import { useBars } from '@/lib/useBars';
import BarVisualTile from '@/components/BarVisualTile';
import { RatingBadgeLabel } from '@/components/RatingBadge';
import type { Bar } from '@/types';

// Same as RecapCard: the map is client-only and heavy, so it loads on demand.
const BarMap = dynamic(() => import('@/components/BarMap'), { ssr: false });

/**
 * /nights/[id] — ONE ARCHIVED NIGHT, the saved-night recap (README §8,
 * V8-R-ACC-002). "Opens that night's archived recap exactly as it was saved":
 * the title, date, stops, ratings and photos are read from the archive, which
 * `archive_night_out` snapshotted (0068 for the media + counts, 0083 for the
 * ordered, rated stops). A plan later renamed, re-decided, cancelled or deleted
 * does not rewrite this page.
 *
 * OWN ACCOUNT ONLY, decided on the server. `get_saved_night` /
 * `get_saved_night_bars` filter on auth.uid(), so another account's id returns
 * zero rows and lands here as "not found".
 *
 * "COULDN'T READ" IS NOT "ISN'T THERE" (round 2, both gates). A failed RPC is a
 * distinct state from an absent night, which is distinct from a night with no
 * photos or no stops left.
 *
 * NOT here, and deliberately so:
 *  - No COVER: the archive never snapshotted `night_outs.cover`, and §8 keeps
 *    the plain header when there is none rather than inventing a placeholder.
 *  - No "Share the night": public night sharing is retired (WP7/EC-04) and a
 *    Saved Night is a PRIVATE archive with no approved share path
 *    (ShareNightButton renders nothing for the same reason).
 */
export default function SavedNightPage({
  params,
}: {
  params: { id: string };
}): JSX.Element {
  const auth = useAuth();
  const [read, setRead] = useState<SavedNightRead>({ kind: 'missing' });
  const [loading, setLoading] = useState(true);

  const signedIn = auth.status === 'signed-in';

  useEffect(() => {
    if (auth.status === 'loading') {
      setLoading(true);
      return undefined;
    }
    if (!signedIn) {
      setRead({ kind: 'missing' });
      setLoading(false);
      return undefined;
    }
    const supabase = getBrowserSupabase();
    if (supabase === null) {
      setRead({ kind: 'failed' });
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      const next = await fetchSavedNight(supabase, params.id);
      if (cancelled) return;
      setRead(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status, signedIn, params.id]);

  return (
    <main className="min-h-screen pb-28" data-testid="saved-night">
      <header className="px-6 pt-8 pb-4 max-w-md mx-auto w-full">
        <Link
          href="/nights"
          className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation"
        >
          ← Saved Nights Out
        </Link>
      </header>

      <div className="max-w-md mx-auto px-6">
        {loading ? (
          <p className="text-muted text-sm" role="status">
            Opening that night…
          </p>
        ) : read.kind === 'failed' ? (
          <p className="text-muted text-sm" role="status" data-testid="saved-night-error">
            Couldn&apos;t open that night. Try again in a moment.
          </p>
        ) : read.kind === 'missing' ? (
          <p className="text-muted text-sm" role="status" data-testid="saved-night-missing">
            That night isn&apos;t in your archive.
          </p>
        ) : (
          <Recap night={read.night} />
        )}
      </div>
    </main>
  );
}

/** The recap body — pure composition of the snapshot (README §8). */
function Recap({ night }: { night: import('@/lib/nightOutMedia').SavedNight }): JSX.Element {
  // Resolve each snapshotted stop to a catalog bar, REACTIVELY: useBars re-renders
  // when CatalogRefresh swaps the small core catalog for the full 2,107-bar set,
  // so a stop outside the core set appears once the catalog lands rather than
  // being dropped until an unrelated remount (round-1, both lanes). An id the
  // catalog never carries is dropped (like composeRecap); the headline's count
  // stays the snapshot's own count.
  const catalog = useBars();
  const byId = useMemo(() => new Map(catalog.map((b) => [b.id, b])), [catalog]);
  const stops = useMemo(
    () =>
      night.bars.flatMap((b) => {
        const bar = byId.get(b.barId);
        return bar ? [{ bar, rating: b.rating }] : [];
      }),
    [night.bars, byId],
  );
  const mapBars: Bar[] = useMemo(() => stops.map((s) => s.bar), [stops]);
  const lovedName = stops.find((s) => s.rating === 'loved')?.bar.name ?? null;
  const anyUnrated = night.bars.some((b) => b.rating === null);
  const stopCount = night.bars.length;

  return (
    <article data-testid="saved-night-open">
      <h1 className="font-display text-2xl leading-tight">
        {night.title ?? 'Night out'}
      </h1>
      <p className="text-muted text-xs mt-1">
        {savedNightSummary({
          title: night.title,
          night: night.night,
          barCount: night.barCount,
          photoCount: night.photos.length,
        })}
      </p>
      {/* The night's own fact, derived — never a vague "Your night". */}
      {stopCount > 0 ? (
        <p className="text-xl font-bold mt-3" data-testid="saved-night-headline">
          {stopCount === 1 ? 'One stop' : `${stopCount} stops`}
          {lovedName ? ` · you loved ${lovedName}` : ''}
        </p>
      ) : null}

      {/* Numbered stop rows: tile, name (♥ when loved), rating badge. */}
      {stops.length > 0 ? (
        <ol className="mt-6 flex flex-col gap-3" data-testid="saved-night-stops">
          {stops.map(({ bar, rating }, i) => (
            <li key={`${bar.id}-${i}`} className="flex items-center gap-3 min-h-[44px]" data-testid="saved-night-stop">
              <span className="text-muted text-xs font-display w-4 shrink-0 text-right">{i + 1}</span>
              <BarVisualTile bar={bar} size={32} />
              <span className="flex-1 min-w-0 truncate font-display text-sm font-semibold">
                {bar.name}
                {rating === 'loved' ? (
                  <span className="text-accent" aria-hidden="true"> ♥</span>
                ) : null}
              </span>
              <RatingBadgeLabel rating={rating} />
            </li>
          ))}
        </ol>
      ) : null}

      {/* One primary action: rank what's still unrated, or go to rankings. */}
      <div className="mt-6">
        <Link
          href="/rankings"
          data-testid="saved-night-rank"
          className="inline-flex items-center justify-center min-h-[56px] w-full px-6 rounded-full bg-accent text-bg font-display text-sm touch-manipulation"
        >
          {anyUnrated ? 'Rank last night →' : 'See your rankings →'}
        </Link>
      </div>

      {/* Photos (existing). No empty grid, no broken tile when there are none. */}
      {night.photos.length === 0 ? (
        <p className="text-muted text-sm mt-6" data-testid="saved-night-no-photos">
          The photos from this night are no longer available.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 mt-6" data-testid="saved-night-photos">
          {night.photos.map((photo) => (
            <li key={photo.mediaId}>
              <MediaThumb mediaId={photo.mediaId} alt="" className="aspect-square w-full rounded-2xl" />
            </li>
          ))}
        </ul>
      )}

      {/* A quiet map of the night's stops, when their coordinates resolve. */}
      {mapBars.length > 0 ? (
        <div className="h-48 mt-6 rounded-2xl overflow-hidden" data-testid="saved-night-map">
          <BarMap
            bars={mapBars}
            fitToBars
            highlightIds={lovedName ? mapBars.filter((_, i) => stops[i].rating === 'loved').map((b) => b.id) : []}
          />
        </div>
      ) : null}
    </article>
  );
}
