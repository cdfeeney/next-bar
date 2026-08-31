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
 * orphan rather than pretend it did not happen — and every caller in this
 * repository now DOES report it (see {@link reportOrphans}); dropping the
 * field was how the honest return value became a silent one.
 *
 * TWO OBLIGATIONS THIS LAYER DOES NOT DISCHARGE, recorded here because the
 * only thing worse than an unmet obligation is one that is written down as met:
 *
 *   1. SERVER-SIDE RE-ENCODE. Nothing here decodes and re-encodes the uploaded
 *      object, so EXIF/GPS stripping depends on the capture pipeline having
 *      done it in the browser. That pipeline now fails closed rather than
 *      passing raw bytes through, and migration 0065 restricts the bucket to
 *      image MIME types, but a MODIFIED client can still upload original bytes
 *      with their metadata intact. Closing it needs an upload path that runs on
 *      a server (an edge function or a route handler); this build has none.
 *
 *   2. TTL IS CLAMPED HERE, NOT IN THE DATABASE. {@link signedUrlTtlSeconds}
 *      caps a URL at the story's remaining life, but the mint itself is a
 *      client call, and a client may pass any `expiresIn` it likes: Storage
 *      checks the SELECT policy at mint time, not the requested lifetime. So an
 *      authorised viewer can mint a long-lived URL while the story is still
 *      live and keep the bytes after expiry. The RLS change in 0065 shrinks the
 *      window (an expired or deleted story can no longer be signed at all, by
 *      anyone including its author) but does not kill an already-minted URL.
 *      Both a server-minted URL and the physical expiry sweep 0065's header
 *      records are required to close it properly.
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
  /**
   * Profile ids of the people tagged in this story, with withdrawn tags
   * already removed. Empty on the publish return, which reports the row the
   * RPC created rather than a read of it.
   */
  tagIds: string[];
};

/** A story with short-lived signed URLs resolved for rendering. */
export type StoryView = StoryRow & {
  mediaUrl: string | null;
  insetUrl: string | null;
  /**
   * WHY a null URL is not self-describing. `mediaUrl: null` used to mean three
   * different things — the story has expired, signing failed, or there is no
   * inset — and the viewer rendered all three as an empty frame. A signing
   * failure is an OUTAGE and the user is owed an honest "couldn't load this"
   * rather than a story that silently looks like it has no photo.
   *
   * 'ok'        — URLs are present (or the inset legitimately does not exist).
   * 'expired'   — no grantable lifetime remains; nothing was minted, by design.
   * 'unsigned'  — signing FAILED. Show an unavailable state, not a blank frame.
   */
  mediaState: 'ok' | 'expired' | 'unsigned';
  /**
   * False when the story_tags read FAILED, so `tagIds` is not known to be the
   * whole list. An empty tag list then means "we could not find out", not
   * "nobody is tagged" — and the difference matters to exactly the person it
   * hurts: a tagged user whose tag row failed to load loses the people chip and
   * the Remove-me consent control behind it, with nothing saying why.
   */
  tagsComplete: boolean;
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

function toStory(row: DbRow, tagIds: string[] = []): StoryRow {
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
    tagIds,
  };
}

/**
 * How long a signed URL for this story may live: whatever is LEFT of the story,
 * capped at {@link SIGNED_URL_MAX_SECONDS}, and ZERO once less than one whole
 * second remains.
 *
 * This is a CAP on a bearer token, not the authorization gate. The gate is the
 * database: 0065's RLS refuses expired and deleted rows to everyone, authors
 * included. A URL already minted stays valid for its remaining TTL even if the
 * story is deleted a moment later — that residual window is bounded by
 * min(time left, {@link SIGNED_URL_MAX_SECONDS}) and is stated here rather than
 * described as enforcement it does not perform.
 *
 * Exported because it is the rule item 3 of the V8 amendment states, and a rule
 * that only exists inline cannot be tested.
 */
export function signedUrlTtlSeconds(
  expiresAt: string,
  now: number = Date.now(),
): number {
  const remainingMs = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remainingMs)) return 0;
  // Under a second left is NOT a second of life. The floor used to be
  // Math.max(1, ...), which turned any remainder from 1ms to 999ms into a
  // one-second URL that outlives expires_at — a bearer link to content the
  // database has already stopped serving, which is the one thing this
  // function exists to prevent. Below one second there is no grantable
  // lifetime, so nothing is minted.
  const remainingSeconds = Math.floor(remainingMs / 1000);
  if (remainingSeconds < 1) return 0;
  return Math.min(SIGNED_URL_MAX_SECONDS, remainingSeconds);
}

/** The object key convention migration 0065's bucket policies enforce. */
export function storyObjectKey(
  authorId: string,
  storyId: string,
  side: 'main' | 'inset',
): string {
  return `${authorId}/${storyId}/${side}`;
}

/**
 * Object keys that could not be removed, surfaced rather than dropped.
 *
 * The publish and delete paths deliberately RETURN orphan paths instead of
 * pretending cleanup succeeded, and then every caller dropped the field —
 * which made the honest return value indistinguishable from a silent one. This
 * is the one place that reports them, so a private object left behind by a
 * failed cleanup is visible in a log rather than only in the bucket.
 *
 * Reporting is the LAST step, not the only one: {@link removeBytes} now makes
 * one bounded retry before anything reaches here, so what this logs is an
 * object that survived two attempts. Durable reclamation remains the expiry
 * sweep 0065's header records — the retry narrows the window, it does not
 * replace the sweep, and neither is a substitute for the other.
 */
export function reportOrphans(context: string, orphans: readonly string[] | undefined): void {
  if (orphans === undefined || orphans.length === 0) return;
  console.error(
    `[stories] ${context}: ${orphans.length} object(s) left in ${STORY_BUCKET} after a failed cleanup: ${orphans.join(', ')}`,
  );
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

  // Set the instant the RPC is issued. After that point a thrown error means
  // the OUTCOME IS UNKNOWN, not that publication failed — see the catch below.
  let rpcIssued = false;

  // Same bounded retry as the delete path: a transient failure here used to
  // become a permanent orphan on the first attempt.
  const cleanup = async (): Promise<string[]> => {
    if (uploaded.length === 0) return [];
    return removeBytes(client, uploaded);
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

    rpcIssued = true;
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
    // AN AMBIGUOUS FAILURE IS NOT A FAILED PUBLICATION. Once the RPC has been
    // issued, a thrown error can mean the response was lost after the story
    // COMMITTED. Deleting the bytes here then left a live, audience-visible
    // story whose photo had been destroyed, while telling the author "Nothing
    // was shared" — the worst of both, and unrecoverable.
    //
    // Before the RPC is issued nothing can have been published, so cleanup is
    // safe and correct. After it, the bytes are left alone and the outcome is
    // reported as unknown; the story either exists (and still has its photo) or
    // it does not, and the author is told to look rather than misled.
    if (rpcIssued) {
      return {
        ok: false,
        reason: 'unavailable',
        message: 'We lost contact while sharing. Check your story before trying again — it may have posted.',
      };
    }
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
    // NO CLIENT-CLOCK EXPIRY FILTER. This used to carry
    // `.gt('expires_at', new Date(now).toISOString())`, which made whichever
    // clock this process runs on a second expiry gate alongside the database's.
    // Server time is authoritative: 0065's read policy is "unexpired, not
    // deleted, by these authors", and it is evaluated against the DATABASE's
    // now(). A process clock running fast then hid stories the database was
    // still serving, and one running slow contributed nothing the policy had
    // not already refused. `now` below is used only to CAP a signed-URL TTL,
    // never to decide what is visible.
    const { data, error } = await client
      .from('stories')
      .select('id, author_id, bar_id, caption, media_path, inset_path, media_kind, audience, created_at, expires_at')
      .order('created_at', { ascending: false });
    if (error) {
      return { ok: false, reason: 'failed', message: 'Stories could not be loaded.' };
    }
    const rows = (data ?? []) as DbRow[];
    const tags = await fetchTags(client, rows.map((row) => row.id));
    const views = await Promise.all(rows.map(async (row) => {
      const story = toStory(row, tags.byStory.get(row.id) ?? []);
      const ttl = signedUrlTtlSeconds(story.expiresAt, now);
      if (ttl <= 0) {
        return {
          ...story, mediaUrl: null, insetUrl: null,
          mediaState: 'expired' as const, tagsComplete: tags.ok,
        };
      }
      const [main, inset] = await Promise.all([
        signUrl(client, story.mediaPath, ttl),
        story.insetPath === null ? Promise.resolve(null) : signUrl(client, story.insetPath, ttl),
      ]);
      // A failed SIGNING is an outage, not an absent photo. `main === null`
      // here means the signer refused or threw; the inset is only a failure
      // when there was an inset path to sign in the first place.
      const insetFailed = story.insetPath !== null && inset === null;
      const mediaState = main === null || insetFailed ? ('unsigned' as const) : ('ok' as const);
      return { ...story, mediaUrl: main, insetUrl: inset, mediaState, tagsComplete: tags.ok };
    }));
    return { ok: true, value: views };
  } catch {
    return unavailable();
  }
}

/**
 * Live tags for these stories, keyed by story id.
 *
 * A SECOND QUERY RATHER THAN AN EMBED. `story_tags` has its own RLS policy and
 * its own `removed_at` gate, and a PostgREST embed would have made the tag
 * list a nested shape whose failure mode is a whole-story read failing because
 * a tag read failed. Tags are decoration on a story, never its gate: if this
 * query fails the stories still render, with no people chip.
 *
 * WITHOUT THIS the tag surface is unreachable code. Publication wrote
 * `story_tags` rows and nothing ever read them back, so the people chip, the
 * tagged-people sheet and its "Remove me" consent control could never appear —
 * a tagged person had no way to learn they were tagged, let alone withdraw.
 */
async function fetchTags(
  client: SupabaseClient,
  storyIds: readonly string[],
): Promise<{ byStory: Map<string, string[]>; ok: boolean }> {
  const byStory = new Map<string, string[]>();
  if (storyIds.length === 0) return { byStory, ok: true };
  try {
    const { data, error } = await client
      .from('story_tags')
      .select('story_id, profile_id')
      .in('story_id', [...storyIds])
      .is('removed_at', null);
    if (error) return { byStory, ok: false };
    for (const row of (data ?? []) as { story_id: string; profile_id: string }[]) {
      const list = byStory.get(row.story_id) ?? [];
      list.push(row.profile_id);
      byStory.set(row.story_id, list);
    }
  } catch {
    // A failed tag read is a missing chip, never a missing story — but it must
    // not be silent. A tagged person whose tag row failed to load loses the
    // people chip AND the Remove-me control behind it, which is their only
    // consent withdrawal; showing that as "nobody is tagged" is the dishonest
    // state this flag exists to let the UI avoid.
    return { byStory, ok: false };
  }
  return { byStory, ok: true };
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
    // BYTES FIRST, THEN THE SOFT DELETE — the order is load-bearing.
    //
    // `story_media_is_dead` makes the owner-read storage policy refuse an object
    // the moment its story is deleted, and Supabase Storage's remove() needs the
    // object to pass SELECT as well as DELETE. Removing after the RPC therefore
    // matched zero rows, silently: storage-js reports no error for a name it
    // cannot see, so the cleanup reported success, the orphan report never
    // fired, and every deleted story's bytes stayed in the private bucket with
    // no sweep to reclaim them. The policy repair that closed the expiry hole
    // had quietly broken deletion.
    //
    // Read the paths while the story is still live (the author-reads-own policy
    // allows it) and remove the bytes then. If the RPC afterwards fails, the
    // author is told honestly and can retry — a retryable broken story is a far
    // better failure than permanent private orphans nothing reclaims.
    const { data: pre } = await client
      .from('stories')
      .select('media_path, inset_path')
      .eq('id', storyId)
      .limit(1);
    const prePaths = ((pre ?? []) as { media_path: string; inset_path: string | null }[])
      .flatMap((r) => [r.media_path, r.inset_path])
      .filter((p): p is string => p !== null);
    const preOrphans = prePaths.length > 0 ? await removeBytes(client, prePaths) : [];

    const { data, error } = await client.rpc('delete_story', { p_story_id: storyId });
    if (error) {
      return {
        ok: false,
        reason: 'failed',
        message: prePaths.length > 0 && preOrphans.length === 0
          ? 'The photo was removed but the story could not be deleted. Try again.'
          : 'The story could not be removed.',
      };
    }
    const rows = (Array.isArray(data) ? data : [data]).filter(Boolean) as
      { media_path: string; inset_path: string | null }[];
    if (rows.length === 0) {
      // No row matched: not the author, already deleted, or never existed. The
      // storage policy is prefix-scoped, so a non-author's removeBytes above
      // could not have touched anyone else's object.
      return { ok: false, reason: 'denied', message: 'That story is not yours to remove.' };
    }
    // Whatever the RPC names that the pre-read did not cover (it normally names
    // the same objects, already gone).
    const paths = rows
      .flatMap((r) => [r.media_path, r.inset_path])
      .filter((p): p is string => p !== null)
      .filter((p) => !prePaths.includes(p) || preOrphans.includes(p));
    // THE SOFT-DELETE HAS ALREADY SUCCEEDED. Everything below is byte cleanup,
    // and it must never turn a completed deletion into a reported failure: the
    // read gate closed the moment `delete_story` returned, so the story IS gone
    // for every reader. Previously a THROW from storage.remove() (not an
    // returned error — a throw) escaped to the outer catch and surfaced as
    // "Stories are unavailable right now. Nothing was shared.", telling the
    // author their delete failed while the row was already soft-deleted. The
    // honest outcome is success plus a reported orphan.
    // Anything still outstanding after the pre-delete pass. These are now dead
    // objects (the story is soft-deleted), so the owner policy refuses them and
    // this attempt is expected to fail — it is reported, not retried into a loop.
    const late = paths.length > 0 ? await removeBytes(client, paths) : [];
    const orphans = [...new Set([...preOrphans, ...late])];
    return { ok: true, value: { orphans } };
  } catch {
    return unavailable();
  }
}

/**
 * Remove object bytes, returning whatever could not be removed.
 *
 * ONE bounded retry, then report. A single retry covers the common transient
 * failure (a dropped connection, a momentary 5xx) that the previous
 * report-only path turned into a permanent orphan; retrying further would just
 * race the same failing remove. Durable reclamation is still the expiry sweep
 * 0065's header records — this narrows the window, it does not replace it.
 *
 * Never throws: a throw here would be indistinguishable from a failed delete.
 */
async function removeBytes(
  client: SupabaseClient,
  paths: readonly string[],
): Promise<string[]> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { error } = await client.storage.from(STORY_BUCKET).remove([...paths]);
      if (!error) return [];
    } catch {
      // fall through to the retry, then to the orphan report
    }
  }
  return [...paths];
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
