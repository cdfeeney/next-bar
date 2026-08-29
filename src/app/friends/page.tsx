'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import TonightPresence from './_components/TonightPresence';
import PlansSection from './_components/PlansSection';
import FeedSection from './_components/FeedSection';
import GroupsAndPeople, {
  GROUPS_AND_PEOPLE_ID,
} from './_components/GroupsAndPeople';
import { usePinnedHandles, useMyPresence } from './_components/usePinnedHandles';
import AddStoryFlow from '@/components/story/AddStoryFlow';
import StoriesRail from '@/components/story/StoriesRail';
import StoryViewer from '@/components/story/StoryViewer';
import StoriesEmptyState from '@/components/story/StoriesEmptyState';
import { useStories } from '@/components/story/storyStore';
import { useAuth } from '@/hooks/useAuth';
import { useFollowRequests } from '@/hooks/useFollowRequests';
import { useNightRefresh } from '@/hooks/useIntent';
import { useSuggestions } from '@/hooks/useSuggestions';
import { nycNightKey } from '@/lib/nightKey';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';
import { getBarById } from '@/lib/catalog';
import { displayHood } from '@/lib/hoodDisplay';
import { displayTag } from '@/lib/tagDisplay';
import { haversineMiles } from '@/lib/distance';
import { leadCopy } from '@/lib/travelTime';
import { loadProfile } from '@/lib/storedProfile';
import type { Bar, Coords, VibeProfile } from '@/types';

// The lightbox is a full-screen panel with its own photo fetches; it has no
// business in the Tonight bundle until somebody opens it.
const BarLightbox = dynamic(() => import('@/components/BarLightbox'), {
  ssr: false,
});

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
  // Night-scoped header line, on the shared clock signal so it re-labels at the
  // 4:00 AM America/New_York rollover without a reload (V8-R-PRE-005 / D-C-39).
  const [night, setNight] = useState(() => nycNightKey());
  useNightRefresh(() => setNight(nycNightKey()));

  const [tab, setTab] = useState<Tab>('tonight');
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
  const myPresence = useMyPresence();
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
  const rail = stories.status === 'ready' ? (
    <StoriesRail
      groups={stories.groups}
      pinnedIds={pinnedIds}
      onOpen={openStories}
      onAddStory={() => setAddingStory(true)}
    />
  ) : (
    <StoriesEmptyState status={stories.status} onRetry={stories.refresh} />
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
            <NextBarCard />
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
            {/* FEEDSECTION MOUNTS WHENEVER THE PANEL HAS AN ANSWER, empty or
                not (round-10 directive (c), raised on wp5). Gating the MOUNT on
                `stories.feed.length > 0` makes every post the Feed will ever
                carry unreachable the moment the last entry drops out — today
                that emptiness is only a 24-hour story expiry, but the gate is
                on the component rather than on its content, so anything the
                Feed grows later inherits the same disappearance. The empty
                copy moved INSIDE FeedSection, which is the only place that can
                tell "read it, nothing there" from "did not render".

                READY-AND-EMPTY IS STILL ITS OWN STATE. Rendering nothing here
                made a signed-in account with no friends' stories look identical
                to a surface that had not finished loading — the exact collapse
                StoriesEmptyState exists to prevent, reintroduced one level
                down. The rail above already distinguishes signed-out and
                unreachable; this is the fourth case, and it is why the mount is
                still conditional on `status === 'ready'`: a feed we could not
                read must never be drawn as a feed with nothing in it. */}
            {stories.status === 'ready' ? (
              <FeedSection entries={stories.feed} onOpenStory={openStories} />
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
 * V8-R-SOC-003 — the Next Bar? card on Social · Tonight.
 *
 * "A compact card naming the suggested bar, walk time and quiet state, with one
 * Open action into the shared lightbox." Two states: suggestion present, and
 * none.
 *
 * IT RUNS THE SAME RANKER AS EVERYWHERE ELSE. `useSuggestions` is the shared
 * entry point to the matching pipeline the home flow and the map both use, so
 * Tonight cannot recommend a different bar from the rest of the app for the same
 * person on the same night. Taking the top of that ranking is the whole of the
 * "suggestion" here — this card owns no ranking logic of its own.
 *
 * THE LIGHTBOX IS THE SHARED ONE, unmodified. `BarLightbox`'s entire contract is
 * two props, deliberately, "so a map marker, a ranking row and a search result
 * can each pass the object they already hold" — and now a Tonight card too.
 *
 * NO LOCATION PROMPT. Social · Tonight is not a surface that should raise a
 * permission dialog on arrival, so distance comes from the saved profile's
 * preferred neighborhood, the way `ResultsView` resolves it without coords. With
 * no neighborhood either, `leadCopy` renders the honest "In …" line instead of a
 * walk time — a made-up number would be worse than none.
 */
function NextBarCard(): JSX.Element | null {
  const [profile, setProfile] = useState<VibeProfile | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [open, setOpen] = useState(false);

  // Client-side after mount, the same pattern WhereNextFlow and useSuggestions
  // use: a localStorage read during render is an SSR hydration mismatch.
  useEffect(() => {
    const saved = loadProfile();
    if (saved) {
      setProfile({
        tags: saved.tags,
        archetype: saved.archetype,
        preferredNeighborhoods: saved.preferredNeighborhoods,
      });
    }
    setProfileChecked(true);
  }, []);

  const from: Coords | null = useMemo(() => {
    const hood = profile?.preferredNeighborhoods?.[0];
    return hood ? NEIGHBORHOOD_CENTROIDS[hood] : null;
  }, [profile]);

  // One suggestion is all this card shows, so ask for one.
  const { suggestedIds } = useSuggestions(from, 1);
  const bar = suggestedIds[0] ? getBarById(suggestedIds[0]) : undefined;

  // NOTHING IS NOT AN EMPTY BOX. "none" is a real state in the contract, and the
  // honest rendering of it on a panel that already carries a rail, a pin row and
  // a circle list is to take up no room at all.
  if (!profileChecked || bar === undefined) return null;

  const miles =
    from !== null && bar.lat !== undefined && bar.lng !== undefined
      ? haversineMiles(from, { lat: bar.lat, lng: bar.lng })
      : null;
  const lead = leadCopy(miles, displayHood(bar.neighborhood));

  /**
   * THE MISSING WALK TIME SAYS IT IS MISSING (round-7 panel, Codex, MEDIUM).
   *
   * V8-R-SOC-003 names three things the card carries, and with no saved
   * neighborhood `leadCopy` falls back to "In <hood>" — an honest line, but one
   * that silently drops the walk time rather than accounting for it, so the
   * card looked complete while one of its three elements was simply gone.
   *
   * The fix is NOT to invent a distance, for exactly the reason `energyOf`
   * gives one line down: the app would be describing a trip it never measured.
   * This is the same third state that finding got in round 5 — say we do not
   * know, and name the one thing that would fill it in.
   */
  const walkNote = lead.kind === 'neighborhood' ? 'walk time needs your area' : null;

  return (
    <section data-testid="next-bar-card">
      <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
        Next Bar?
      </h2>
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-base truncate">{bar.name}</p>
          {/* Walk time and quiet state, both in WORDS, on one quiet line. */}
          <p className="text-muted text-xs truncate" data-testid="next-bar-line">
            {[lead.text, walkNote, energyOf(bar)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="next-bar-open"
          className="shrink-0 min-h-[44px] px-5 rounded-full border border-border font-display text-sm touch-manipulation hover:border-accent hover:text-accent transition-colors"
        >
          Open
        </button>
      </div>

      {open ? <BarLightbox bar={bar} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

/** The loud/quiet axis, ascending. `chill` is the quiet end. */
const ENERGY_TAGS = ['chill', 'buzzy', 'loud', 'dance'] as const;

/**
 * The "quiet state", in this catalog's own vocabulary.
 *
 * The Energy axis IS the loud/quiet axis, and `displayTag` is the one lookup a
 * component may render a tag through. Nothing here invents a live-crowd signal:
 * the app has no such measurement, and a card implying one would be describing a
 * room nobody reported on.
 *
 * AN UNTAGGED BAR SAYS SO (round-5 panel, Codex). This returned an empty string
 * and the caller's join dropped it, so a perfectly valid suggestion — any
 * catalog bar without one of the four tags — rendered a card with no quiet
 * state at all, which V8-R-SOC-003 requires the card to carry.
 *
 * The fix is NOT to guess one. The reasoning above stands: the app measures no
 * room, and a card implying otherwise would be describing a night nobody
 * reported on. Saying we do not know is the third state, and it is the one this
 * codebase uses everywhere else it cannot answer.
 */
function energyOf(bar: Bar): string {
  const tag = ENERGY_TAGS.find((candidate) => bar.tags?.includes(candidate));
  return tag ? displayTag(tag) : 'no quiet read yet';
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
