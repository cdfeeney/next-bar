'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import Avatar from '@/components/Avatar';
import BarVisualTile from '@/components/BarVisualTile';
import ShareButton from '@/components/ShareButton';
import { getBarById } from '@/lib/catalog';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { fetchSharedNight, type SharedNight } from '@/lib/nights.server';
import { buildNightPath, shareNightText } from '@/lib/share';
import { useAuth } from '@/hooks/useAuth';
import { useFollows } from '@/hooks/useFollows';

const BarMap = dynamic(() => import('@/components/BarMap'), { ssr: false });

/**
 * /u/[handle]/night/[shareId] — a shared night, viewable by ANYONE with
 * the link, no account (E4.4, the K-factor surface). The shareId is the
 * bearer token; the handle in the URL is display-only and must match the
 * payload (a rewritten handle must not re-attribute someone's night).
 *
 * Recipient CTAs: follow (signed-in) / get the app (signed-out), plus
 * share-onward — a link that can't travel further is a dead end for the
 * loop, not just the user (R5).
 */

type NightState =
  | { kind: 'loading' }
  | { kind: 'gone' }
  | { kind: 'ready'; night: SharedNight };

/** '2026-07-25' → 'Friday, July 25' — parsed as calendar parts so the
 *  label never shifts a day across timezones. */
function nightDateLabel(nightKey: string): string {
  const [y, m, d] = nightKey.split('-').map(Number);
  if (!y || !m || !d) return nightKey;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function initialsFor(night: SharedNight): string {
  const source = night.displayName ?? night.handle;
  const words = source.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export default function SharedNightPage({
  params,
}: {
  params: { handle: string; shareId: string };
}): JSX.Element {
  const auth = useAuth();
  const { isFollowing, toggleFollow } = useFollows();
  const [state, setState] = useState<NightState>({ kind: 'loading' });
  // Decode once; every use below (fetch, spoof check, share-onward link)
  // works from the same decoded values (review LOW).
  const shareId = decodeURIComponent(params.shareId);
  const urlHandle = decodeURIComponent(params.handle);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setState({ kind: 'gone' });
      return;
    }
    let cancelled = false;
    void (async () => {
      const night = await fetchSharedNight(supabase, shareId);
      if (cancelled) return;
      // URL-handle honesty: the payload's handle is authoritative; a link
      // rewritten to someone else's handle reads as gone, never as theirs.
      if (night && night.handle.toLowerCase() !== urlHandle.toLowerCase()) {
        setState({ kind: 'gone' });
        return;
      }
      setState(night ? { kind: 'ready', night } : { kind: 'gone' });
    })();
    return () => {
      cancelled = true;
    };
  }, [shareId, urlHandle]);

  if (state.kind === 'loading') {
    return (
      <main className="min-h-screen pb-28 flex items-center justify-center">
        <p className="text-muted text-sm" role="status">
          Loading night…
        </p>
      </main>
    );
  }

  if (state.kind === 'gone') {
    // Friendly terminal state (R5): unshared/unknown links get a forward
    // path, not a bare 404.
    return (
      <main className="min-h-screen flex flex-col items-center justify-center text-center px-6 pb-28">
        <h1 className="font-display text-2xl mb-2">This night isn&apos;t here.</h1>
        <p className="text-muted text-sm mb-6 max-w-sm leading-relaxed">
          The link may have been unshared, or it never existed. Nights on
          Next Bar are private unless their owner shares them.
        </p>
        <Link
          href="/"
          className="bg-accent text-bg rounded-full px-6 py-3 min-h-[44px] touch-manipulation font-display inline-flex items-center justify-center"
        >
          Find your next bar →
        </Link>
      </main>
    );
  }

  const night = state.night;
  const bars = night.barIds
    .map((id) => getBarById(id))
    .filter((b): b is NonNullable<ReturnType<typeof getBarById>> => b != null);
  const loved = night.lovedBarId ? getBarById(night.lovedBarId) : null;
  const who = night.displayName ?? `@${night.handle}`;
  const signedIn = auth.status === 'signed-in';
  const following = isFollowing(night.handle);

  return (
    <main className="min-h-screen pb-28">
      <section className="max-w-md mx-auto px-6 pt-10">
        <div className="flex flex-col items-center text-center">
          <Avatar initials={initialsFor(night)} seed={night.handle} size="lg" />
          <p className="text-accent uppercase tracking-[0.25em] text-xs mt-5">
            {nightDateLabel(night.night)}
          </p>
          <h1 className="font-display text-3xl mt-2">
            {who}&apos;s night out
          </h1>
          <p className="text-muted text-sm mt-1">
            @{night.handle} ·{' '}
            {bars.length === 1 ? 'one stop' : `${bars.length} stops`}
            {loved ? ` · loved ${loved.name}` : ''}
          </p>

          <div className="flex items-center gap-3 mt-6 flex-wrap justify-center">
            {signedIn ? (
              <button
                type="button"
                aria-pressed={following}
                onClick={() => toggleFollow(night.handle)}
                className={[
                  'min-h-[44px] touch-manipulation px-6 rounded-full font-display text-sm border transition-colors',
                  following
                    ? 'bg-transparent border-border text-muted hover:text-text'
                    : 'bg-accent border-accent text-bg',
                ].join(' ')}
              >
                {following ? 'Following' : `Follow @${night.handle}`}
              </button>
            ) : (
              <Link
                href="/install"
                className="min-h-[44px] touch-manipulation px-6 rounded-full font-display text-sm bg-accent border border-accent text-bg inline-flex items-center"
              >
                Get Next Bar →
              </Link>
            )}
            <ShareButton
              path={buildNightPath(night.handle, shareId)}
              text={shareNightText(night.handle, night.displayName, bars.length)}
              label="Share"
              ariaLabel={`Share ${who}'s night`}
            />
          </div>
        </div>

        <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mt-12 mb-4">
          The route
        </h2>
        {bars.length === 0 ? (
          <p className="text-muted text-sm text-center">
            The bars from this night have left the catalog.
          </p>
        ) : (
          <>
            {/* g-919dae84 crit 5: the night's map — recap's own treatment.
                ROUTE BARS ONLY, deliberately: no viewer location, no
                personal pins, no personal photos on an anonymous page
                (crit 9) — the pins are the same public venues the list
                below already names. */}
            <div
              className="h-48 rounded-2xl overflow-hidden border border-border mb-4"
              data-testid="shared-night-map"
            >
              <BarMap
                bars={bars}
                fitToBars
                highlightIds={loved ? [loved.id] : []}
              />
            </div>
          <ol className="flex flex-col gap-3">
            {bars.map((bar, i) => (
              <li
                key={`${bar.id}-${i}`}
                className="bg-surface border border-border rounded-3xl p-4 flex items-center gap-3"
              >
                <span className="text-accent text-sm font-display w-5 shrink-0 tabular-nums">
                  {i + 1}
                </span>
                <BarVisualTile bar={bar} size={56} />
                <span className="flex-1 min-w-0">
                  <span className="block font-display text-lg leading-tight truncate">
                    {bar.name}
                    {loved?.id === bar.id ? (
                      <span className="text-accent" aria-hidden="true">
                        {' '}
                        ♥
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-muted text-xs uppercase tracking-wider mt-0.5">
                    {bar.neighborhood} · {'$'.repeat(bar.priceTier)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          </>
        )}

        <p className="text-muted text-xs text-center mt-8 leading-relaxed">
          Nights on Next Bar are private unless shared. Make your own —
          the app writes the recap for you.
        </p>
      </section>
    </main>
  );
}
