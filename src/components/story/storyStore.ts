'use client';

/**
 * Stories and Feed — SERVER-BACKED (migration 0065).
 *
 * Operator decision 2026-08-22 replaced the cycle-1 local-first store. What
 * that store did and this one does not: keep story records in `localStorage`,
 * hold photos as data URLs, and invent a people graph from `demoFriends`. A
 * story is now a row in `public.stories` with its bytes in a private bucket,
 * and who may read it is decided by RLS, not here.
 *
 * WHAT IS STILL LOCAL, and why that is not a contradiction: which items THIS
 * DEVICE has already watched. That is per-device read state, not the story —
 * it is meaningless to another account, it is registered foreign-only in
 * `accountCache`, and losing it costs a ring, not content.
 *
 * REMOVED, deliberately, because each was a claim the product could not keep:
 *   - `next-bar:stories:v1`          own stories as browser data URLs
 *   - `next-bar:story-replies:v1`    replies nothing ever delivered
 *   - `next-bar:stories-untagged:v1` a consent control only this device obeyed
 *   - `demoFriends` / `demoShareId` / `VIEWER_HANDLE` on production surfaces
 *   - the `groups` audience: no saved-groups capability exists (V9)
 *   - seeded captions, seeded ranking events, photoless seeded memories
 *
 * SIGNED-OUT SHOWS NOTHING. There is no anonymous story surface: a signed-out
 * visitor gets an honest empty state, not a demo reel dressed as friends.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useFollows } from '@/hooks/useFollows';
// ONE CLIENT FOR THE WHOLE STORIES OPERATION, and it must be the one that holds
// the session. This used to import the plain `@/lib/supabase` singleton — a bare
// `createClient`, whose session lives in localStorage — while this app signs in
// through `getBrowserSupabase()`, a `createBrowserClient` from @supabase/ssr
// whose session lives in COOKIES. Different stores, so the plain client was
// effectively anonymous: uploads went out under the browser session while
// `publish_story` executed on a client with no session at all, and in the worst
// case (a stale account in one client, a different account in the other) bytes
// could be uploaded as one identity and published as another.
// Codex independent review, 2026-09-02, CRITICAL.
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  SIGNED_URL_MAX_SECONDS,
  deleteStory,
  fetchVisibleStories,
  publishStory,
  removeMyStoryTag,
  reportOrphans,
  type StoryView,
} from '@/lib/stories.server';

/**
 * The ONE remaining story key: which item ids this device has watched.
 * Per-device read state — never story content.
 */
export const STORIES_SEEN_STORAGE_KEY = 'next-bar:stories-seen:v1';

/** Bounded so a long-lived device cannot grow this without limit. */
const MAX_SEEN_IDS = 500;

/** Friends = accepted MUTUAL friends. Custom = named real profile ids. */
export type StoryAudience = 'friends' | 'custom';

export type TaggedPerson = {
  /** Real profile id. The backend relationship is keyed on this, never a handle. */
  id: string;
  handle: string;
  name: string;
  initials: string;
  /** True for the viewer's own row, which is what "Remove me" acts on. */
  isYou?: boolean;
  /**
   * False when this viewer may not read the tagged profile.
   *
   * The row still appears — the COUNT of tagged people is a fact about the
   * story, not about the viewer — but it carries no name, handle or initials
   * to leak. Dropping these rows instead made the sheet under-report how many
   * people a story tags, which is its own dishonesty.
   */
  resolved?: boolean;
};

export type StoryPhoto = {
  kind: 'single' | 'dual';
  /** Short-lived signed URL, or null when it could not be minted. */
  main: string | null;
  inset?: string | null;
  /**
   * WHY `main` is null, carried from the server so the UI can tell an OUTAGE
   * from an absent photo. Without it every null rendered as the decorative bar
   * glyph, so a signing failure looked exactly like a story that simply has no
   * image — the dishonesty the server-side state was added to end, left unfixed
   * because nothing consumed it.
   */
  state: 'ok' | 'expired' | 'unsigned';
};

export type StoryItem = {
  id: string;
  authorId: string;
  postedAt: string;
  /** Server-set. The story is unreadable from this instant, by query. */
  expiresAt: string;
  barId: string | null;
  caption: string | null;
  tagged: TaggedPerson[];
  photo: StoryPhoto;
  audience: StoryAudience;
};

export type StoryGroup = {
  /**
   * Real profile id. The rail, the queue and the presence pins all key on
   * THIS, not on a handle: the old code carried a local `VIEWER_HANDLE = 'you'`
   * constant precisely because your own cell had no profile handle, and then
   * had to re-key backend rows onto that constant to make your own pin match.
   * An id every row already has removes both hacks.
   */
  id: string;
  /** Null for your own cell until a real handle is resolved for it. */
  handle: string | null;
  name: string;
  initials: string;
  isYou: boolean;
  items: StoryItem[];
  /** At least one item this device has not watched — this draws the ring. */
  hasUnseen: boolean;
};

/**
 * Feed is the SAME real, unexpired story records as a chronological
 * photo-first stream. There is no separate memory or archive backend, and no
 * ranking row: nothing in this build produces one from real data. Permanent
 * Feed history is V9.
 */
export type FeedEntry = {
  story: StoryItem;
  author: {
    id: string;
    /** Null for your own story: your row has no public profile handle here. */
    handle: string | null;
    name: string;
    initials: string;
    isYou: boolean;
  };
};

export type StoriesStatus =
  /** The first read has not resolved. */
  | 'loading'
  /** No session: there is no anonymous story surface. */
  | 'signed-out'
  /** Supabase could not be reached. NEVER shown as "no stories". */
  | 'unavailable'
  | 'ready';

export type PublishInput = {
  main: Blob;
  inset?: Blob | null;
  barId?: string | null;
  caption?: string | null;
  audience: StoryAudience;
  /** Real profile ids. Enforced server-side; a handle is not accepted. */
  audienceIds?: string[];
  tagIds?: string[];
};

export type PublishOutcome =
  /** `storyId` is what the receipt's Undo deletes. */
  | { ok: true; storyId: string }
  | { ok: false; message: string };

/** Outcomes with nothing to hand back (delete, untag). */
export type ActionOutcome =
  | { ok: true }
  | { ok: false; message: string };

export type UseStories = {
  status: StoriesStatus;
  /** Rail order: you first, then friends. Also the QUEUE order. */
  groups: StoryGroup[];
  feed: FeedEntry[];
  /** Accepted mutual friends — the only people a story can be sent to. */
  friends: TaggedPerson[];
  /** False until the real circle has actually resolved. */
  friendsReady: boolean;
  publish: (input: PublishInput) => Promise<PublishOutcome>;
  removeItem: (id: string) => Promise<ActionOutcome>;
  markSeen: (id: string) => void;
  untagMe: (id: string) => Promise<ActionOutcome>;
  refresh: () => void;
};

// ---------------------------------------------------------------------------
// per-device read state
// ---------------------------------------------------------------------------

function readSeen(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORIES_SEEN_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')
      ? (parsed as string[])
      : [];
  } catch {
    return [];
  }
}

function writeSeen(ids: readonly string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORIES_SEEN_STORAGE_KEY,
      JSON.stringify(ids.slice(-MAX_SEEN_IDS)),
    );
  } catch {
    // A full or blocked quota loses a ring, not content. Nothing to report.
  }
}

// ---------------------------------------------------------------------------
// mapping
// ---------------------------------------------------------------------------

export function initialsFor(name: string | null | undefined): string {
  const source = (name ?? '').trim();
  if (source === '') return '··';
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`
    : source.slice(0, 2);
  return letters.toUpperCase();
}

type Person = { id: string; handle: string | null; name: string; initials: string };

function toItem(view: StoryView, tagged: TaggedPerson[]): StoryItem {
  return {
    id: view.id,
    authorId: view.authorId,
    postedAt: view.createdAt,
    expiresAt: view.expiresAt,
    barId: view.barId,
    caption: view.caption,
    tagged,
    photo: {
      kind: view.mediaKind,
      main: view.mediaUrl,
      inset: view.insetUrl,
      state: view.mediaState,
    },
    audience: view.audience,
  };
}

// ---------------------------------------------------------------------------
// hook
// ---------------------------------------------------------------------------

export function useStories(): UseStories {
  const auth = useAuth();
  const { mutuals, circleReady, mode } = useFollows();
  const signedIn = auth.status === 'signed-in';
  const youId = signedIn ? auth.user.id : null;

  const [views, setViews] = useState<StoryView[] | null>(null);
  const [status, setStatus] = useState<StoriesStatus>('loading');
  const [seen, setSeen] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => setSeen(readSeen()), []);

  useEffect(() => {
    if (!signedIn) {
      setViews(null);
      setStatus('signed-out');
      return;
    }
    let cancelled = false;
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    void (async () => {
      const result = await fetchVisibleStories(getBrowserSupabase());
      if (cancelled) return;
      if (!result.ok) {
        // An unreachable backend is NOT an empty feed. Saying "no stories"
        // here would be the silent-local-fallback this surface must not do.
        setViews(null);
        setStatus('unavailable');
        return;
      }
      setViews(result.value);
      setStatus('ready');
    })();
    return () => { cancelled = true; };
  }, [signedIn, youId, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  /**
   * Signed media URLs are minted ONCE per fetch and live at most
   * {@link SIGNED_URL_MAX_SECONDS}. A rail or viewer left open past that
   * rendered broken images for stories that are still perfectly live — the
   * URLs had expired, not the stories. Re-fetch a little before they lapse so
   * a fresh set is always in hand.
   *
   * The margin is deliberate: renewing exactly at expiry races the very
   * boundary it exists to avoid. Only while signed in, and cleared on unmount
   * so a backgrounded tab is not left polling.
   */
  useEffect(() => {
    if (!signedIn) return undefined;
    const RENEW_MARGIN_SECONDS = 30;
    const everyMs = Math.max(RENEW_MARGIN_SECONDS, SIGNED_URL_MAX_SECONDS - RENEW_MARGIN_SECONDS) * 1000;
    const id = setInterval(() => setTick((n) => n + 1), everyMs);
    return () => clearInterval(id);
  }, [signedIn]);

  /**
   * Every author of a story you can read is either you or an accepted mutual
   * friend — that is what RLS enforces — so the mutuals list resolves every
   * author without a second profile read.
   */
  const people = useMemo<Map<string, Person>>(() => {
    const map = new Map<string, Person>();
    for (const profile of mutuals) {
      const name = profile.displayName ?? profile.handle;
      map.set(profile.id, {
        id: profile.id,
        handle: profile.handle,
        name,
        initials: initialsFor(name),
      });
    }
    if (youId !== null) {
      const email = signedIn ? auth.user.email : null;
      map.set(youId, {
        id: youId,
        // No invented handle. Your own row is identified by id everywhere it
        // matters; a placeholder like the old `VIEWER_HANDLE = 'you'` only ever
        // produced links to a profile that does not exist.
        handle: null,
        name: 'You',
        initials: initialsFor(email ? email.split('@')[0] : 'You'),
      });
    }
    return map;
  }, [mutuals, youId, signedIn, auth]);

  const friends = useMemo<TaggedPerson[]>(
    () => mutuals.map((profile) => {
      const name = profile.displayName ?? profile.handle;
      return {
        id: profile.id, handle: profile.handle, name, initials: initialsFor(name),
      };
    }),
    [mutuals],
  );

  /**
   * Tagged people, resolved from the ids the story actually carries.
   *
   * This used to be a hardcoded empty array, which made the whole tag surface
   * unreachable: publication wrote story_tags rows, nothing read them back, and
   * so the people chip, the tagged-people sheet and its "Remove me" consent
   * control could never render. A tagged person could not learn they were
   * tagged, let alone withdraw — the consent control existed only as an RPC no
   * screen could reach.
   *
   * An id that resolves to nobody the viewer can see is kept as an UNRESOLVED
   * row rather than dropped. Two dishonesties were available and this picks
   * neither: inventing a name for a profile the viewer has no right to read
   * would leak identity, and dropping the row entirely under-reported how many
   * people the story tags — the previous behaviour, and the reason the sheet
   * could not show the full tag list. The row therefore carries the real id
   * (the backend relationship is keyed on it) and no name, handle or initials.
   *
   * Your OWN id is always resolvable — it is put in the people map above
   * unconditionally — so "Remove me" is always reachable by the one person it
   * belongs to, regardless of who else on the list this viewer can see.
   */
  const items = useMemo<StoryItem[]>(() => {
    if (views === null) return [];
    return views.map((view) => toItem(
      view,
      view.tagIds.map((id) => {
        const person = people.get(id);
        if (person === undefined) {
          return {
            id,
            handle: '',
            name: '',
            initials: '',
            isYou: id === youId,
            resolved: false,
          };
        }
        return {
          id: person.id,
          handle: person.handle ?? '',
          name: person.name,
          initials: person.initials,
          isYou: id === youId,
          resolved: true,
        };
      }),
    ));
  }, [views, people, youId]);

  const groups = useMemo<StoryGroup[]>(() => {
    const yourItems = items.filter((item) => item.authorId === youId);
    const you = youId === null ? null : people.get(youId);
    const yourGroup: StoryGroup = {
      id: youId ?? '',
      handle: you?.handle ?? null,
      name: 'You',
      initials: you?.initials ?? '··',
      isYou: true,
      items: yourItems,
      hasUnseen: false,
    };
    const byAuthor = new Map<string, StoryItem[]>();
    for (const item of items) {
      if (item.authorId === youId) continue;
      const list = byAuthor.get(item.authorId) ?? [];
      list.push(item);
      byAuthor.set(item.authorId, list);
    }
    const friendGroups: StoryGroup[] = [];
    for (const [authorId, list] of byAuthor) {
      const person = people.get(authorId);
      // AN UNRESOLVED AUTHOR IS NOT AN ABSENT STORY. This used to `continue`,
      // which silently dropped the whole group — so when the follow-graph read
      // failed and `mutuals` came back empty, every friend story disappeared and
      // the rail reported `ready` with nothing in it. A failed read rendered as
      // an honest empty feed, which is the exact silent-fallback this surface
      // must never do. The DATABASE already authorised these rows: RLS returned
      // them, so the viewer is entitled to see them whatever the local circle
      // cache knows. Show the story; name the author only when we actually can.
      if (person === undefined) {
        friendGroups.push({
          id: authorId,
          handle: null,
          name: 'Someone you follow',
          initials: '··',
          isYou: false,
          items: list,
          hasUnseen: list.some((item) => !seen.includes(item.id)),
        });
        continue;
      }
      friendGroups.push({
        id: person.id,
        handle: person.handle,
        name: person.name,
        initials: person.initials,
        isYou: false,
        items: list,
        hasUnseen: list.some((item) => !seen.includes(item.id)),
      });
    }
    // Newest author first, so the rail order is stable and meaningful.
    friendGroups.sort((a, b) =>
      Date.parse(b.items[0]?.postedAt ?? '') - Date.parse(a.items[0]?.postedAt ?? ''));
    return [yourGroup, ...friendGroups];
  }, [items, people, seen, youId]);

  const feed = useMemo<FeedEntry[]>(() => {
    return items
      .slice()
      .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
      .flatMap((story) => {
        const person = people.get(story.authorId);
        if (person === undefined) return [];
        return [{
          story,
          author: {
            id: person.id,
            handle: person.handle,
            name: person.name,
            initials: person.initials,
            isYou: story.authorId === youId,
          },
        }];
      });
  }, [items, people, youId]);

  const publish = useCallback(async (input: PublishInput): Promise<PublishOutcome> => {
    if (youId === null) {
      return { ok: false, message: 'Sign in to add to your story.' };
    }
    const result = await publishStory(getBrowserSupabase(), {
      authorId: youId,
      draftId: newDraftId(),
      main: input.main,
      inset: input.inset ?? null,
      barId: input.barId ?? null,
      caption: input.caption ?? null,
      audience: input.audience,
      audienceIds: input.audienceIds ?? [],
      tagIds: input.tagIds ?? [],
    });
    if (!result.ok) {
      // The publish path removes the bytes it uploaded when the metadata
      // publish fails; when that removal ALSO fails it hands back the keys.
      // Dropping them here was what turned an honest return value into a
      // silent one — private objects left in the bucket with nothing said.
      reportOrphans('publish', result.orphans);
      return { ok: false, message: result.message };
    }
    refresh();
    return { ok: true, storyId: result.value.id };
  }, [youId, refresh]);

  const removeItem = useCallback(async (id: string): Promise<ActionOutcome> => {
    const result = await deleteStory(getBrowserSupabase(), id);
    if (!result.ok) {
      reportOrphans('delete', result.orphans);
      return { ok: false, message: result.message };
    }
    // A soft delete that could not remove the bytes still succeeded — the read
    // gate is closed — but the leftover objects are reported rather than lost.
    reportOrphans('delete', result.value.orphans);
    refresh();
    return { ok: true };
  }, [refresh]);

  const untagMe = useCallback(async (id: string): Promise<ActionOutcome> => {
    const result = await removeMyStoryTag(getBrowserSupabase(), id);
    if (!result.ok) return { ok: false, message: result.message };
    if (!result.value) {
      return { ok: false, message: 'You are not tagged in that story.' };
    }
    refresh();
    return { ok: true };
  }, [refresh]);

  const markSeen = useCallback((id: string) => {
    setSeen((current) => {
      if (current.includes(id)) return current;
      const next = [...current, id].slice(-MAX_SEEN_IDS);
      writeSeen(next);
      return next;
    });
  }, []);

  return {
    status,
    groups,
    feed,
    friends,
    // In local (signed-out) mode there is no circle to resolve and no surface
    // to gate; server mode must wait for the real answer.
    friendsReady: mode === 'server' ? circleReady : false,
    publish,
    removeItem,
    markSeen,
    untagMe,
    refresh,
  };
}

function newDraftId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `draft-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** "8m" / "3h" / "2d" — the story chrome's age label. */
export function ageLabel(iso: string, now = Date.now()): string {
  const ms = Math.max(0, now - Date.parse(iso));
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function taggedLabel(tagged: readonly TaggedPerson[]): string | null {
  if (tagged.length === 0) return null;
  const first = tagged[0].name.split(/\s+/)[0];
  return tagged.length === 1 ? first : `${first} +${tagged.length - 1}`;
}
