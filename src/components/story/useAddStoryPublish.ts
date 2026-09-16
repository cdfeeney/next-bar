'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ComposerGroup, ComposerNightOut, PublishInput, PublishResult } from '@/components/composer/types';
import { deleteFeedPost, publishFeedPost } from '@/lib/feed.server';
import { deleteGroupMessage, fetchMyGroups, sendGroupMessage } from '@/lib/groups.server';
import { uploadImageThroughBoundary } from '@/lib/media/uploadClient';
import { nycNightKey } from '@/lib/nightKey';
import { addNightOutMedia } from '@/lib/nightOutMedia/server';
import { getMyNightOuts, type MyNightOut } from '@/lib/nightOuts.server';
import { getBrowserSupabase } from '@/lib/supabase/client';

import { publishEverywhere, undoEverywhere } from './addStoryPublish';
import type { UseStories } from './storyStore';

/**
 * Binds the composer's one-call publish contract to the real backends, and
 * loads the two things the Destinations screen needs to name: the author's
 * groups and tonight's night out.
 *
 * KNOWN LIMIT, stated rather than hidden: `get_my_night_outs` (0059) excludes
 * the rows the caller OWNS, so a plan you created yourself does not surface as
 * "tonight" here — only one you were invited to and accepted. The row then says
 * "No night out tonight". Widening that read is a migration, not this lane.
 */
export function useAddStoryPublish(
  stories: Pick<UseStories, 'publish' | 'removeItem'>,
  youId: string | null,
): {
  groups: readonly ComposerGroup[];
  nightOut: ComposerNightOut | null;
  publish: (input: PublishInput) => Promise<PublishResult>;
  undo: (publishId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
} {
  const client = useMemo(() => getBrowserSupabase(), []);
  const [groups, setGroups] = useState<readonly ComposerGroup[]>([]);
  const [nightOut, setNightOut] = useState<ComposerNightOut | null>(null);

  useEffect(() => {
    if (client === null || youId === null) return undefined;
    let cancelled = false;
    void (async () => {
      const [mine, nights] = await Promise.all([fetchMyGroups(client), getMyNightOuts(client)]);
      if (cancelled) return;
      // A failed groups read leaves the Group row "no groups yet" rather than
      // inventing targets; the composer refuses an empty Group selection anyway.
      if (mine.ok) {
        setGroups(mine.value.map((group) => ({ id: group.id, name: group.name, memberIds: [] })));
      }
      setNightOut(tonightFrom(nights ?? [], nycNightKey()));
    })();
    return () => {
      cancelled = true;
    };
  }, [client, youId]);

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

  return { groups, nightOut, publish, undo };
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
