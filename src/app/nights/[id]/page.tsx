'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import MediaThumb from '@/lib/nightOutMedia/MediaThumb';
import { savedNightSummary, type SavedNight } from '@/lib/nightOutMedia';
import { fetchSavedNight } from '@/lib/nightOutMedia/server';

/**
 * /nights/[id] — ONE ARCHIVED NIGHT (V8-R-ACC-002).
 *
 * "Tapping opens that night's archived recap exactly as it was saved." Exactly
 * as SAVED, not as the plan stands now: the title, night and bar count are read
 * from the archive row, which `archive_night_out` snapshotted. A plan that was
 * later renamed, re-decided or cancelled does not rewrite this page.
 *
 * OWN ACCOUNT ONLY, decided on the server. `get_saved_night` filters on
 * auth.uid(), so another account's id returns zero rows and lands here as
 * "not found" — the same answer a genuinely missing night gets, because which
 * of the two it was is information about somebody else's archive.
 *
 * A NIGHT WITH NO PHOTOS LEFT IS STILL A NIGHT. The archive keeps its own bytes
 * alive through a retention hold, but an account deletion upstream can still
 * take them; when that happens this renders the night and says the photos are
 * gone, rather than rendering an empty page that looks like a failed read.
 */
export default function SavedNightPage({
  params,
}: {
  params: { id: string };
}): JSX.Element {
  const auth = useAuth();
  const [night, setNight] = useState<SavedNight | null>(null);
  const [loading, setLoading] = useState(true);

  const signedIn = auth.status === 'signed-in';

  useEffect(() => {
    if (auth.status === 'loading') {
      setLoading(true);
      return undefined;
    }
    if (!signedIn) {
      setNight(null);
      setLoading(false);
      return undefined;
    }
    const supabase = getBrowserSupabase();
    if (supabase === null) {
      setNight(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      const next = await fetchSavedNight(supabase, params.id);
      if (cancelled) return;
      setNight(next);
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
        ) : night === null ? (
          <p
            className="text-muted text-sm"
            role="status"
            data-testid="saved-night-missing"
          >
            That night isn&apos;t in your archive.
          </p>
        ) : (
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

            {night.photos.length === 0 ? (
              <p
                className="text-muted text-sm mt-6"
                data-testid="saved-night-no-photos"
              >
                The photos from this night are no longer available.
              </p>
            ) : (
              <ul
                className="grid grid-cols-2 gap-2 mt-6"
                data-testid="saved-night-photos"
              >
                {night.photos.map((photo) => (
                  <li key={photo.mediaId}>
                    <MediaThumb
                      mediaId={photo.mediaId}
                      alt=""
                      className="aspect-square w-full rounded-2xl"
                    />
                  </li>
                ))}
              </ul>
            )}
          </article>
        )}
      </div>
    </main>
  );
}
