'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ComposerGroup, ComposerNightOut, PublishInput, PublishResult } from '@/components/composer/types';
import { deleteFeedPost, publishFeedPost } from '@/lib/feed.server';
import { deleteGroupMessage, fetchMyGroups, sendGroupMessage } from '@/lib/groups.server';
import { uploadImageThroughBoundary } from '@/lib/media/uploadClient';
import { nycNightKey } from '@/lib/nightKey';
import { addNightOutMedia, fetchNightOutMediaWindow } from '@/lib/nightOutMedia/server';
import { getMyNightOuts, type MyNightOut } from '@/lib/nightOuts.server';
import { getBrowserSupabase } from '@/lib/supabase/client';

import { publishEverywhere, undoEverywhere } from './addStoryPublish';
import type { UseStories } from './storyStore';

/**
 * Binds the composer's one-call publish contract to the real backends, and
 * loads the two things the Destinations screen needs to name: the author's
 * groups and tonight's night out.
 *
 * Tonight's plan comes from TWO reads, because `get_my_night_outs` (0059)
 * excludes the rows the caller OWNS: an accepted invitation comes from the RPC,
 * and a plan the caller created comes from a direct `night_outs` read, which
 * the 0044 RLS policy scopes to the caller's own and member rows. No migration.
 */
export function useAddStoryPublish(
  stories: Pick<UseStories, 'publish' | 'removeItem'>,
  youId: string | null,
  /**
   * True while the photo flow is OPEN. The targets are read when it opens —
   * not at page mount — so a plan started on the Plans sub-tab or a group
   * created in-session is offered, and visitors who never open the composer
   * never pay for the reads (Fable, S-11 r3).
   */
  active: boolean,
): {
  groups: readonly ComposerGroup[];
  groupsUnavailable: boolean;
  nightOut: ComposerNightOut | null;
  /** Why the Night Out row is held when `nightOut` is null for a reason other than "none". */
  nightOutNote: string | null;
  publish: (input: PublishInput) => Promise<PublishResult>;
  undo: (publishId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
} {
  const client = useMemo(() => getBrowserSupabase(), []);
  const [groups, setGroups] = useState<readonly ComposerGroup[]>([]);
  /** A FAILED groups read is not "no groups": the Group row says which (Codex, r2). */
  const [groupsUnavailable, setGroupsUnavailable] = useState(false);
  const [nightOut, setNightOut] = useState<ComposerNightOut | null>(null);
  const [nightOutNote, setNightOutNote] = useState<string | null>(null);

  useEffect(() => {
    // ACCOUNT- AND OPEN-SCOPED: dropped the moment the viewer changes or the
    // flow closes, refilled only from this account's reads on the next open.
    // A sign-out or account switch on a mounted page therefore never offers
    // the previous account's groups or plan as targets (Codex, round 1).
    setGroups([]);
    setGroupsUnavailable(false);
    setNightOut(null);
    setNightOutNote(null);
    if (!active || client === null || youId === null) return undefined;
    let cancelled = false;
    void (async () => {
      const nightKey = nycNightKey();
      const [mine, nights, owned] = await Promise.all([
        fetchMyGroups(client),
        getMyNightOuts(client),
        fetchOwnedTonight(client, youId, nightKey),
      ]);
      if (cancelled) return;
      if (mine.ok) {
        setGroups(mine.value.map((group) => ({ id: group.id, name: group.name, memberIds: [] })));
      } else {
        // Not an empty list: the row is held and says the read failed.
        setGroupsUnavailable(true);
      }
      const plan = tonightFrom(nights ?? [], nightKey) ?? owned;
      if (plan === null) return;
      // `add_night_out_media` refuses before the plan's media window opens
      // (0068, night_out_scheduled_start), so the row is held with the opening
      // time until then — asked of the SERVER, never the device clock.
      const window = await fetchNightOutMediaWindow(client, plan.id);
      if (cancelled) return;
      if (window !== null && !window.isOpen && window.state === 'before') {
        setNightOutNote(`${plan.label} · opens at ${formatNyTime(window.opensAt)}`);
        return;
      }
      setNightOut(plan);
    })();
    return () => {
      cancelled = true;
    };
  }, [client, youId, active]);

  const publish = useCallback(
    (input: PublishInput) =>
      publishEverywhere(
        {
          toBlob: dataUrlToBlob,
          publishStory: async (story) => {
            const result = await stories.publish(story);
            return result.ok ? { ok: true, value: result.storyId } : result;
          },
          upload: async (main) => {
            if (client === null) return { ok: false, message: 'Sign in to share. Nothing was shared.' };
            const file = new File([main], 'photo.jpg', { type: main.type || 'image/jpeg' });
            const uploaded = await uploadImageThroughBoundary(client, file);
            if (uploaded.kind === 'ok') return { ok: true, value: uploaded.mediaId };
            return {
              ok: false,
              message:
                uploaded.kind === 'too_large'
                  ? 'That photo is too large to share.'
                  : 'The photo could not be uploaded. Nothing was shared.',
            };
          },
          publishFeed: async (post) => {
            const result = await publishFeedPost(client, { ...post, audience: 'friends' });
            return result.ok ? { ok: true, value: result.value.id } : result;
          },
          sendGroup: async (groupId, caption, mediaId) =>
            sendGroupMessage(client, groupId, caption, mediaId),
          addNightOut: async (nightOutId, mediaId) =>
            client === null ? null : addNightOutMedia(client, nightOutId, mediaId),
        },
        input,
      ),
    [client, stories],
  );

  const undo = useCallback(
    (publishId: string) =>
      undoEverywhere(
        {
          deleteStory: stories.removeItem,
          deleteFeedPost: async (postId) => {
            const result = await deleteFeedPost(client, postId);
            return result.ok ? { ok: true } : result;
          },
          deleteGroupMessage: async (messageId) => {
            const result = await deleteGroupMessage(client, messageId);
            return result.ok ? { ok: true } : result;
          },
          removeDestination: (mediaId, destinationId) =>
            removeMediaDestination(client, mediaId, destinationId),
        },
        publishId,
      ),
    [client, stories],
  );

  return { groups, groupsUnavailable, nightOut, nightOutNote, publish, undo };
}

/** "9:00 PM" in the plan's own zone — night outs are New York nights (D-C-39). */
function formatNyTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return 'later tonight';
  }
}

/**
 * A plan the caller OWNS for tonight — `owner_id = you`, explicitly. RLS
 * (0044 `night_outs_select_member`) also admits rows where the caller is a
 * PENDING or DECLINED member, and `add_night_out_media` refuses those (42501),
 * so without the owner filter a friend's plan you never accepted could be
 * offered and then fail after the upload (Fable, S-11 r2). Accepted
 * invitations come from the RPC; this read is owner rows only. A read failure
 * is null: the row then says "No night out tonight", never a guess.
 */
async function fetchOwnedTonight(
  client: SupabaseClient,
  youId: string,
  nightKey: string,
): Promise<ComposerNightOut | null> {
  try {
    const { data, error } = await client
      .from('night_outs')
      .select('id, title, night, status')
      .eq('owner_id', youId)
      .eq('night', nightKey)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: true })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const row = data[0] as { id: unknown; title: unknown };
    if (typeof row.id !== 'string') return null;
    return { id: row.id, label: typeof row.title === 'string' && row.title.length > 0 ? row.title : 'Tonight' };
  } catch {
    return null;
  }
}

/** Tonight's plan from the caller's list: today's night key, live, and accepted. */
export function tonightFrom(list: readonly MyNightOut[], nightKey: string): ComposerNightOut | null {
  const hit = list.find(
    (row) =>
      row.night === nightKey && !row.isPast && row.status !== 'cancelled' && row.myStatus === 'accepted',
  );
  return hit ? { id: hit.nightOutId, label: hit.title ?? 'Tonight' } : null;
}

/**
 * The capture pipeline hands back data URLs; publication needs BYTES. `fetch`
 * on a data: URL is the one conversion that needs no hand-rolled base64 decode.
 */
async function dataUrlToBlob(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url);
    return await response.blob();
  } catch {
    return null;
  }
}

/**
 * `DELETE /api/media/:mediaId?destination=<id>` — the boundary's own verb for
 * withdrawing ONE destination (a Night Out attachment here) and reclaiming
 * the bytes if nothing else references them.
 */
async function removeMediaDestination(
  client: SupabaseClient | null,
  mediaId: string,
  destinationId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (client === null) return { ok: false, message: 'Not signed in.' };
  try {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, message: 'Not signed in.' };
    const response = await fetch(
      `/api/media/${encodeURIComponent(mediaId)}?destination=${encodeURIComponent(destinationId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );
    return response.ok ? { ok: true } : { ok: false, message: 'That did not reach the server.' };
  } catch {
    return { ok: false, message: 'That did not reach the server.' };
  }
}
