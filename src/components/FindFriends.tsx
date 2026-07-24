'use client';

/**
 * FindFriends — signed-in friend search on /friends (B3).
 *
 * Debounced handle search against the `search_handles` RPC (B2 surface),
 * with follow/unfollow via useFollows' server mode (0007 RPCs). Search is
 * best-effort UX: an RPC failure shows a soft error, never a broken page.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { searchHandles, type HandleSearchResult } from '@/lib/profile.server';

const SEARCH_DEBOUNCE_MS = 400;

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'results'; results: HandleSearchResult[] }
  | { kind: 'error' };

type Props = {
  isFollowing: (handle: string) => boolean;
  /** True when a follow request to this handle awaits consent (B3b). */
  isRequested: (handle: string) => boolean;
  toggleFollow: (handle: string) => void;
};

export default function FindFriends({
  isFollowing,
  isRequested,
  toggleFollow,
}: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'idle' });

  // Debounced search. Cancelled-flag guard keeps a slow older response from
  // overwriting the state for newer input (ClaimHandle pattern).
  useEffect(() => {
    const cleaned = query.trim().replace(/^@/, '').toLowerCase();
    if (cleaned === '') {
      setState({ kind: 'idle' });
      return;
    }

    let cancelled = false;
    setState({ kind: 'searching' });
    const timer = setTimeout(async () => {
      const supabase = getBrowserSupabase();
      if (!supabase) return;
      const results = await searchHandles(supabase, cleaned);
      if (cancelled) return;
      if (results === null) {
        setState({ kind: 'error' });
        return;
      }
      setState({ kind: 'results', results });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div>
      <label htmlFor="friend-search" className="sr-only">
        Search by username
      </label>
      <input
        id="friend-search"
        type="search"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="Search @username…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full bg-surface border border-border rounded-2xl px-4 py-3 text-base text-text placeholder:text-muted focus:outline-none focus:border-accent min-h-[44px]"
      />

      <div className="mt-4 space-y-3">
        {state.kind === 'idle' ? (
          <p className="text-muted text-sm px-1">
            Search by @username to find friends who are already on Next Bar.
          </p>
        ) : state.kind === 'searching' ? (
          <p className="text-muted text-sm px-1" role="status">
            Searching…
          </p>
        ) : state.kind === 'error' ? (
          <p className="text-muted text-sm px-1" role="status">
            Search isn&apos;t available right now — try again in a moment.
          </p>
        ) : state.results.length === 0 ? (
          <p className="text-muted text-sm px-1">
            No one matching &quot;{query.trim()}&quot; yet. Exact usernames
            work too — private profiles only appear on an exact match.
          </p>
        ) : (
          state.results.map((r) => {
            const following = isFollowing(r.handle);
            // Pending request to a private account — tap withdraws (B3b).
            const pending = !following && isRequested(r.handle);
            return (
              <div
                key={r.handle}
                className="flex items-center justify-between gap-3 bg-surface border border-border rounded-2xl p-3"
              >
                <Link href={`/u/${r.handle}`} className="min-w-0 flex-1">
                  <p className="font-display text-sm truncate">
                    {r.displayName ?? `@${r.handle}`}
                  </p>
                  <p className="text-muted text-xs truncate">@{r.handle}</p>
                </Link>
                <button
                  type="button"
                  aria-pressed={following || pending}
                  onClick={() => toggleFollow(r.handle)}
                  className={[
                    'shrink-0 min-h-[36px] touch-manipulation px-4 rounded-full text-sm font-display border transition-colors',
                    following || pending
                      ? 'bg-transparent border-border text-muted hover:text-text'
                      : 'bg-accent border-accent text-bg',
                  ].join(' ')}
                >
                  {following ? 'Following' : pending ? 'Requested' : 'Follow'}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
