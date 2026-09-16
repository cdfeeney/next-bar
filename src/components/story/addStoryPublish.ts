import {
  COMPOSER_DESTINATIONS,
  type DestinationKey,
  type PublishInput,
  type PublishResult,
} from '@/components/composer/types';

/**
 * ONE capture, every selected destination — the host half of the composer's
 * contract (S-11, README §9.4/9.5). Pure over injected backends so the fan-out,
 * the partial-publish accounting and the Undo are unit-testable without a
 * network; `useAddStoryPublish` binds the real ones.
 *
 * Story keeps its own upload (`publishStory` mints the object paths itself);
 * Feed, Night Out and Group share ONE upload through the media boundary and
 * are keyed to its media id — three destinations, one object, which is what
 * V8-R-CMP-003 asks for.
 *
 * The `publishId` the receipt's Undo hands back is a record of what landed:
 *   story:<storyId> | feed:<postId> | group:<groupId>:<messageId> | night:<mediaId>:<destinationId>
 */

type Outcome<T> = { ok: true; value: T } | { ok: false; message: string };

export type PublishDeps = {
  toBlob: (dataUrl: string) => Promise<Blob | null>;
  publishStory: (input: {
    main: Blob;
    inset: Blob | null;
    barId: string | null;
    caption: string | null;
    audience: 'friends' | 'custom';
    audienceIds: string[];
    tagIds: string[];
  }) => Promise<Outcome<string>>;
  /** Upload through `/api/media/upload`; resolves the registry media id. */
  upload: (main: Blob) => Promise<Outcome<string>>;
  publishFeed: (input: {
    mediaId: string;
    barId: string | null;
    caption: string | null;
    tagIds: string[];
  }) => Promise<Outcome<string>>;
  sendGroup: (groupId: string, caption: string | null, mediaId: string) => Promise<Outcome<string>>;
  /** Resolves the destination id, or null on refusal. */
  addNightOut: (nightOutId: string, mediaId: string) => Promise<string | null>;
};

export type UndoDeps = {
  deleteStory: (storyId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  deleteFeedPost: (postId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  deleteGroupMessage: (messageId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  removeDestination: (
    mediaId: string,
    destinationId: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
};

const UNREADABLE = 'That photo could not be read. Nothing was shared.';

export async function publishEverywhere(
  deps: PublishDeps,
  input: PublishInput,
): Promise<PublishResult> {
  const wanted = input.destinations;
  const delivered: DestinationKey[] = [];
  const parts: string[] = [];
  const errors: string[] = [];
  let deliveredGroupIds: string[] | undefined;
  let postId: string | null = null;

  const main = await deps.toBlob(input.main);
  const inset = input.inset === null ? null : await deps.toBlob(input.inset);
  if (main === null || (input.inset !== null && inset === null)) {
    return { ok: false, message: UNREADABLE };
  }

  if (wanted.includes('story')) {
    const story = await deps.publishStory({
      main,
      inset,
      barId: input.barId,
      caption: input.caption,
      audience: input.storyAudience === 'friends' ? 'friends' : 'custom',
      audienceIds: [...input.storyAudienceIds],
      tagIds: [...input.tagIds],
    });
    if (story.ok) {
      delivered.push('story');
      parts.push(`story:${story.value}`);
    } else {
      errors.push(story.message);
    }
  }

  const others = wanted.filter((key) => key !== 'story');
  if (others.length > 0) {
    const upload = await deps.upload(main);
    if (!upload.ok) {
      errors.push(upload.message);
    } else {
      const mediaId = upload.value;
      if (others.includes('feed')) {
        const feed = await deps.publishFeed({
          mediaId,
          barId: input.barId,
          caption: input.caption,
          tagIds: [...input.tagIds],
        });
        if (feed.ok) {
          delivered.push('feed');
          parts.push(`feed:${feed.value}`);
          postId = feed.value;
        } else {
          errors.push(feed.message);
        }
      }
      if (others.includes('night_out') && input.nightOutId !== null) {
        const destinationId = await deps.addNightOut(input.nightOutId, mediaId);
        if (destinationId !== null) {
          delivered.push('night_out');
          parts.push(`night:${mediaId}:${destinationId}`);
        } else {
          errors.push('The night out did not take the photo.');
        }
      }
      if (others.includes('group')) {
        const landed: string[] = [];
        for (const groupId of input.groupIds) {
          const sent = await deps.sendGroup(groupId, input.caption, mediaId);
          if (sent.ok) {
            landed.push(groupId);
            parts.push(`group:${groupId}:${sent.value}`);
          } else {
            errors.push(sent.message);
          }
        }
        if (landed.length > 0) {
          delivered.push('group');
          deliveredGroupIds = landed;
        }
      }
    }
  }

  // Canonical order, so the receipt names destinations the same way every time.
  const ordered = COMPOSER_DESTINATIONS.filter((key) => delivered.includes(key));
  const everyGroupLanded =
    !wanted.includes('group') || (deliveredGroupIds?.length ?? 0) === input.groupIds.length;
  const complete = ordered.length === wanted.length && everyGroupLanded;

  if (complete) {
    return { ok: true, publishId: parts.join('|'), delivered: ordered, deliveredGroupIds, postId };
  }
  if (ordered.length === 0) {
    return { ok: false, message: errors[0] ?? 'Nothing was shared.' };
  }
  // A PARTIAL is never silent: what landed, which threads, and an id to undo it.
  return {
    ok: false,
    message: errors[0] ?? 'Part of that did not go through.',
    delivered: ordered,
    deliveredGroupIds,
    publishId: parts.join('|'),
  };
}

const PART_LABEL: Readonly<Record<string, string>> = {
  story: 'The story',
  feed: 'The Feed post',
  group: 'The group message',
  night: 'The night out photo',
};

/** Author delete of everything a `publishId` says landed. Reports what stayed. */
export async function undoEverywhere(
  deps: UndoDeps,
  publishId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const stayed: string[] = [];
  for (const part of publishId.split('|').filter((entry) => entry.length > 0)) {
    const [kind, ...rest] = part.split(':');
    const result =
      kind === 'story'
        ? await deps.deleteStory(rest[0])
        : kind === 'feed'
          ? await deps.deleteFeedPost(rest[0])
          : kind === 'group'
            ? await deps.deleteGroupMessage(rest[1])
            : kind === 'night'
              ? await deps.removeDestination(rest[0], rest[1])
              : { ok: false as const, message: 'Unknown destination.' };
    if (!result.ok) stayed.push(PART_LABEL[kind] ?? 'Part of it');
  }
  if (stayed.length === 0) return { ok: true };
  return {
    ok: false,
    message: `${stayed.join(' and ')} could not be removed.`,
  };
}
