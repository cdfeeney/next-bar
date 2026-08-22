'use client';

import { useMemo, useState } from 'react';
import TonightPresence from './_components/TonightPresence';
import PlansSection from './_components/PlansSection';
import FeedSection from './_components/FeedSection';
import GroupsAndPeople, {
  GROUPS_AND_PEOPLE_ID,
} from './_components/GroupsAndPeople';
import { usePinnedHandles } from './_components/usePinnedHandles';
import AddStoryFlow from '@/components/story/AddStoryFlow';
import StoriesRail from '@/components/story/StoriesRail';
import StoryViewer, { type StoryOrigin } from '@/components/story/StoryViewer';
import {
  saveReply,
  useStories,
  VIEWER_HANDLE,
} from '@/components/story/storyStore';
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
 * `Groups & people` stays what the Wave-1 surface made it — one control that
 * reveals the people graph — and now selects Tonight before scrolling to it,
 * because the section it targets belongs to that sub-tab.
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
  // Night-scoped header line, on the shared clock signal so it re-labels at
  // the 6am rollover without a reload.
  const [night, setNight] = useState(() => nycNightKey());
  useNightRefresh(() => setNight(nycNightKey()));

  const [tab, setTab] = useState<Tab>('tonight');
  const [viewer, setViewer] = useState<
    { handle: string; origin: StoryOrigin } | null
  >(null);
  const [addingStory, setAddingStory] = useState(false);

  const you = {
    handle: VIEWER_HANDLE,
    name: 'You',
    initials: initialsFor(auth.status === 'signed-in' ? auth.user.email : null),
  };
  const stories = useStories(you);
  const pinnedHandles = usePinnedHandles();
  // The queue only ever contains people who have something to show. Memoised
  // so the viewer's navigation callbacks are not rebuilt on every render.
  const queue = useMemo(
    () => stories.groups.filter((group) => group.items.length > 0),
    [stories.groups],
  );

  const openStories = (handle: string): void => {
    setViewer({ handle, origin: tab === 'feed' ? 'feed' : 'tonight' });
  };

  const rail = (
    <StoriesRail
      groups={stories.groups}
      pinnedHandles={pinnedHandles}
      onOpen={openStories}
      onAddStory={() => setAddingStory(true)}
    />
  );

  return (
    <main className="min-h-screen pb-28">
      <header className="px-6 pt-8 pb-4 max-w-md mx-auto w-full flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl uppercase tracking-[0.14em]">
            Next Bar
          </h1>
          <p className="text-muted text-sm mt-1">{weekdayOf(night)}</p>
        </div>
        {/* The canvas's one header control. It selects Tonight first: the
            people graph is a section of that sub-tab, and scrolling to an
            anchor on a panel that is not rendered would go nowhere. */}
        <button
          type="button"
          onClick={() => {
            setTab('tonight');
            requestAnimationFrame(() => {
              document.getElementById(GROUPS_AND_PEOPLE_ID)?.scrollIntoView();
            });
          }}
          className="shrink-0 flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 min-h-[44px] touch-manipulation text-[11px] font-display uppercase tracking-widest text-text hover:border-accent transition-colors"
        >
          Groups &amp; people
          {requests.length > 0 ? (
            <span className="rounded-full bg-accent text-bg px-2 py-0.5 text-[11px] tabular-nums">
              {requests.length}
              <span className="sr-only"> follow requests waiting</span>
            </span>
          ) : null}
        </button>
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
              onClick={() => setTab(entry.id)}
              className={[
                'flex-1 min-h-[44px] rounded-xl font-display text-xs uppercase tracking-widest touch-manipulation transition-colors',
                tab === entry.id
                  ? 'bg-accent text-bg'
                  : 'text-muted hover:text-text',
              ].join(' ')}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-md mx-auto px-6 mt-6 space-y-10">
        {tab === 'tonight' ? (
          <Panel id="tonight">
            {rail}
            <TonightPresence />
            <GroupsAndPeople />
          </Panel>
        ) : null}

        {tab === 'plans' ? (
          <Panel id="plans">
            <PlansSection />
          </Panel>
        ) : null}

        {tab === 'feed' ? (
          <Panel id="feed">
            {rail}
            <FeedSection entries={stories.feed} onReply={saveReply} />
          </Panel>
        ) : null}
      </div>

      {viewer !== null && queue.length > 0 ? (
        <StoryViewer
          groups={queue}
          startHandle={viewer.handle}
          youHandle={you.handle}
          onClose={() => setViewer(null)}
          onExhausted={() => {
            setViewer(null);
            setTab('tonight');
          }}
          onMarkSeen={stories.markSeen}
          onUntagMe={stories.untagMe}
          onReply={saveReply}
        />
      ) : null}

      {addingStory ? (
        <AddStoryFlow
          onCancel={() => setAddingStory(false)}
          onPosted={stories.addItem}
          onUndo={stories.removeItem}
          onViewStory={() => {
            setAddingStory(false);
            setViewer({ handle: you.handle, origin: 'tonight' });
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

/** "CF" from an email local part; a stable placeholder when signed out. */
function initialsFor(email: string | null | undefined): string {
  const local = email?.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return 'YO';
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
