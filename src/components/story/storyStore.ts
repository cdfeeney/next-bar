'use client';

/**
 * Stories and Feed memories — the LOCAL-FIRST store, on the same rule
 * `src/lib/nightLog.ts` records: a surface ships local-first, and server
 * persistence arrives with the table that backs it.
 *
 * There is no photo-memory table, and this branch may not migrate, so a story
 * you post lives in `localStorage` for its 24 hours and the friend stories
 * around it are seeded from the people graph that already exists
 * (`src/lib/demo/friends.ts`) rather than from a second invented store.
 * Everything server-backed on Social — presence, plans, invitations, follow,
 * Group Favorites — is untouched by this module.
 *
 * Two keys, both night-independent (a story is a 24-hour object, not a
 * night-scoped one):
 *   next-bar:stories:v1        your own story items
 *   next-bar:stories-seen:v1   which item ids you have already watched
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBarById } from '@/lib/catalog';
import { demoFriends } from '@/lib/demo';

export const STORIES_STORAGE_KEY = 'next-bar:stories:v1';
export const STORIES_SEEN_STORAGE_KEY = 'next-bar:stories-seen:v1';
export const STORY_REPLIES_STORAGE_KEY = 'next-bar:story-replies:v1';

/** The canvas's own words: "Live for 24 hours · Friends." */
const STORY_TTL_MS = 24 * 60 * 60 * 1000;

/** Degenerate-input guard, mirroring nightLog's MAX_VISITS_PER_NIGHT. */
const MAX_OWN_ITEMS = 30;

/** Seen-id ring buffer — the list is a convenience, not an archive. */
const MAX_SEEN_IDS = 500;

/**
 * The viewer's own handle inside this module. Stories are local-first, so the
 * signed-in profile handle is not available to the seed; one constant keeps
 * the rail, the tag lists and "Remove me" agreeing on who "you" is.
 */
export const VIEWER_HANDLE = 'you';

export type StoryAudience = 'friends' | 'groups' | 'custom';

export type TaggedPerson = {
  /** No leading @ — matches DemoFriend.handle and the /u/[handle] route. */
  handle: string;
  name: string;
  initials: string;
  /** True for the viewer's own row, which is what "Remove me" acts on. */
  isYou?: boolean;
};

/**
 * A photo pair. `inset` is present only for a dual shot; the viewer and the
 * compose screen render the SAME placement for both kinds — the inset never
 * moves the tags (story-tag-placement, "Rules that hold in every option").
 */
export type StoryPhoto = {
  kind: 'single' | 'dual';
  /** Data URL, or null for a seeded item that has no bytes behind it. */
  main: string | null;
  inset?: string | null;
};

export type StoryItem = {
  id: string;
  postedAt: string;
  /** Chosen by the poster. Never inferred from location. */
  barId: string | null;
  caption: string | null;
  tagged: TaggedPerson[];
  photo: StoryPhoto;
  audience: StoryAudience;
};

export type StoryGroup = {
  handle: string;
  name: string;
  initials: string;
  isYou: boolean;
  items: StoryItem[];
  /** At least one item you have not watched — this is what draws the ring. */
  hasUnseen: boolean;
};

export type FeedMemory = {
  id: string;
  handle: string;
  name: string;
  initials: string;
  barId: string | null;
  postedAt: string;
  caption: string;
  tagged: TaggedPerson[];
  /** Bearer id for /u/[handle]/night/[shareId] — the existing night surface. */
  shareId: string;
};

/** A ranking event: the compact secondary row, never a photo card. */
export type FeedRankingEvent = {
  id: string;
  handle: string;
  name: string;
  initials: string;
  barId: string;
  score: number;
  at: string;
};

export type FeedEntry =
  | { kind: 'memory'; memory: FeedMemory }
  | { kind: 'ranking'; event: FeedRankingEvent };

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

function isStoryItem(value: unknown): value is StoryItem {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.postedAt === 'string' &&
    Array.isArray(obj.tagged) &&
    typeof obj.photo === 'object' &&
    obj.photo !== null
  );
}

function readJson<T>(key: string, guard: (value: unknown) => value is T): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked quota must not take the surface down with it.
  }
}

function isItemArray(value: unknown): value is StoryItem[] {
  return Array.isArray(value) && value.every(isStoryItem);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Your own items, expired ones dropped. Pure read — never writes back. */
export function loadOwnItems(now = Date.now()): StoryItem[] {
  const items = readJson(STORIES_STORAGE_KEY, isItemArray) ?? [];
  return items
    .filter((item) => {
      const at = Date.parse(item.postedAt);
      return Number.isFinite(at) && now - at < STORY_TTL_MS;
    })
    .slice(-MAX_OWN_ITEMS);
}

export function saveOwnItems(items: readonly StoryItem[]): void {
  writeJson(STORIES_STORAGE_KEY, items.slice(-MAX_OWN_ITEMS));
}

export function loadSeenIds(): string[] {
  return readJson(STORIES_SEEN_STORAGE_KEY, isStringArray) ?? [];
}

export type StoryReply = { targetId: string; text: string; at: string };

function isReplyArray(value: unknown): value is StoryReply[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      if (entry === null || typeof entry !== 'object') return false;
      const reply = entry as Record<string, unknown>;
      return typeof reply.targetId === 'string' && typeof reply.text === 'string';
    })
  );
}

export function loadReplies(): StoryReply[] {
  return readJson(STORY_REPLIES_STORAGE_KEY, isReplyArray) ?? [];
}

/**
 * Replies are kept where the stories are: on this device, until a messages
 * table exists to carry them. Writing them down rather than swallowing them
 * is the difference between a local-first surface and a dead control.
 */
export function saveReply(targetId: string, text: string): void {
  const next = [
    ...loadReplies(),
    { targetId, text, at: new Date().toISOString() },
  ].slice(-MAX_SEEN_IDS);
  writeJson(STORY_REPLIES_STORAGE_KEY, next);
}

// ---------------------------------------------------------------------------
// seeded friend stories and feed
// ---------------------------------------------------------------------------

/** Fixed offsets, not random, so the rail order is stable across renders. */
const SEED_MINUTES_AGO = [8, 22, 61, 140] as const;

const SEED_CAPTIONS = [
  'Back corner booth, the good jukebox night.',
  'Last stop and nobody wanted to leave.',
  'Two rounds in and the room finally filled up.',
  'Walked past it twice before we found the door.',
] as const;

function seedPeople(): TaggedPerson[] {
  return demoFriends.map((friend) => ({
    handle: friend.handle,
    name: friend.displayName,
    initials: friend.initials,
  }));
}

/**
 * One seeded story tags YOU. Without it "Remove me" is a branch no test and
 * no user could ever reach, which is how a control ships broken.
 */
function taggedFor(
  people: readonly TaggedPerson[],
  poster: string,
  groupIndex: number,
  itemIndex: number,
): TaggedPerson[] {
  const others = people
    .filter((person) => person.handle !== poster)
    .slice(0, 1 + (itemIndex % 3));
  if (groupIndex === 0 && itemIndex === 0) {
    return [...others, { handle: VIEWER_HANDLE, name: 'You', initials: 'YO' }];
  }
  return others;
}

function knownBarId(barId: string | undefined): string | null {
  if (barId === undefined) return null;
  return getBarById(barId) ? barId : null;
}

/** Friend story groups, one to three items each, in a stable rail order. */
export function seededGroups(now: number): Array<Omit<StoryGroup, 'hasUnseen'>> {
  const people = seedPeople();
  return demoFriends.map((friend, index) => {
    const bars = friend.ratings.slice(0, 3).map((rating) => rating.barId);
    // The varying count is the point of criterion 5: the progress strip has to
    // be drawn from the data, so a fixed 4- or 5-segment chrome cannot pass.
    const count = 1 + (index % 3);
    const minutes = SEED_MINUTES_AGO[index % SEED_MINUTES_AGO.length];
    const items: StoryItem[] = Array.from({ length: count }, (_unused, i) => ({
      id: `seed-${friend.handle}-${i}`,
      postedAt: new Date(now - (minutes + i * 3) * 60_000).toISOString(),
      barId: knownBarId(bars[i] ?? bars[0]),
      caption: null,
      tagged: taggedFor(people, friend.handle, index, i),
      photo: {
        kind: i % 2 === 0 ? ('single' as const) : ('dual' as const),
        main: null,
        inset: null,
      },
      audience: 'friends' as const,
    }));
    return {
      handle: friend.handle,
      name: friend.displayName,
      initials: friend.initials,
      isYou: false,
      items,
    };
  });
}

/** Feed = photo memories, newest first, with ranking events interleaved. */
export function seededFeed(now: number): FeedEntry[] {
  const people = seedPeople();
  const entries: FeedEntry[] = [];
  demoFriends.forEach((friend, index) => {
    entries.push({
      kind: 'memory',
      memory: {
        id: `memory-${friend.handle}`,
        handle: friend.handle,
        name: friend.displayName,
        initials: friend.initials,
        barId: knownBarId(friend.ratings[0]?.barId),
        postedAt: new Date(now - (23 + index * 47) * 60_000).toISOString(),
        caption: SEED_CAPTIONS[index % SEED_CAPTIONS.length],
        tagged: people
          .filter((person) => person.handle !== friend.handle)
          .slice(0, 2),
        shareId: `demo-${friend.handle}`,
      },
    });
    const ranked = friend.ratings[1];
    // Every other card, so the compact row is legible as a SECONDARY beat
    // rather than a second stream competing with the photos.
    if (ranked !== undefined && knownBarId(ranked.barId) !== null && index % 2 === 0) {
      entries.push({
        kind: 'ranking',
        event: {
          id: `ranked-${friend.handle}`,
          handle: friend.handle,
          name: friend.displayName,
          initials: friend.initials,
          barId: ranked.barId,
          score: ranked.score ?? 0,
          at: new Date(now - (60 + index * 47) * 60_000).toISOString(),
        },
      });
    }
  });
  return entries;
}

// ---------------------------------------------------------------------------
// hook
// ---------------------------------------------------------------------------

export type UseStories = {
  /** Rail order: you first, then friends. This is also the QUEUE order. */
  groups: StoryGroup[];
  feed: FeedEntry[];
  addItem: (item: StoryItem) => void;
  removeItem: (id: string) => void;
  markSeen: (id: string) => void;
  /** Drops you from a story's tag list — the sheet's "Remove me". */
  untagMe: (itemId: string) => void;
};

export function useStories(you: {
  handle: string;
  name: string;
  initials: string;
}): UseStories {
  const [ownItems, setOwnItems] = useState<StoryItem[]>([]);
  const [seen, setSeen] = useState<string[]>([]);
  const [untagged, setUntagged] = useState<string[]>([]);
  // Seeded ages are relative to a single mount-time clock so a re-render
  // cannot re-order the rail underneath an open viewer.
  const [now] = useState(() => Date.now());

  // localStorage is read after mount, never during render: this surface is
  // server-rendered and a first paint that differs from the server's is the
  // hydration mismatch VibeQuiz already paid for once.
  useEffect(() => {
    setOwnItems(loadOwnItems());
    setSeen(loadSeenIds());
  }, []);

  const addItem = useCallback((item: StoryItem) => {
    setOwnItems((current) => {
      const next = [...current, item].slice(-MAX_OWN_ITEMS);
      saveOwnItems(next);
      return next;
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setOwnItems((current) => {
      const next = current.filter((item) => item.id !== id);
      saveOwnItems(next);
      return next;
    });
  }, []);

  const markSeen = useCallback((id: string) => {
    setSeen((current) => {
      if (current.includes(id)) return current;
      const next = [...current, id].slice(-MAX_SEEN_IDS);
      writeJson(STORIES_SEEN_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const untagMe = useCallback((itemId: string) => {
    setUntagged((current) =>
      current.includes(itemId) ? current : [...current, itemId],
    );
  }, []);

  // Memoised so the identities the viewer keys its effects on only change
  // when the data does — the seed is otherwise rebuilt on every parent render.
  const seeded = useMemo(() => seededGroups(now), [now]);
  const feed = useMemo(() => seededFeed(now), [now]);

  const groups = useMemo<StoryGroup[]>(() => {
    const yourGroup: StoryGroup = {
      handle: you.handle,
      name: you.name,
      initials: you.initials,
      isYou: true,
      items: ownItems,
      hasUnseen: false,
    };
    const friendGroups = seeded.map((group) => ({
      ...group,
      items: group.items.map((item) =>
        untagged.includes(item.id)
          ? {
            ...item,
            tagged: item.tagged.filter(
              (person) => person.handle !== VIEWER_HANDLE,
            ),
          }
          : item,
      ),
      hasUnseen: group.items.some((item) => !seen.includes(item.id)),
    }));
    return [yourGroup, ...friendGroups];
  }, [seeded, ownItems, seen, untagged, you.handle, you.name, you.initials]);

  return { groups, feed, addItem, removeItem, markSeen, untagMe };
}

/** "8m" / "3h" / "2d" — the story chrome's age label. */
export function ageLabel(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** "With Maya +2" — collapses any tag list longer than one name. */
export function taggedLabel(tagged: readonly TaggedPerson[]): string | null {
  if (tagged.length === 0) return null;
  const first = tagged[0].name.split(/\s+/)[0];
  return tagged.length === 1
    ? `With ${first}`
    : `With ${first} +${tagged.length - 1}`;
}
