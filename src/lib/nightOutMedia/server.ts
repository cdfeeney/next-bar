import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  NightOutMediaItem,
  SavedNight,
  SavedNightCard,
} from './index';

/**
 * Server-mode Night Out media and Saved Nights Out (migration 0068).
 *
 * House pattern (presence/server.ts, suggestions.server.ts): pure async
 * functions, null/false on transport or RLS error, never throw.
 *
 * EVERY GATE IS SERVER-SIDE and none of it is repeated here as if it were
 * enforcement. Membership, byte ownership, the 24-hour window and the
 * private-archive scope all live in the SECURITY DEFINER functions; this module
 * carries requests to them and validates what comes back so a malformed row is
 * dropped rather than rendered. The one thing it must never do is report success
 * for something the server did not confirm — V8-R-NO-009: "a failed archive must
 * not report success, and must not consume the window."
 *
 * NULL MEANS "COULD NOT READ", [] MEANS "NOTHING THERE". Callers must keep them
 * apart, the same rule presence follows: rendering an empty archive for a failed
 * read tells the owner their nights are gone (V8-R-ACC-002's failure clause is
 * explicit that "a night that cannot be read states so rather than rendering an
 * empty archive").
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * The ONE place an RPC is called, so "never throw" is a property of the module
 * rather than a habit five call sites have to keep.
 *
 * A Supabase call has two failure shapes and only one of them arrives as
 * `error`: a transport fault, an offline client, or a client object that is not
 * a real client at all THROWS. Reading only `error` therefore lets a rejection
 * escape into whatever called it — in React, into an unhandled rejection that
 * takes the effect down and leaves the surface stuck on its loading state
 * forever, which is the one state that never resolves into an honest message.
 *
 * `media/destinations.ts` wraps every call for the same reason; this is the same
 * rule, applied once here instead of repeated.
 *
 * A throw is reported as an error, never as `data: null, error: null` — the
 * callers read a null-with-no-error as "the server answered with nothing", which
 * is a completely different claim from "we never reached the server".
 */
async function callRpc(
  supabase: SupabaseClient,
  fn: string,
  args?: Record<string, unknown>,
): Promise<{ data: unknown; error: unknown }> {
  try {
    // TRANSPARENT: a no-argument RPC is called with no second argument, not
    // with an explicit `undefined`. Equivalent to Supabase, not to a test
    // asserting the call shape — and `get_saved_nights` taking no arguments is
    // exactly why it can only ever answer about the calling account.
    return args === undefined
      ? await supabase.rpc(fn)
      : await supabase.rpc(fn, args);
  } catch (thrown) {
    return { data: null, error: thrown ?? new Error(`${fn} threw`) };
  }
}

/**
 * Attach one already-uploaded object to a Night Out.
 *
 * Returns the destination id on success and null on refusal — not a member, not
 * the caller's bytes, or the window has closed. All three are the server's
 * decision; the client cannot tell them apart on purpose, because which one it
 * was is information about a plan the caller may not be in.
 */
export async function addNightOutMedia(
  supabase: SupabaseClient,
  nightOutId: string,
  mediaId: string,
): Promise<string | null> {
  if (!isUuid(nightOutId) || !isUuid(mediaId)) return null;
  const { data, error } = await callRpc(supabase, 'add_night_out_media', {
    p_night_out: nightOutId,
    p_media: mediaId,
  });
  if (error) return null;
  return isUuid(data) ? data : null;
}

type MediaRow = {
  destination_id: unknown;
  media_id: unknown;
  author_id: unknown;
  storage_path: unknown;
  created_at: unknown;
  expires_at: unknown;
};

/**
 * The Night Out's live media, or null when the read failed.
 *
 * An EMPTY array is the honest answer both for "nobody has added a photo" and
 * for "the window has closed" — the server stops returning rows at the boundary
 * and the surface distinguishes the two from the window itself, not from this.
 */
export async function fetchNightOutMedia(
  supabase: SupabaseClient,
  nightOutId: string,
): Promise<NightOutMediaItem[] | null> {
  if (!isUuid(nightOutId)) return null;
  const { data, error } = await callRpc(supabase, 'get_night_out_media', {
    p_night_out: nightOutId,
  });
  if (error || !Array.isArray(data)) return null;

  return (data as MediaRow[]).flatMap((row) => {
    if (!isUuid(row?.destination_id)) return [];
    if (!isUuid(row?.media_id)) return [];
    if (!isUuid(row?.author_id)) return [];
    if (!isNonEmptyString(row?.storage_path)) return [];
    if (!isNonEmptyString(row?.created_at)) return [];
    if (!isNonEmptyString(row?.expires_at)) return [];
    return [
      {
        destinationId: row.destination_id,
        mediaId: row.media_id,
        authorId: row.author_id,
        storagePath: row.storage_path,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      },
    ];
  });
}

export type ArchiveResult = { savedNightId: string; photoCount: number };

/**
 * Privately archive this Night Out's live media to the caller's Saved Nights Out
 * (V8-R-NO-009).
 *
 * Null on ANY refusal or transport failure. There is no partial success to
 * report: the RPC does the whole archive in one transaction, so a null here
 * means nothing was written and the caller must say so rather than claiming a
 * save. A zero `photoCount` is a DIFFERENT answer — the archive happened and
 * there was nothing live left to put in it.
 */
export async function archiveNightOut(
  supabase: SupabaseClient,
  nightOutId: string,
): Promise<ArchiveResult | null> {
  if (!isUuid(nightOutId)) return null;
  const { data, error } = await callRpc(supabase, 'archive_night_out', {
    p_night_out: nightOutId,
  });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as
    | { saved_night_id?: unknown; photo_count?: unknown }
    | null
    | undefined;
  if (!row || !isUuid(row.saved_night_id)) return null;
  const count = Number(row.photo_count);
  return {
    savedNightId: row.saved_night_id,
    photoCount: Number.isFinite(count) && count >= 0 ? count : 0,
  };
}

type SavedNightRow = {
  id: unknown;
  title: unknown;
  night: unknown;
  bar_count: unknown;
  photo_count: unknown;
  archived_at: unknown;
  cover_media_ids: unknown;
};

const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

/** The caller's Saved Nights Out, newest night first. Null when unreadable. */
export async function fetchSavedNights(
  supabase: SupabaseClient,
): Promise<SavedNightCard[] | null> {
  const { data, error } = await callRpc(supabase, 'get_saved_nights');
  if (error || !Array.isArray(data)) return null;

  return (data as SavedNightRow[]).flatMap((row) => {
    if (!isUuid(row?.id)) return [];
    if (typeof row?.night !== 'string' || !NIGHT_RE.test(row.night)) return [];
    return [
      {
        id: row.id,
        title: isNonEmptyString(row.title) ? row.title : null,
        night: row.night,
        barCount: count(row.bar_count),
        photoCount: count(row.photo_count),
        archivedAt: isNonEmptyString(row.archived_at) ? row.archived_at : '',
        // Anything that is not a media id is dropped rather than passed to the
        // boundary route: asking about a key we cannot parse is asking about
        // somebody else's object.
        coverMediaIds: Array.isArray(row.cover_media_ids)
          ? row.cover_media_ids.filter(isUuid)
          : [],
      },
    ];
  });
}

type SavedNightDetailRow = {
  id: unknown;
  title: unknown;
  night: unknown;
  bar_count: unknown;
  archived_at: unknown;
  media_id: unknown;
  storage_path: unknown;
  sort_order: unknown;
};

/**
 * One archived night, "exactly as it was saved" (V8-R-ACC-002).
 *
 * Null means unreadable — a failed read, or a night that is not this account's.
 * A night with NO photos left still comes back as a night with an empty photo
 * list, because the RPC LEFT JOINs its media: "a night that cannot be read
 * states so rather than rendering an empty archive" cuts both ways, and an
 * archive whose bytes are gone is not the same as one that failed to load.
 */
export async function fetchSavedNight(
  supabase: SupabaseClient,
  savedNightId: string,
): Promise<SavedNight | null> {
  if (!isUuid(savedNightId)) return null;
  const { data, error } = await callRpc(supabase, 'get_saved_night', {
    p_id: savedNightId,
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;

  const rows = data as SavedNightDetailRow[];
  const head = rows[0];
  if (!isUuid(head?.id)) return null;
  if (typeof head?.night !== 'string' || !NIGHT_RE.test(head.night)) return null;

  return {
    id: head.id,
    title: isNonEmptyString(head.title) ? head.title : null,
    night: head.night,
    barCount: count(head.bar_count),
    archivedAt: isNonEmptyString(head.archived_at) ? head.archived_at : '',
    // The LEFT JOIN yields one all-null media half for a night with no photos.
    // Filtering on the id is what turns that back into an empty list instead of
    // one ghost photo.
    photos: rows.flatMap((row) =>
      isUuid(row.media_id) && isNonEmptyString(row.storage_path)
        ? [{ mediaId: row.media_id, storagePath: row.storage_path }]
        : [],
    ),
  };
}
