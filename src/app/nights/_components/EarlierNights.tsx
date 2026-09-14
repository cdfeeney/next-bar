'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import MediaThumb from '@/lib/nightOutMedia/MediaThumb';
import { formatNightDate, savedNightSummary, type SavedNightCard } from '@/lib/nightOutMedia';
import { fetchSavedNights } from '@/lib/nightOutMedia/server';

/**
 * EARLIER NIGHTS on Social → Plans (Social redesign 2026-09-13, README §2.4):
 * rows with a 48px thumbnail, the night's title, the `savedNightSummary` line
 * and a chevron; each opens the saved-night recap at /nights/<id>.
 *
 * Reads the same `get_saved_nights` the archive page reads. States are kept
 * apart on purpose: signed out, still loading and a failed read all render
 * nothing HERE — the archive page (`/nights`) is where failure is stated; this
 * is a shortcut list, and a shortcut must never claim "nothing saved" on a
 * read it could not complete. Empty renders nothing (the Plans no-plan line
 * already says what lands on this tab).
 */
export default function EarlierNights({ limit = 5 }: { limit?: number }): JSX.Element | null {
  const auth = useAuth();
  const signedIn = auth.status === 'signed-in';
  const [cards, setCards] = useState<SavedNightCard[] | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setCards(null);
      return undefined;
    }
    const supabase = getBrowserSupabase();
    if (supabase === null) return undefined;
    let cancelled = false;
    void (async () => {
      const next = await fetchSavedNights(supabase);
      if (cancelled) return;
      setCards(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  if (!signedIn || cards === null || cards.length === 0) return null;

  return (
    <section aria-labelledby="earlier-nights-heading" data-testid="earlier-nights">
      <h3
        id="earlier-nights-heading"
        className="font-label text-xs font-bold uppercase tracking-[0.25em] text-muted mt-[30px] mb-2"
      >
        Earlier nights
      </h3>
      <ul>
        {cards.slice(0, limit).map((card) => (
          <li key={card.id}>
            <Link
              href={`/nights/${card.id}`}
              data-testid="earlier-night"
              className="flex items-center gap-3 py-[11px] border-b border-held touch-manipulation"
            >
              <span className="shrink-0 w-12 h-12 rounded-[14px] overflow-hidden bg-held" aria-hidden="true">
                {card.coverMediaIds.length > 0 ? (
                  <MediaThumb mediaId={card.coverMediaIds[0]} alt="" className="w-12 h-12 object-cover" />
                ) : (
                  <span
                    className="block w-12 h-12"
                    style={{ background: 'linear-gradient(140deg, #c54328, #2a1c2e)' }}
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold truncate">
                  {card.title ?? formatNightDate(card.night)}
                </span>
                <span className="block text-xs text-muted truncate mt-0.5">
                  {savedNightSummary(card)}
                </span>
              </span>
              <span aria-hidden="true" className="text-muted shrink-0">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
