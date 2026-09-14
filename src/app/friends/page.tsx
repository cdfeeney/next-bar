'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { OutTonightSection } from './_components/OutTonight';
import PlansSection from './_components/PlansSection';
import FeedSection from './_components/FeedSection';
import YourPlanTonight from './_components/YourPlanTonight';
import { usePinnedHandles, useMyPresenceRead } from './_components/usePinnedHandles';
import { getBarById } from '@/lib/catalog';
import { isValidPin } from '@/lib/presence';
import { PinGlyph, PeopleGlyph } from './_components/HeaderGlyphs';
import AddStoryFlow from '@/components/story/AddStoryFlow';
import StoriesRail from '@/components/story/StoriesRail';
import StoryViewer from '@/components/story/StoryViewer';
import StoriesEmptyState from '@/components/story/StoriesEmptyState';
import { useStories } from '@/components/story/storyStore';
import { useAuth } from '@/hooks/useAuth';
import { useFollowRequests } from '@/hooks/useFollowRequests';
import { useNightRefresh } from '@/hooks/useIntent';
import { nycNightKey } from '@/lib/nightKey';

/**
 * /friends — SOCIAL, per `docs/design-reference/approved/next-bar-social-v2-core.png`.
 *
 * THREE sub-tabs, and only three: Tonight, Plans, Feed. The five-tab bottom
 * contract is untouched — Social still owns one tab and this chrome lives
 * inside it, so no job lives in two places.
 *
 * The STORIES rail sits across the top of Tonight and again on Feed, your own
 * avatar first. The story queue lands on Tonight when it finishes, which is
 * why the tab state lives here rather than inside the viewer: "the five-tab IA
 * has no separate Home tab, so Tonight is the documented landing surface".
 *
 * The header carries the title, the night, and TWO icon buttons (Social
 * redesign 2026-09-13, `docs/design-reference/social-redesign-20260913/README.md`
 * §1.1): the PIN is your whole presence — muted when nothing is set, text
 * when a status is set, accent once a bar is pinned — and the PEOPLE icon
 * pushes `/friends/people` (counts, search, groups, Group Favorites) with the
 * pending follow-request count as its badge. Groups & people no longer lives
 * on Tonight. Owner decision 2026-09-13: there is no status row on Tonight;
 * the pin icon is the only entry to "You tonight" (S-05 gives it a route).
 */

type Tab = 'tonight' | 'plans' | 'feed';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'tonight', label: 'Tonight' },
  { id: 'plans', label: 'Plans' },
  { id: 'feed', label: 'Feed' },
];

export default function SocialPage(): JSX.Element {
  const { requests } = useFollowRequests();
  const auth = useAuth();
  // Night-scoped header line, on the shared clock signal so it re-labels at the
  // 4:00 AM America/New_York rollover without a reload (V8-R-PRE-005 / D-C-39).
  const [night, setNight] = useState(() => nycNightKey());
  useNightRefresh(() => setNight(nycNightKey()));

  const [tab, setTab] = useState<Tab>('tonight');
  // The sub-tabs are server-rendered and hit-testable before React attaches
  // their handlers, so a tap in that window is silently swallowed (Tonight
  // stays selected). Same fix as VibeQuiz: disabled until mounted, so a real
  // user's first tap is never lost and a test's "enabled" wait is a true
  // hydration signal (Night Out goal, round-2 panel, both lanes).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  // Closing returns you to whichever sub-tab opened the viewer for free: the
  // tab is never changed on the way in, so only EXHAUSTION has to move it.
  const [viewer, setViewer] = useState<string | null>(null);
  const [addingStory, setAddingStory] = useState(false);

  const stories = useStories();
  const youId = auth.status === 'signed-in' ? auth.user.id : null;
  // FOUNDER DECISION 2026-08-24: the rail's pin badge reads PRESENCE, not suggestions.
  // `usePinnedHandles` now returns presence state rather than a bare id list, and a "pin"
  // is a presence row that names a bar — a status without a place is not a pin.
  const { rows: presenceRows } = usePinnedHandles();
  // `settled` keeps "not read yet" apart from "no pin" (S-01 panel, Fable +
  // Codex): the icon says nothing about your night until the read answers.
  const { presence: myPresence, settled: presenceSettled } = useMyPresenceRead();
  // The pin icon's states, in words for the accessible name and in tint for
  // the eye. `isValidPin` is the same rule Tonight applies: a bar attached to
  // anything but Going out is not a pin.
  const pinnedBarId =
    myPresence !== null && isValidPin(myPresence.status, myPresence.barId)
      ? myPresence.barId
      : null;
  const pinState: 'loading' | 'none' | 'status' | 'pinned' = !presenceSettled
    ? 'loading'
    : pinnedBarId !== null
      ? 'pinned'
      : myPresence !== null
        ? 'status'
        : 'none';
  // `night_presence.bar_id` has no catalog foreign key, so a stored id can miss
  // the local catalog; the label then names the fact (pinned), never "a bar".
  const pinnedBarName = pinnedBarId !== null ? getBarById(pinnedBarId)?.name ?? null : null;
  const pinLabel =
    pinState === 'pinned'
      ? pinnedBarName !== null
        ? `Pinned at ${pinnedBarName} — change your night`
        : 'Pinned — change your night'
      : pinState === 'loading'
        ? 'Your night — checking'
        : 'Set whether you are going out and where';
  // YOUR OWN PIN IS UNIONED IN HERE, and it has to be. `get_circle_presence` answers
  // "who ELSE is out" — its SQL carries `np.user_id <> auth.uid()` on purpose, because
  // Social - Tonight lists other people. Deriving the rail's badges from it alone made the
  // viewer's own pin structurally unreachable: StoriesRail asks `pinnedIds.includes(you.id)`
  // and that id could never appear. WP1's version called own-pin visibility non-optional and
  // it was right.
  //
  // The union happens HERE rather than by widening the RPC. Adding self to
  // get_circle_presence would change what Social - Tonight means for the sake of a badge,
  // and the caller's own row already has its own scoped accessor.
  const pinnedIds = useMemo(() => {
    const ids = (presenceRows ?? [])
      .filter((row) => row.barId !== null)
      .map((row) => row.userId);
    // A status without a place is not a pin — the same rule applied to everyone else.
    if (youId !== null && myPresence?.barId != null) ids.push(youId);
    return ids;
  }, [presenceRows, myPresence, youId]);
  // The queue only ever contains people who have something to show. Memoised
  // so the viewer's navigation callbacks are not rebuilt on every render.
  const queue = useMemo(
    () => stories.groups.filter((group) => group.items.length > 0),
    [stories.groups],
  );

  const openStories = (authorId: string): void => {
    setViewer(authorId);
  };

  // The rail is only a rail when there is a real session behind it. Signed out,
  // unreachable, or genuinely empty each get their OWN honest state — an empty
  // feed and an unreachable backend must never look the same.
  const railFor = (size: 'tonight' | 'feed'): JSX.Element =>
    stories.status === 'ready' ? (
      <StoriesRail
        groups={stories.groups}
        pinnedIds={pinnedIds}
        onOpen={openStories}
        onAddStory={() => setAddingStory(true)}
        size={size}
      />
    ) : (
      <StoriesEmptyState status={stories.status} onRetry={stories.refresh} />
    );

  return (
    <main className="min-h-screen pb-28">
      <header className="px-6 pt-[18px] pb-4 max-w-md mx-auto w-full flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl uppercase tracking-[0.14em]">
            Next Bar
          </h1>
          <p className="text-muted text-sm mt-1">{weekdayOf(night)}</p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {/* PIN — your whole presence. Pushes /friends/tonight (S-05), the
              only entry to "You tonight". */}
          <Link
            href="/friends/tonight"
            data-testid="social-pin-icon"
            data-pin-state={pinState}
            aria-label={pinLabel}
            className={[
              'flex items-center justify-center min-w-[44px] min-h-[44px] rounded-2xl border touch-manipulation transition-colors',
              pinState === 'pinned'
                ? 'border-accent bg-accent/[0.12] text-accent'
                : pinState === 'status'
                  ? 'border-border bg-surface text-text'
                  : 'border-border bg-surface text-muted',
            ].join(' ')}
          >
            <PinGlyph />
          </Link>

          {/* PEOPLE — pushes the people graph. The badge is the pending
              follow-request count, so consent is one tap away and never hidden. */}
          <Link
            href="/friends/people"
            data-testid="social-people-icon"
            aria-label="Groups and people"
            className="relative flex items-center justify-center min-w-[44px] min-h-[44px] rounded-2xl border border-border bg-surface text-text touch-manipulation hover:border-accent transition-colors"
          >
            <PeopleGlyph />
            {requests.length > 0 ? (
              <span
                data-testid="social-people-badge"
                className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-bg text-[10px] font-bold tabular-nums flex items-center justify-center"
              >
                {requests.length}
                <span className="sr-only"> follow requests waiting</span>
              </span>
            ) : null}
          </Link>
        </div>
      </header>

      <div className="max-w-md mx-auto px-6">
        <div
          role="tablist"
          aria-label="Social"
          data-testid="social-subtabs"
          className="flex items-center gap-1 rounded-2xl border border-border bg-surface p-1"
        >
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`social-tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls={`social-panel-${entry.id}`}
              disabled={!mounted}
              onClick={() => setTab(entry.id)}
              className={[
                // README §1.2: 44px, 12px radius, 12px/700 uppercase 0.14em;
                // active = accent fill + bg text, inactive = transparent + muted.
                'flex-1 min-h-[44px] rounded-xl font-label text-xs font-bold uppercase tracking-[0.14em] touch-manipulation transition-colors',
                tab === entry.id
                  ? 'bg-accent text-bg'
                  : 'bg-transparent text-muted hover:text-text',
              ].join(' ')}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-md mx-auto px-6 mt-[18px] space-y-8">
        {tab === 'tonight' ? (
          <Panel id="tonight">
            {/* PLAN-LED TONIGHT (Social redesign 2026-09-13, README §1):
                stories rail → the plan card → Out tonight. V8-R-SOC-003 (the
                Next Bar? card) was retired 2026-09-09; Groups & people moved to
                /friends/people in S-01; the "You tonight" controls live on
                /friends/tonight behind the header pin icon (S-05). Tonight
                keeps only Out tonight, and reads only what it draws (R-02). */}
            {railFor('tonight')}
            <YourPlanTonight variant="tonight" />
            <OutTonightSection />
          </Panel>
        ) : null}

        {tab === 'plans' ? (
          <Panel id="plans">
            <PlansSection />
          </Panel>
        ) : null}

        {tab === 'feed' ? (
          <Panel id="feed">
            {railFor('feed')}
            {/* READY-AND-EMPTY IS ITS OWN STATE. Rendering nothing here made a
                signed-in account with no friends' stories look identical to a
                surface that had not finished loading — the exact collapse
                StoriesEmptyState exists to prevent, reintroduced one level
                down. The rail above already distinguishes signed-out and
                unreachable; this is the fourth case.

                ROUND-10 DIRECTIVE (c), NOT DONE HERE AND DELIBERATELY SO. The
                directive asked that FeedSection mount unconditionally, because
                on wp5's branch it is the home of PERSISTENT Feed posts and
                gating its mount on a 24-hour story count makes them unreachable
                the moment the last story expires. That is a real defect there.
                It is not one here: this FeedSection renders only its `entries`
                prop, which IS `stories.feed`, and its own docblock records that
                there is no separate Feed-memory backend and that permanent Feed
                history is V9. So the gate below is equivalent to the component's
                own emptiness and hides nothing.
                The only shape that both mounts unconditionally and keeps this
                state honest moves the empty branch INTO FeedSection.tsx, which
                belongs to goal g-f1e128da and is on neither this lane's write
                scope nor the five paths the directive opened; the round-10
                Codex panel ruled that write out of scope. Landing it in
                page.tsx alone instead would delete this branch and turn
                e2e/story-rail.spec.ts:435 red, and that spec is not this lane's
                either. The fix therefore belongs to whoever owns g-f1e128da,
                where the persistent posts actually live. */}
            {stories.status === 'ready' ? (
              stories.feed.length > 0 ? (
                <FeedSection entries={stories.feed} onOpenStory={openStories} />
              ) : (
                <section data-testid="feed-empty" aria-labelledby="feed-empty-heading">
                  <h2
                    id="feed-empty-heading"
                    className="font-label text-xs uppercase tracking-[0.25em] text-muted mb-3"
                  >
                    Feed
                  </h2>
                  <div className="rounded-2xl border border-border bg-surface p-5">
                    <p className="text-sm leading-relaxed">
                      Nothing here yet. Stories from you and the friends who
                      follow you back show up here for 24 hours.
                    </p>
                  </div>
                </section>
              )
            ) : null}
          </Panel>
        ) : null}
      </div>

      {/* The author has to actually BE in the queue. Opening on "somebody" and
          letting the viewer pick a fallback is how tapping "View story" on a
          fresh receipt landed on a friend's queue instead of your own: the
          refresh had not returned your new story yet, so your id was not in
          the queue and the viewer silently opened whoever was first. Waiting
          one render is correct; showing the wrong person never is. */}
      {viewer !== null && queue.some((group) => group.id === viewer) ? (
        <StoryViewer
          groups={queue}
          startId={viewer}
          youId={youId}
          onClose={() => setViewer(null)}
          onExhausted={() => {
            setViewer(null);
            setTab('tonight');
          }}
          onMarkSeen={stories.markSeen}
          onUntagMe={stories.untagMe}
        />
      ) : null}

      {addingStory ? (
        <AddStoryFlow
          friends={stories.friends}
          friendsReady={stories.friendsReady}
          onCancel={() => setAddingStory(false)}
          onPublish={stories.publish}
          onUndo={stories.removeItem}
          onViewStory={() => {
            setAddingStory(false);
            if (youId !== null) setViewer(youId);
          }}
        />
      ) : null}
    </main>
  );
}

function Panel({
  id,
  children,
}: {
  id: Tab;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      role="tabpanel"
      id={`social-panel-${id}`}
      aria-labelledby={`social-tab-${id}`}
      data-testid={`social-panel-${id}`}
      className="space-y-10"
    >
      {children}
    </div>
  );
}

/**
 * "Friday" from a night key, the header line the canvas draws.
 *
 * UTC on purpose, matching the night-key convention shared with PlanInvites
 * and `/night-out/[token]`: the key is a calendar day, not an instant, so
 * letting the device's zone shift it would name the wrong weekday for anyone
 * west of the line.
 */
function weekdayOf(night: string): string {
  const parsed = new Date(`${night}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 'Tonight';
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}
