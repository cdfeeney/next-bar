'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import MediaThumb from '@/lib/nightOutMedia/MediaThumb';
import { savedNightSummary, type SavedNightCard } from '@/lib/nightOutMedia';
import { fetchSavedNights } from '@/lib/nightOutMedia/server';

/**
 * /nights — SAVED NIGHTS OUT (V8-R-ACC-002, the destination of V8-R-NO-009).
 *
 * "Each past night is a card leading with photos and one quiet metadata line —
 * name, date, bar count, photo count. Tapping opens that night's archived recap
 * exactly as it was saved."
 *
 * PRIVATE, and the word is load-bearing. The audience is "the account owner
 * ONLY". There is no share control here, no token in the URL and no public
 * variant of this route — `get_saved_nights` filters on `auth.uid()` in its own
 * body, so this page cannot be pointed at somebody else's archive by editing an
 * address. That is the opposite of the legacy Shared Night link migration 0068
 * retires, and the two are conflated often enough to be worth saying here too.
 *
 * FOUR STATES, because collapsing any two of them lies to the owner:
 *   loading    · we do not know yet
 *   signed out · there is no archive to ask about, not an empty one
 *   []         · genuinely nothing archived yet
 *   null       · the read failed — "a night that cannot be read states so
 *                rather than rendering an empty archive" (V8-R-ACC-002)
 */
export default function SavedNightsPage(): JSX.Element {
  const auth = useAuth();
  const [cards, setCards] = useState<SavedNightCard[] | null>(null);
  const [loading, setLoading] = useState(true);

  const signedIn = auth.status === 'signed-in';

  useEffect(() => {
    if (auth.status === 'loading') {
      setLoading(true);
      return undefined;
    }
    if (!signedIn) {
      setCards([]);
      setLoading(false);
      return undefined;
    }
    const supabase = getBrowserSupabase();
    if (supabase === null) {
      // An unconfigured client is a FAILED read, not an empty archive.
      setCards(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      const next = await fetchSavedNights(supabase);
      if (cancelled) return;
      setCards(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status, signedIn]);

  return (
    <main className="min-h-screen pb-28" data-testid="saved-nights">
      <header className="px-6 pt-8 pb-4 max-w-md mx-auto w-full">
        <h1 className="font-display text-2xl uppercase tracking-[0.14em]">
          Saved Nights Out
        </h1>
        <p className="text-muted text-sm mt-1">
          Your private archive. Only you can see it.
        </p>
      </header>

      <div className="max-w-md mx-auto px-6">
        <Body
          loading={loading}
          signedOut={auth.status !== 'loading' && !signedIn}
          cards={cards}
        />
      </div>
    </main>
  );
}

function Body({
  loading,
  signedOut,
  cards,
}: {
  loading: boolean;
  signedOut: boolean;
  cards: SavedNightCard[] | null;
}): JSX.Element {
  if (loading) {
    return (
      <p className="text-muted text-sm" role="status">
        Opening your archive…
      </p>
    );
  }

  if (signedOut) {
    return (
      <div data-testid="saved-nights-signed-out">
        <p className="text-muted text-sm mb-3">
          Sign in to see the nights you have saved.
        </p>
        <Link
          href="/auth"
          className="inline-flex items-center min-h-[44px] px-5 rounded-full border border-border font-display text-sm touch-manipulation hover:border-accent hover:text-accent transition-colors"
        >
          Sign in
        </Link>
      </div>
    );
  }

  // FAILURE IS NOT EMPTINESS. Rendering "nothing saved yet" here would tell the
  // owner their archive is gone.
  if (cards === null) {
    return (
      <p
        className="text-muted text-sm"
        role="status"
        data-testid="saved-nights-error"
      >
        Couldn&apos;t open your archive. Try again in a moment.
      </p>
    );
  }

  if (cards.length === 0) {
    return (
      <div
        className="rounded-2xl border border-border bg-surface p-5"
        data-testid="saved-nights-empty"
      >
        <p className="text-sm leading-relaxed">
          Nothing saved yet. Photos from a Night Out last 24 hours — save a night
          before its window closes and it stays here for good.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-4" data-testid="saved-nights-list">
      {cards.map((card) => (
        <li key={card.id}>
          <Link
            href={`/nights/${card.id}`}
            data-testid="saved-night-card"
            className="block rounded-2xl border border-border bg-surface overflow-hidden touch-manipulation hover:border-accent transition-colors"
          >
            {/* LEADS WITH PHOTOS (V8-R-ACC-002). A night whose photos are all
                gone still gets its card — the metadata line is the night. */}
            {card.coverMediaIds.length > 0 ? (
              <CoverStrip card={card} />
            ) : null}
            <div className="px-4 py-3">
              <p className="font-display text-base truncate">
                {card.title ?? 'Night out'}
              </p>
              <p className="text-muted text-xs mt-1 truncate">
                {savedNightSummary(card)}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Up to three photos across the top of a card. */
function CoverStrip({ card }: { card: SavedNightCard }): JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-px bg-border" aria-hidden="true">
      {card.coverMediaIds.slice(0, 3).map((mediaId) => (
        <MediaThumb
          key={mediaId}
          mediaId={mediaId}
          alt=""
          className="aspect-square w-full"
        />
      ))}
    </div>
  );
}
