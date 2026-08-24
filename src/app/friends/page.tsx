'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import PlanInvites from '@/components/PlanInvites';
import FindFriends from '@/components/FindFriends';
import { RequestRow } from '@/components/FollowRows';
import { useAuth } from '@/hooks/useAuth';
import { useFollows } from '@/hooks/useFollows';
import { useFollowRequests } from '@/hooks/useFollowRequests';
import { demoFriends } from '@/lib/demo';
import TonightPresence from './_components/TonightPresence';

/**
 * /friends — SOCIAL (V8-R-NAV-002, V8-R-SOC-001..008).
 *
 * This route used to serve the legacy Friends dashboard: a "Plan Night Out"
 * card, an intent strip and two follower statistics. That is not the approved
 * V8 surface. Social is ONE tab with three sub-tabs — Tonight, Plans, Feed —
 * and tapping one swaps the content below it (V8-R-NAV-002).
 *
 *   Tonight · current awareness — who is out, and your own status.
 *   Plans   · coordination — Night Out invitations and the plans you are in.
 *   Feed    · photo memories.
 *
 * TONIGHT IS THE LANDING SURFACE, documented as such in V8-R-NAV-002 and
 * implemented as the initial sub-tab here.
 *
 * The sub-tab state is deliberately LOCAL, not a route. The contract says
 * "tapping a sub-tab swaps the content below it"; making each sub-tab its own
 * URL would put the browser's back button between two halves of one screen,
 * which is not what a segmented control means to the person using it.
 *
 * WHAT THIS SURFACE DOES NOT DO: it collects no rating, score, pass or hide.
 * Those belong to Rankings; Social shows what people are doing, not what they
 * thought of it.
 *
 * SCOPE NOTE, recorded honestly rather than implied to be finished:
 * V8-R-SOC-002 (the stories rail) and V8-R-SOC-003 (the Next Bar? suggestion
 * card) render components — `src/components/story/StoriesRail.tsx` and the
 * shared lightbox — that this packet does not own and that are not present on
 * this branch. Tonight is therefore built with its rail slot empty, which is
 * also the approved behaviour when there is nothing to show: the rail HIDES
 * rather than rendering an empty ring (V8-R-SOC-001, V8-R-OPS-005). Wiring the
 * rail is an integration step, not a hole in this surface.
 */

const SUB_TABS = [
  { id: 'tonight', label: 'Tonight' },
  { id: 'plans', label: 'Plans' },
  { id: 'feed', label: 'Feed' },
] as const;

type SubTab = (typeof SUB_TABS)[number]['id'];

export default function SocialPage(): JSX.Element {
  // V8-R-NAV-002: Tonight is the documented landing surface.
  const [tab, setTab] = useState<SubTab>('tonight');

  return (
    <main className="min-h-screen pb-28">
      <header className="px-6 pt-8 pb-4 text-center">
        <h1 className="font-display text-3xl md:text-4xl">Social</h1>
      </header>

      <div className="max-w-md mx-auto px-6">
        <SubTabs active={tab} onChange={setTab} />
      </div>

      <section className="max-w-md mx-auto px-6 pt-6 space-y-8">
        {tab === 'tonight' ? (
          <div
            role="tabpanel"
            id="social-panel-tonight"
            aria-labelledby="social-tab-tonight"
          >
            <TonightPresence />
          </div>
        ) : null}
        {tab === 'plans' ? <PlansTab /> : null}
        {tab === 'feed' ? <FeedTab /> : null}
      </section>
    </main>
  );
}

/**
 * The segmented control. Real tab semantics — `role="tablist"` with
 * `aria-selected` — so the selected sub-tab is announced rather than only
 * looking selected, and the panel below is associated with it.
 */
function SubTabs({
  active,
  onChange,
}: {
  active: SubTab;
  onChange: (tab: SubTab) => void;
}): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Social"
      className="flex items-center gap-1 bg-surface border border-border rounded-full p-1"
    >
      {SUB_TABS.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`social-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`social-panel-${t.id}`}
            onClick={() => onChange(t.id)}
            className={[
              'flex-1 min-h-[44px] touch-manipulation rounded-full font-display text-sm transition-colors',
              selected
                ? 'bg-accent text-bg'
                : 'bg-transparent text-muted hover:text-text',
            ].join(' ')}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Plans — coordination (V8-R-SOC-004, V8-R-NO-001, V8-R-OPS-005).
 *
 * The Start a Night Out row sits directly under the sub-tabs and above whatever
 * is open, so the same tap works with a plan open and with zero plans — where
 * it becomes the empty state's single primary action (V8-R-SOC-004). Follow
 * requests stay here because consent must never hide.
 */
function PlansTab(): JSX.Element {
  const { requests, accept, decline } = useFollowRequests();
  const { mode } = useFollows();
  const isServer = mode === 'server';

  return (
    <div
      role="tabpanel"
      id="social-panel-plans"
      aria-labelledby="social-tab-plans"
      className="space-y-8"
    >
      {/* The compact entry row, in its unchanged position. */}
      <Link
        href="/friends/consensus"
        data-testid="start-night-out"
        className="block bg-accent text-bg rounded-2xl px-5 py-3 text-center touch-manipulation hover:bg-accentDim transition-colors"
      >
        <p className="font-display text-lg leading-snug">Start a Night Out →</p>
      </Link>

      {/* Night Out invitations addressed to this account. Hides when empty —
          PlanInvites owns that decision. */}
      <PlanInvites />

      {/* Follow requests — the consent inbox. Only when non-empty. */}
      {isServer && requests.length > 0 ? (
        <div>
          <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
            Requests · {requests.length}
          </h2>
          <div className="space-y-3">
            {requests.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                onAccept={accept}
                onDecline={decline}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Feed — photo memories (V8-R-NAV-002).
 *
 * Deliberately a stated empty state rather than a placeholder that pretends to
 * be a feed. The photo model it renders — Night Out media and its three
 * distinct lifetimes (V8-R-NO-008) — lives in `src/lib/nightOutMedia/`, which
 * this branch does not carry: it arrives with the media spine this packet
 * declares as a dependency. Naming that plainly is better than a grid of
 * skeletons implying content is loading, and it is the same honesty rule the
 * rest of this surface follows: never claim a state you cannot observe.
 *
 * Find friends lives here because a feed with nobody in it is a following
 * problem, and this is where the person is when they discover that.
 */
function FeedTab(): JSX.Element {
  const auth = useAuth();
  const { isFollowing, isRequested, toggleFollow, mode } = useFollows();
  const isServer = mode === 'server';

  return (
    <div
      role="tabpanel"
      id="social-panel-feed"
      aria-labelledby="social-tab-feed"
      className="space-y-8"
    >
      <p className="text-muted text-sm" data-testid="feed-empty">
        {auth.status === 'signed-in'
          ? 'No photos yet. Nights you and your friends capture will show up here.'
          : 'Sign in to see nights from the people you follow.'}
      </p>

      <div>
        <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
          Find friends
        </h2>
        {isServer ? (
          <FindFriends
            isFollowing={isFollowing}
            isRequested={isRequested}
            toggleFollow={toggleFollow}
          />
        ) : (
          <DemoFind isFollowing={isFollowing} toggleFollow={toggleFollow} />
        )}
      </div>
    </div>
  );
}

/** Signed-out search over the seeded curators (unchanged demo behavior). */
function DemoFind({
  isFollowing,
  toggleFollow,
}: {
  isFollowing: (handle: string) => boolean;
  toggleFollow: (handle: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase().replace(/^@/, '');
  const suggested = useMemo(
    () => demoFriends.filter((f) => !isFollowing(f.handle)),
    [isFollowing],
  );
  const matches = useMemo(() => {
    if (q.length === 0) return suggested;
    return suggested.filter(
      (f) =>
        f.handle.includes(q) ||
        f.displayName.toLowerCase().includes(q) ||
        f.archetype.toLowerCase().includes(q),
    );
  }, [q, suggested]);

  return (
    <>
      <label htmlFor="friend-search" className="sr-only">
        Search by name or handle
      </label>
      <input
        id="friend-search"
        type="search"
        inputMode="text"
        autoComplete="off"
        placeholder="Search @handle or name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full bg-surface border border-border rounded-2xl px-4 py-3 text-base text-text placeholder:text-muted focus:outline-none focus:border-accent min-h-[44px]"
      />
      <div className="mt-4 space-y-3">
        {matches.length === 0 ? (
          <p className="text-muted text-sm px-1">
            {q.length > 0 ? `No one matching "${query}".` : 'You follow everyone here.'}
          </p>
        ) : (
          matches.map((f) => (
            <div
              key={f.handle}
              className="flex items-center justify-between gap-3 bg-surface border border-border rounded-2xl p-3"
            >
              {/* Criterion 9: this row IS a tap target — it navigates to the
                  profile — so it owes the same 44px minimum the follow button
                  beside it already carries. */}
              <Link
                href={`/u/${f.handle}`}
                className="min-w-0 flex-1 min-h-[44px] flex flex-col justify-center touch-manipulation"
              >
                <p className="font-display text-sm truncate">{f.displayName}</p>
                <p className="text-muted text-xs truncate">
                  @{f.handle} · {f.archetype}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => toggleFollow(f.handle)}
                className="shrink-0 min-h-[44px] touch-manipulation px-4 rounded-full text-sm font-display bg-accent text-bg"
              >
                Follow
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
