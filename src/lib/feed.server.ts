import type { SupabaseClient } from '@supabase/supabase-js';

import { mediaFailure, mediaUnavailable, type MediaResult } from '@/lib/media/types';
import { getNightOut } from '@/lib/nightOuts.server';

/**
 * Server-mode Feed (migration 0069). Pure async functions — the React layer
 * stays free of SQL, RPC and Storage specifics.
 *
 * THE DATABASE IS AUTHORITATIVE, and this module never decides who may see a
 * post. `public.feed_posts` RLS does, through `can_view_feed_post` — the one
 * predicate 0069 also gives to every SECURITY DEFINER verb, so the read gate and
 * the write gate cannot disagree. Nothing here filters by audience as a
 * substitute for that.
 *
 * FAILURE IS HONEST. Every function returns {@link MediaResult} rather than
 * throwing, and an unreachable or unconfigured Supabase returns `unavailable` —
 * never a local fallback that reports success. A post that did not reach the
 * database was not shared, a comment that did not reach it was not sent, and the
 * caller must say so. This is the same discriminated-union rule
 * `src/lib/stories.server.ts` and `src/lib/media/*` follow; a Feed-specific
 * result type would have been a fourth spelling of one idea.
 *
 * WHAT A FEED POST IS NOT: it is not a story. It has NO expiry
 * (V8-R-FEED-002) — which is why nothing here clamps a lifetime against a
 * deadline the way `signedUrlTtlSeconds` does — and it is never public
 * (V8-R-FEED-006).
 *
 * THE PHOTO COMES THROUGH THE MEDIA ROUTE, not from a client-side
 * `createSignedUrl`. `GET /api/media/:id/url` decides the lifetime server-side
 * (V8-R-STO-015) and asks `media_read_window` first, which 0069 extends with the
 * Feed branch. Signing here instead would reintroduce exactly the hole WP1's
 * route closed.
 */

/** Cap on a caption, matching 0069's own `feed_posts_caption_length`. */
export const MAX_FEED_CAPTION_LENGTH = 1000;

/** Cap on a comment, matching 0069's own `feed_comments_body_length`. */
export const MAX_FEED_COMMENT_LENGTH = 2000;

/**
 * How many replies one Feed card will load. PER POST, not per batch.
 *
 * A FEED POST NEVER EXPIRES (V8-R-FEED-002), so its thread only ever grows, and
 * `fetchFeedComments` re-runs on mount AND after every confirmed reply or
 * deletion. Unbounded, that is a query whose cost rises for the whole life of the
 * surface, and on a deployment with a PostgREST row cap it silently truncates —
 * worse than truncating on purpose, because nothing says it happened.
 *
 * WHY PER POST AND NOT ONE FLAT CEILING ACROSS THE BATCH. A flat ceiling was the
 * smaller change, and it produced a defect in each of the two rounds that
 * followed. One busy post consumes the whole budget, and then the quieter posts
 * behind it get whatever the busy one left: first they were reported as settled
 * and EMPTY, and once that was fixed by refusing to seed a truncated batch, they
 * became permanently UNREAD instead — the batch is full every time, so no refresh
 * ever reaches them. Both are the same cause wearing different symptoms, so the
 * cause goes rather than the symptom. A per-post bound cannot starve a post,
 * because no post competes with another for it.
 *
 * ponytail: one query per post on screen, bounded by the feed's own `limit`, in
 * the same shape (and for the same reason) as `fetchNightTokens` below. A single
 * batched read with a per-post window needs a lateral join PostgREST will not
 * express, so it would mean a new RPC in 0069; worth doing when a page carries
 * enough cards to feel it, not before.
 */
export const FEED_COMMENTS_PER_POST = 200;

/**
 * V8-R-FEED-006's three-way shape. There is deliberately no `'public'`: "FEED IS
 * NEVER PUBLIC", and a value the type cannot express is a value no caller can
 * accidentally send.
 */
export type FeedAudience = 'friends' | 'group' | 'custom';

export type FeedPost = {
  id: string;
  authorId: string;
  mediaId: string;
  barId: string | null;
  caption: string | null;
  /** V8-R-FEED-004's target, or null when the photo belongs to no night. */
  nightOutId: string | null;
  audience: FeedAudience;
  /** Provenance for a named-group audience. Never the gate — see 0069. */
  audienceGroupId: string | null;
  createdAt: string;
  /** Profile ids tagged in this post, with withdrawn tags already removed. */
  tagIds: string[];
};

export type FeedAuthor = {
  id: string;
  handle: string | null;
  displayName: string | null;
};

export type FeedPostView = FeedPost & {
  /** Null when the author profile could not be read; the card still renders. */
  author: FeedAuthor | null;
  mediaUrl: string | null;
  /**
   * WHY a null URL is not self-describing, exactly as `StoryView.mediaState`
   * records it: signing FAILED is an outage and the viewer is owed an honest
   * "couldn't load this" rather than a card that silently looks like it has no
   * photo. A Feed post always has a photo, so there is no third "no media" case.
   *
   * 'ok'       — a URL was minted.
   * 'unsigned' — the media route refused or was unreachable.
   */
  mediaState: 'ok' | 'unsigned';
  /**
   * The share token for "View night", present ONLY when the VIEWER may read that
   * night. V8-R-FEED-004's trust boundary is "the night must be one the viewer
   * may see", and that decision belongs to `night_outs_select_member` (0044) —
   * so it is made by READING the row as this caller rather than restated here.
   * Null means either no night or a night this viewer may not open, and the card
   * renders no action in both cases.
   */
  nightShareToken: string | null;
  /**
   * False when the tag read FAILED, so `tagIds` is not known to be the whole
   * list. An empty list then means "we could not find out", not "nobody is
   * tagged" — and the difference matters to the tagged person, who loses the
   * chip and the consent control behind it with nothing saying why.
   */
  tagsComplete: boolean;
  /**
   * False when this post names a night whose token read FAILED, so a null
   * `nightShareToken` is not known to mean "this viewer may not open it".
   *
   * `get_night_out` answers a refusal and an outage identically, and collapsing
   * them made "View night" disappear on a failed read with nothing saying why —
   * the same shape as an unread comment thread rendering as an empty one.
   */
  nightTokenComplete: boolean;
};

export type FeedComment = {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  createdAt: string;
};

type PostRow = {
  id: string;
  author_id: string;
  media_id: string;
  bar_id: string | null;
  caption: string | null;
  night_out_id: string | null;
  audience: FeedAudience;
  audience_group_id: string | null;
  created_at: string;
};

const POST_COLUMNS =
  'id, author_id, media_id, bar_id, caption, night_out_id, audience, audience_group_id, created_at';

function toPost(row: PostRow, tagIds: string[] = []): FeedPost {
  return {
    id: row.id,
    authorId: row.author_id,
    mediaId: row.media_id,
    barId: row.bar_id,
    caption: row.caption,
    nightOutId: row.night_out_id,
    audience: row.audience,
    audienceGroupId: row.audience_group_id,
    createdAt: row.created_at,
    tagIds,
  };
}

function toComment(row: {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
}): FeedComment {
  return {
    id: row.id,
    postId: row.post_id,
    authorId: row.author_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

/**
 * The RPC's own "not yours" / "not a mutual friend" refusal, kept distinct from
 * an outage. 42501 is `insufficient_privilege`; 22023 and 22001 are the bounds
 * checks. A denial is the user's to act on, a failure is ours.
 */
function rpcFailure<T>(
  code: unknown,
  deniedMessage: string,
  failedMessage: string,
): MediaResult<T> {
  return code === '42501'
    ? mediaFailure('denied', deniedMessage)
    : mediaFailure('failed', failedMessage);
}

/**
 * Publish one Feed post for a media object the caller already uploaded through
 * `/api/media/upload`.
 *
 * The media id, not a storage path: 0069 keys the post to the 0066 REGISTRY, so
 * a post inherits the whole media trust boundary rather than naming bytes
 * directly.
 */
export async function publishFeedPost(
  client: SupabaseClient | null,
  input: {
    mediaId: string;
    barId?: string | null;
    caption?: string | null;
    nightOutId?: string | null;
    audience: FeedAudience;
    /** Recipients for 'group' and 'custom'. The server intersects them. */
    audienceIds?: string[];
    /** Required for 'group', forbidden otherwise — 0069 enforces both. */
    groupId?: string | null;
    tagIds?: string[];
  },
): Promise<MediaResult<FeedPost>> {
  if (client === null) return mediaUnavailable();

  const caption = input.caption?.trim() ?? '';
  if (caption.length > MAX_FEED_CAPTION_LENGTH) {
    return mediaFailure('rejected', 'That caption is too long.');
  }

  try {
    const { data, error } = await client.rpc('publish_feed_post', {
      p_media_id: input.mediaId,
      p_bar_id: input.barId ?? null,
      p_caption: caption.length > 0 ? caption : null,
      p_night_out_id: input.nightOutId ?? null,
      p_audience: input.audience,
      p_audience_ids: input.audienceIds ?? [],
      p_group_id: input.groupId ?? null,
      p_tag_ids: input.tagIds ?? [],
    });

    if (error || !data) {
      return rpcFailure(
        error?.code,
        'Everyone you post to has to be a friend who follows you back. Nothing was posted.',
        'That post could not be shared. Nothing was posted.',
      );
    }

    return { ok: true, value: toPost((Array.isArray(data) ? data[0] : data) as PostRow) };
  } catch {
    return mediaUnavailable();
  }
}

/**
 * Every Feed post the caller may currently read, newest first.
 *
 * The ORDER BY is presentation; the visibility is RLS. There is no client-side
 * audience filter here on purpose — a second gate that agreed with the database
 * would be redundant and one that disagreed would be a bug.
 */
export async function fetchFeedPosts(
  client: SupabaseClient | null,
  limit = 50,
): Promise<MediaResult<FeedPostView[]>> {
  if (client === null) return mediaUnavailable();
  try {
    const { data, error } = await client
      .from('feed_posts')
      .select(POST_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return mediaFailure('failed', 'The Feed could not be loaded.');

    const rows = (data ?? []) as PostRow[];
    if (rows.length === 0) return { ok: true, value: [] };

    const [tags, authors, nights] = await Promise.all([
      fetchTags(client, rows.map((row) => row.id)),
      fetchFeedAuthors(client, rows.map((row) => row.author_id)),
      fetchNightTokens(client, rows.map((row) => row.night_out_id)),
    ]);

    const views = await Promise.all(
      rows.map(async (row) => {
        const post = toPost(row, tags.byPost.get(row.id) ?? []);
        const mediaUrl = await fetchMediaUrl(client, row.media_id);
        return {
          ...post,
          author: authors.get(row.author_id) ?? null,
          mediaUrl,
          mediaState: mediaUrl === null ? ('unsigned' as const) : ('ok' as const),
          nightShareToken:
            row.night_out_id === null ? null : nights.byId.get(row.night_out_id) ?? null,
          // False ONLY when this post names a night we could not ask about, so the
          // card can say the link could not be loaded instead of silently dropping
          // the action as though the viewer were not entitled to it.
          nightTokenComplete:
            row.night_out_id === null || !nights.unread.has(row.night_out_id),
          tagsComplete: tags.ok,
        };
      }),
    );

    return { ok: true, value: views };
  } catch {
    return mediaUnavailable();
  }
}

/**
 * Live tags for these posts, keyed by post id.
 *
 * A SECOND QUERY RATHER THAN AN EMBED, for the reason `stories.server.ts` gives:
 * a nested shape makes a whole post fail to load because a tag read failed. Tags
 * are decoration on a post, never its gate.
 */
async function fetchTags(
  client: SupabaseClient,
  postIds: readonly string[],
): Promise<{ byPost: Map<string, string[]>; ok: boolean }> {
  const byPost = new Map<string, string[]>();
  if (postIds.length === 0) return { byPost, ok: true };
  try {
    const { data, error } = await client
      .from('feed_post_tags')
      .select('post_id, profile_id')
      .in('post_id', [...postIds])
      .is('removed_at', null);
    if (error) return { byPost, ok: false };
    for (const row of (data ?? []) as { post_id: string; profile_id: string }[]) {
      byPost.set(row.post_id, [...(byPost.get(row.post_id) ?? []), row.profile_id]);
    }
  } catch {
    return { byPost, ok: false };
  }
  return { byPost, ok: true };
}

/**
 * Display identities for a set of profiles — card headers and comment bylines.
 *
 * A failed read renders an unnamed row, never a wrong name and never a raw uuid.
 * Exported because the comment thread needs identities for people who authored
 * no post in the batch, and a second spelling of this query is a second place
 * for the column list to drift.
 */
export async function fetchFeedAuthors(
  client: SupabaseClient,
  authorIds: readonly string[],
): Promise<Map<string, FeedAuthor>> {
  const byId = new Map<string, FeedAuthor>();
  const ids = [...new Set(authorIds)];
  if (ids.length === 0) return byId;
  try {
    const { data, error } = await client
      .from('profiles')
      .select('id, handle, display_name')
      .in('id', ids);
    if (error) return byId;
    for (const row of (data ?? []) as {
      id: string;
      handle: string | null;
      display_name: string | null;
    }[]) {
      byId.set(row.id, { id: row.id, handle: row.handle, displayName: row.display_name });
    }
  } catch {
    return byId;
  }
  return byId;
}

/**
 * Share tokens for the nights these posts belong to — V8-R-FEED-004's server
 * authorization, performed by READING as the caller.
 *
 * THROUGH THE SCOPED RPC, NEVER THE TABLE. This read used to be
 * `.from('night_outs').select('id, share_token')`, justified by "night_outs RLS returns
 * only the nights this viewer is owner of or a member of (0044) ... the rule is not
 * restated here; it is exercised."
 *
 * The rule was never exercised. 0047 deliberately revoked `share_token` from
 * `authenticated` — a share token is a CAPABILITY, and a table grant would hand every
 * user every token — so the query was denied at the PERMISSION layer, which runs BEFORE
 * any policy. RLS was not consulted, the select failed 42501 for every caller, and
 * "View night" (V8-R-FEED-004) never rendered for anyone. The `catch` swallowed it.
 *
 * `get_night_out` is the member-scoped accessor that already exists for this: it returns
 * `share_token` only to a caller whose invite_status entitles them to it, and NULL to
 * everyone else. Reusing it keeps the entitlement rule in ONE place instead of restating
 * it in a second, weaker form here.
 *
 * ponytail: one RPC per distinct night on a page, bounded by the feed's own `limit`.
 * Add a member-scoped bulk RPC if a page ever carries enough distinct nights to matter;
 * a new grant surface is not the answer either way.
 */
async function fetchNightTokens(
  client: SupabaseClient,
  nightIds: readonly (string | null)[],
): Promise<{ byId: Map<string, string>; unread: Set<string> }> {
  const byId = new Map<string, string>();
  // NIGHTS WE COULD NOT ASK ABOUT, kept apart from nights the answer was "no" for.
  // `getNightOut` returns null for BOTH a refusal and an outage, and collapsing
  // them made a failed read look like a settled "you may not open this": the
  // action simply vanished, with nothing anywhere saying a read had failed. That
  // is the same false-ready-state class as an empty thread standing for an unread
  // one, on the card's other control.
  const unread = new Set<string>();
  const ids = [...new Set(nightIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return { byId, unread };
  const settled = await Promise.all(ids.map(async (id) => {
    try {
      // The RPC directly rather than through `getNightOut`, ONLY so the error is
      // visible here. It is the same entitlement-scoped accessor, so the rule
      // still lives in one place — the database — and is not restated.
      const { data, error } = await client.rpc('get_night_out', { p_night_out: id });
      if (error) return [id, 'unread'] as const;
      const rows = (Array.isArray(data) ? data : [data]).filter(Boolean) as {
        share_token: string | null;
      }[];
      return [id, rows[0]?.share_token ?? null] as const;
    } catch {
      return [id, 'unread'] as const;
    }
  }));
  for (const [id, token] of settled) {
    if (token === 'unread') unread.add(id);
    // A null token is "this viewer may not open it" — the card renders no "View
    // night", which is the outcome V8-R-FEED-004 describes.
    else if (token !== null) byId.set(id, token);
  }
  return { byId, unread };
}

/**
 * A signed URL for one media object, minted by the SERVER.
 *
 * Never `storage.createSignedUrl` from here: "the mint itself is a client call,
 * and a client may pass any `expiresIn` it likes". The route reads the window
 * from the database and decides the lifetime, and 0069 is what teaches that
 * window about the Feed destination.
 *
 * Returns null for every refusal — unauthorized, reclaimed bytes, an outage —
 * and the caller renders the honest unavailable state rather than a blank frame.
 */
async function fetchMediaUrl(
  client: SupabaseClient,
  mediaId: string,
): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;

    const response = await fetch(`/api/media/${encodeURIComponent(mediaId)}/url`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { ok?: boolean; url?: string };
    return body.ok === true && typeof body.url === 'string' ? body.url : null;
  } catch {
    return null;
  }
}

/**
 * Author delete (V8-R-FEED-002). Soft, so the read gate — and the gate on every
 * comment beneath it — closes in the same commit.
 *
 * `reclaimable` is the honest report of whether the bytes may now go: the post's
 * destination is retired inside the RPC, so this is the count AFTER retirement.
 * Reclamation itself is `/api/media/reclaim`, not this call.
 */
export async function deleteFeedPost(
  client: SupabaseClient | null,
  postId: string,
): Promise<MediaResult<{ mediaId: string; reclaimable: boolean }>> {
  if (client === null) return mediaUnavailable();
  try {
    const { data, error } = await client.rpc('delete_feed_post', { p_post_id: postId });
    if (error) return mediaFailure('failed', 'That post could not be removed.');

    const rows = (Array.isArray(data) ? data : [data]).filter(Boolean) as {
      media_id: string;
      reclaimable: boolean;
    }[];
    // Zero rows is the RPC saying the deletion did NOT happen — not the author,
    // already deleted, or never existed. It must never be reported as success.
    if (rows.length === 0) {
      return mediaFailure('denied', 'That post is not yours to remove.');
    }
    return {
      ok: true,
      value: { mediaId: rows[0].media_id, reclaimable: rows[0].reclaimable === true },
    };
  } catch {
    return mediaUnavailable();
  }
}

/**
 * The visible thread on these posts (V8-R-FEED-003), oldest first.
 *
 * ONE BOUNDED READ PER POST. A single batched read was the first shape here and it
 * carried a flat ceiling across every card, which is what let one busy post starve
 * the others — see {@link FEED_COMMENTS_PER_POST} for the two symptoms that came
 * of it. Per post, every card gets its own budget and its own definite answer.
 *
 * EITHER EVERY THREAD IS READ OR THE READ FAILED. One post's refusal fails the
 * whole call rather than returning a map with a silent hole in it: the caller
 * distinguishes "not read" from "read, and empty" by key presence, so a partial
 * success would quietly turn one card's outage into a permanent unread state with
 * no banner to say why.
 */
export async function fetchFeedComments(
  client: SupabaseClient | null,
  postIds: readonly string[],
): Promise<MediaResult<Map<string, FeedComment[]>>> {
  if (client === null) return mediaUnavailable();
  const byPost = new Map<string, FeedComment[]>();
  const ids = [...new Set(postIds)];
  if (ids.length === 0) return { ok: true, value: byPost };

  try {
    // NEWEST FIRST, THEN BOUNDED, THEN REVERSED FOR DISPLAY. Reading oldest-first
    // with a limit keeps the oldest replies and drops the newest — a just-sent
    // reply vanishing is the one truncation a reply surface must never choose. The
    // rows come back descending, the bound cuts the tail, and the thread is
    // flipped into the oldest-first order it renders in.
    const threads = await Promise.all(ids.map(async (postId) => {
      const { data, error } = await client
        .from('feed_comments')
        .select('id, post_id, author_id, body, created_at')
        .eq('post_id', postId)
        .order('created_at', { ascending: false })
        .limit(FEED_COMMENTS_PER_POST);
      if (error) return null;
      const rows = (data ?? []) as Parameters<typeof toComment>[0][];
      return [postId, rows.map(toComment).reverse()] as const;
    }));

    if (threads.some((thread) => thread === null)) {
      return mediaFailure('failed', 'Those replies could not be loaded.');
    }
    for (const thread of threads) {
      if (thread !== null) byPost.set(thread[0], thread[1]);
    }
    return { ok: true, value: byPost };
  } catch {
    return mediaUnavailable();
  }
}

/**
 * Leave a comment (V8-R-FEED-003 / V8-R-FEED-005).
 *
 * The bound here is a message, not the boundary: 0069 refuses an over-long body
 * server-side too, because this RPC is reachable directly over PostgREST and a
 * cap that lives only in the app bounds the app's own UI and nothing else.
 */
export async function addFeedComment(
  client: SupabaseClient | null,
  postId: string,
  body: string,
): Promise<MediaResult<FeedComment>> {
  if (client === null) return mediaUnavailable();

  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return mediaFailure('rejected', 'A reply needs some words.');
  }
  if (trimmed.length > MAX_FEED_COMMENT_LENGTH) {
    return mediaFailure('rejected', 'That reply is too long.');
  }

  try {
    const { data, error } = await client.rpc('add_feed_comment', {
      p_post_id: postId,
      p_body: trimmed,
    });
    if (error || !data) {
      return rpcFailure(
        error?.code,
        'You can only reply to posts you can see.',
        'That reply could not be sent.',
      );
    }
    return {
      ok: true,
      value: toComment(
        (Array.isArray(data) ? data[0] : data) as Parameters<typeof toComment>[0],
      ),
    };
  } catch {
    return mediaUnavailable();
  }
}

/**
 * Delete a comment (V8-R-FEED-008) — the commenter's own, or any comment on the
 * caller's own post.
 *
 * `false` from the RPC means nothing was deleted, and it is reported as a
 * denial: "a failed deletion must not report success."
 */
export async function deleteFeedComment(
  client: SupabaseClient | null,
  commentId: string,
): Promise<MediaResult<true>> {
  if (client === null) return mediaUnavailable();
  try {
    const { data, error } = await client.rpc('delete_feed_comment', {
      p_comment_id: commentId,
    });
    if (error) return mediaFailure('failed', 'That reply could not be removed.');
    if (data !== true) {
      return mediaFailure('denied', 'That reply is not yours to remove.');
    }
    return { ok: true, value: true };
  } catch {
    return mediaUnavailable();
  }
}
