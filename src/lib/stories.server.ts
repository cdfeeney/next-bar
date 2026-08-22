import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-mode Stories (migration 0065). Pure async functions — the React layer
 * stays free of SQL, RPC and Storage specifics.
 *
 * THE DATABASE IS AUTHORITATIVE. This module never decides who may see a story:
 * `public.stories` RLS does, and it evaluates `expires_at > now()` on every
 * query. A story stops being readable at that instant whatever this client
 * believes and whether or not cleanup has run. Nothing here filters by
 * expiry as a substitute for that gate — the client-side check that exists
 * is only to avoid rendering a row the server would refuse on the next call.
 *
 * FAILURE IS HONEST. Every function returns a discriminated result rather than
 * throwing, and an unreachable or unconfigured Supabase returns `unavailable` —
 * never a local fallback that reports success. A story that did not reach the
 * database was not shared, and the caller must say so.
 *
 * PARTIAL UPLOADS ARE CLEANED UP. Publication is upload-then-publish, because
 * the bucket policy can decide ownership from the key prefix alone before any
 * row exists. If the metadata publish then fails, the bytes are removed again;
 * if that removal ALSO fails the paths are returned so the caller can report an
 * orphan rather than pretend it did not happen.
 */

/** Bucket created by migration 0065. Private: no anonymous object URL exists. */
export const STORY_BUCKET = 'story-media';

/**
 * Ceiling on a signed media URL. The effective lifetime is always
 * `min(this, time left on the story)` — see {@link signedUrlTtlSeconds}. A URL
 * that outlived its story would be a readable link to content the database has
 * already stopped serving, which is the whole point of the expiry gate.
 */
export const SIGNED_URL_MAX_SECONDS = 300;

export type StoryAudience = 'friends' | 'custom';

export type StoryRow = {
  id: string;
  authorId: string;
  barId: string | null;
  caption: string | null;
  mediaPath: string;
  insetPath: string | null;
  mediaKind: 'single' | 'dual';
  audience: StoryAudience;
  createdAt: string;
  expiresAt: string;
};

/** A story with short-lived signed URLs resolved for rendering. */
export type StoryView = StoryRow & {
  mediaUrl: string | null;
  insetUrl: string | null;
};

export type StoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'unavailable' | 'denied' | 'invalid' | 'failed'; message: string;
      /** Object keys left behind when cleanup could not remove them. */
      orphans?: string[] }

type DbRow = {
  id: string;
  author_id: string;
  bar_id: string | null;
  caption: string | null;
  media_path: string;
  inset_path: string | null;
  media_kind: 'single' | 'dual';
  audience: StoryAudience;
  created_at: string;
  expires_at: string;
};

function toStory(row: DbRow): StoryRow {
  return {
    id: row.id,
    authorId: row.author_id,
    barId: row.bar_id,
    caption: row.caption,
    mediaPath: row.media_path,
    insetPath: row.inset_path,
    mediaKind: row.media_kind,
    audience: row.audience,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/**
 * How long a signed URL for this story may live: whatever is LEFT of the
 * story, capped, and never less than one second.
 *
 * Exported because it is the rule item 3 of the V8 amendment states, and a rule
 * that only exists inline cannot be tested.
 */
export function signedUrlTtlSeconds(
  expiresAt: string,
  now: number = Date.now(),
): number {
  const remainingMs = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  return Math.max(1, Math.min(SIGNED_URL_MAX_SECONDS, Math.floor(remainingMs / 1000)));
}

/** The object key convention migration 0065's bucket policies enforce. */
export function storyObjectKey(
  authorId: string,
  storyId: string,
  side: 'main' | 'inset',
): string {
  return `${authorId}/${storyId}/${side}`;
}

function unavailable<T>(): StoryResult<T> {
  return {
    ok: false,
    reason: 'unavailable',
    message: 'Stories are unavailable right now. Nothing was shared.',
  };
}

/**
 * Publish: upload the bytes, then publish the metadata. "Shared" is only true
 * when BOTH succeed.
 *
 * `draftId` names the object folder before a story row exists. It is not the
 * story id — the row's id is assigned by the database — which is why the
 * bucket policy keys ownership off the FIRST path segment (the author) rather
 * than off a story that may never be created.
 */
export async function publishStory(
  client: SupabaseClient | null,
  input: {
    authorId: string;
    draftId: string;
    main: Blob;
    inset?: Blob | null;
    barId?: string | null;
    caption?: string | null;
    audience: StoryAudience;
    audienceIds?: string[];
    tagIds?: string[];
  },
): Promise<StoryResult<StoryRow>> {
  if (client === null) return unavailable();

  const mainPath = storyObjectKey(input.authorId, input.draftId, 'main');
  const insetPath = input.inset ? storyObjectKey(input.authorId, input.draftId, 'inset') : null;
  const uploaded: string[] = [];

  const cleanup = async (): Promise<string[]> => {
    if (uploaded.length === 0) return [];
    try {
      const { error } = await client.storage.from(STORY_BUCKET).remove(uploaded);
      return error ? [...uploaded] : [];
    } catch {
      return [...uploaded];
    }
  };

  try {
    const mainUpload = await client.storage
      .from(STORY_BUCKET)
      .upload(mainPath, input.main, { upsert: false, contentType: input.main.type || 'image/jpeg' });
    if (mainUpload.error) {
      return { ok: false, reason: 'failed', message: 'The photo could not be uploaded. Nothing was shared.' };
    }
    uploaded.push(mainPath);

    if (input.inset && insetPath !== null) {
      const insetUpload = await client.storage
        .from(STORY_BUCKET)
        .upload(insetPath, input.inset, { upsert: false, contentType: input.inset.type || 'image/jpeg' });
      if (insetUpload.error) {
        const orphans = await cleanup();
        return {
          ok: false, reason: 'failed', orphans,
          message: 'The second photo could not be uploaded. Nothing was shared.',
        };
      }
      uploaded.push(insetPath);
    }

    const { data, error } = await client.rpc('publish_story', {
      p_media_path: mainPath,
      p_media_kind: insetPath === null ? 'single' : 'dual',
      p_inset_path: insetPath,
      p_bar_id: input.barId ?? null,
      p_caption: input.caption ?? null,
      p_audience: input.audience,
      p_audience_ids: input.audienceIds ?? [],
      p_tag_ids: input.tagIds ?? [],
    });

    if (error || !data) {
      const orphans = await cleanup();
      // 42501 is the RPC's own "not a mutual friend" / "not your object" refusal.
      const denied = typeof error?.code === 'string' && error.code === '42501';
      return {
        ok: false,
        reason: denied ? 'denied' : 'failed',
        orphans,
        message: denied
          ? 'Everyone you pick has to be a friend who follows you back. Nothing was shared.'
          : 'The story could not be published. Nothing was shared.',
      };
    }

    const row = (Array.isArray(data) ? data[0] : data) as DbRow;
    return { ok: true, value: toStory(row) };
  } catch {
    const orphans = await cleanup();
    return { ok: false, reason: 'unavailable', orphans, message: 'Stories are unavailable right now. Nothing was shared.' };
  }
}

/**
 * Every story the caller may currently read — theirs and their friends'.
 *
 * The WHERE clause here is not the security boundary; RLS is. It exists so an
 * expired row that RLS would refuse on the next call is not rendered in the
 * meantime.
 */
export async function fetchVisibleStories(
  client: SupabaseClient | null,
  now: number = Date.now(),
): Promise<StoryResult<StoryView[]>> {
  if (client === null) return unavailable();
  try {
    const { data, error } = await client
      .from('stories')
      .select('id, author_id, bar_id, caption, media_path, inset_path, media_kind, audience, created_at, expires_at')
      .gt('expires_at', new Date(now).toISOString())
      .order('created_at', { ascending: false });
    if (error) {
      return { ok: false, reason: 'failed', message: 'Stories could not be loaded.' };
    }
    const rows = (data ?? []) as DbRow[];
    const views = await Promise.all(rows.map(async (row) => {
      const story = toStory(row);
      const ttl = signedUrlTtlSeconds(story.expiresAt, now);
      if (ttl <= 0) return { ...story, mediaUrl: null, insetUrl: null };
      const [main, inset] = await Promise.all([
        signUrl(client, story.mediaPath, ttl),
        story.insetPath === null ? Promise.resolve(null) : signUrl(client, story.insetPath, ttl),
      ]);
      return { ...story, mediaUrl: main, insetUrl: inset };
    }));
    return { ok: true, value: views };
  } catch {
    return unavailable();
  }
}

async function signUrl(
  client: SupabaseClient,
  path: string,
  ttlSeconds: number,
): Promise<string | null> {
  try {
    const { data, error } = await client.storage
      .from(STORY_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    return error ? null : (data?.signedUrl ?? null);
  } catch {
    return null;
  }
}

/**
 * Author delete / Undo. The RPC soft-deletes and hands back the object keys so
 * the bytes go too; the read gate has already closed by then, so a failed byte
 * removal leaves an orphan rather than readable content.
 */
export async function deleteStory(
  client: SupabaseClient | null,
  storyId: string,
): Promise<StoryResult<{ orphans: string[] }>> {
  if (client === null) return unavailable();
  try {
    const { data, error } = await client.rpc('delete_story', { p_story_id: storyId });
    if (error) {
      return { ok: false, reason: 'failed', message: 'The story could not be removed.' };
    }
    const rows = (Array.isArray(data) ? data : [data]).filter(Boolean) as
      { media_path: string; inset_path: string | null }[];
    if (rows.length === 0) {
      // No row matched: not the author, already deleted, or never existed.
      return { ok: false, reason: 'denied', message: 'That story is not yours to remove.' };
    }
    const paths = rows.flatMap((r) => [r.media_path, r.inset_path]).filter((p): p is string => p !== null);
    let orphans: string[] = [];
    if (paths.length > 0) {
      const { error: removeError } = await client.storage.from(STORY_BUCKET).remove(paths);
      if (removeError) orphans = paths;
    }
    return { ok: true, value: { orphans } };
  } catch {
    return unavailable();
  }
}

/** Consent withdrawal by the TAGGED person. Never the author's call. */
export async function removeMyStoryTag(
  client: SupabaseClient | null,
  storyId: string,
): Promise<StoryResult<boolean>> {
  if (client === null) return unavailable();
  try {
    const { data, error } = await client.rpc('remove_my_story_tag', { p_story_id: storyId });
    if (error) {
      return { ok: false, reason: 'failed', message: 'Your tag could not be removed.' };
    }
    return { ok: true, value: data === true };
  } catch {
    return unavailable();
  }
}
