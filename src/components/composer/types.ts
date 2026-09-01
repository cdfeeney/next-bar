/**
 * The global composer's vocabulary and its pure decisions (WP4).
 *
 * Everything here is a total function over the requirement's declared states,
 * so the screens below can be dumb: a receipt, a summary and an audience
 * resolution are all decisions that can be argued with in a unit test rather
 * than driven through a browser.
 *
 * WHY THIS LANE OWNS NO SERVER CALL. The four destination backends already
 * exist and each one is somebody else's file: `publishFeedPost` (feed.server),
 * `publishStory` (stories.server), `sendGroupMessage` (groups.server) and
 * `addNightOutMedia` (nightOutMedia/server). Three of the four are keyed to a
 * media id minted by `POST /api/media/upload`, and the fourth (`publish_story`)
 * takes a storage path in the SAME bucket — so one uploaded object can carry
 * every destination, which is exactly what V8-R-CMP-003 requires. The composer
 * therefore hands its host ONE `PublishInput` describing one media object and
 * every selected destination, and never issues one publish per destination.
 * That is the shape `AddStoryFlow` already uses (`onPublish` as a prop), and it
 * keeps the wiring in the page that owns the Supabase client.
 */

import type { TaggedPerson } from '@/components/story/storyStore';

/** V8-R-CMP-010 — the global composer's caption bound. */
export const MAX_COMPOSER_CAPTION = 140;

/**
 * V8-R-CMP-002 — exactly four destinations, and there is no fifth.
 *
 * `night_out` is deliberately NOT a `media/types.ts` `DestinationKind`: that
 * union is the 0066 registry's own check constraint (story/feed/group/archive)
 * and Night Out media is attached by `add_night_out_media` instead. Reusing
 * that type here would claim a registry kind that does not exist.
 */
export type DestinationKey = 'feed' | 'story' | 'night_out' | 'group';

export const COMPOSER_DESTINATIONS: readonly DestinationKey[] = [
  'feed',
  'story',
  'night_out',
  'group',
];

export const DESTINATION_LABELS: Readonly<Record<DestinationKey, string>> = {
  feed: 'Feed',
  story: 'Story',
  night_out: 'Night Out',
  group: 'Group',
};

/**
 * Retention, in the author's words, per V8-R-CMP-002's retention clause. The
 * pre-publish summary restates these rather than linking to them.
 */
export const DESTINATION_RETENTION: Readonly<Record<DestinationKey, string>> = {
  feed: 'stays until you delete it',
  story: '24 hours',
  night_out: '24 hours from the night out start',
  group: 'stays in the group thread',
};

/**
 * V8-R-CMP-005 — the Story audience, which governs the STORY ONLY.
 *
 * `group` here names a MUTUAL-FRIEND GROUP used as an audience, and D-C-37
 * resolves it to that group INTERSECTED WITH the poster's mutual friends. It is
 * not the Group DESTINATION, which keeps its own fixed membership (V8-R-CMP-007).
 */
export type StoryAudienceChoice = 'friends' | 'group' | 'custom';

/** One of the author's named groups, as both an audience and a destination. */
export type ComposerGroup = {
  id: string;
  name: string;
  /** Profile ids of the group's FIXED members. */
  memberIds: readonly string[];
};

/** Tonight's night out, or null when there is none (V8-R-CMP-006). */
export type ComposerNightOut = { id: string; label: string };

/**
 * Everything the host needs to publish, in ONE call.
 *
 * `main`/`inset` are the capture's data URLs, passed through untouched: the
 * composer does no I/O, so a conversion failure is the host's to report and the
 * composer stays testable without a network or a Blob polyfill.
 */
export type PublishInput = {
  main: string;
  inset: string | null;
  /** Every selected destination. Never empty — the CTA is unavailable when it would be. */
  destinations: readonly DestinationKey[];
  caption: string | null;
  barId: string | null;
  tagIds: readonly string[];
  /** Story only. */
  storyAudience: StoryAudienceChoice;
  /**
   * The RESOLVED story recipients: already intersected with the poster's mutual
   * friends. Empty means "all mutual friends" and is legal only for `friends`.
   * The server intersects again — `publish_story` refuses a non-mutual with
   * 42501 — so this is the honest UI half of a rule the database enforces.
   */
  storyAudienceIds: readonly string[];
  /** Set when the story audience came from a named group, for the host's records. */
  storyAudienceGroupId: string | null;
  /** Group DESTINATION targets. Fixed membership, never intersected (D-C-37 exception). */
  groupIds: readonly string[];
  nightOutId: string | null;
};

export type PublishResult =
  | {
      ok: true;
      /** Identifies what was just published, for Undo. */
      publishId: string;
      /** What actually landed. A strict subset of the selection is a PARTIAL publish. */
      delivered: readonly DestinationKey[];
      /** True when the publish was queued offline. Never labelled "Shared" (V8-R-CMP-008). */
      queued?: boolean;
      /** Set when the receipt's primary action can open the new Feed post. */
      postId?: string | null;
    }
  | {
      ok: false;
      message: string;
      /** Anything that DID land before the failure, so a partial is never silent. */
      delivered?: readonly DestinationKey[];
      /**
       * Identifies the part that DID land, when any did. Undo has to be
       * reachable for a live post even though the publish as a whole failed —
       * without this the composer can name the partial but never withdraw it,
       * so a host that reports `delivered` must report this with it.
       */
      publishId?: string;
    };

/**
 * V8-R-CMP-011 — exactly three receipts.
 *
 * Feed alone and Story alone each get their own wording and their own primary
 * action. EVERYTHING ELSE gets the counted receipt, including a single Night Out
 * or a single Group: the requirement names three receipts and three only, so a
 * fourth for "one destination that is neither Feed nor Story" would be inventing
 * one. "1 place" rather than "1 places" is grammar, not a fourth receipt.
 */
export type ComposerReceipt = {
  kind: 'feed' | 'story' | 'places';
  headline: string;
  primaryLabel: string;
  primaryAction: 'view-post' | 'view-story' | 'done';
};

export function receiptFor(
  delivered: readonly DestinationKey[],
): ComposerReceipt {
  if (delivered.length === 1 && delivered[0] === 'feed') {
    return {
      kind: 'feed',
      headline: 'Posted to Feed',
      primaryLabel: 'View post',
      primaryAction: 'view-post',
    };
  }
  if (delivered.length === 1 && delivered[0] === 'story') {
    return {
      kind: 'story',
      headline: 'Added to your story',
      primaryLabel: 'View story',
      primaryAction: 'view-story',
    };
  }
  return {
    kind: 'places',
    headline: `Shared to ${delivered.length} ${delivered.length === 1 ? 'place' : 'places'}`,
    primaryLabel: 'Done',
    primaryAction: 'done',
  };
}

/**
 * V8-R-CMP-005 / D-C-37 — who the STORY actually reaches.
 *
 * A named group resolves to that group INTERSECTED WITH the poster's mutual
 * friends: a group member who is not a mutual friend is not a recipient. The
 * intersection is also enforced server-side, which is what makes this safe to
 * compute here — a client cannot widen it, because `publish_story` refuses a
 * recipient who is not an accepted mutual friend.
 *
 * `friends` returns EMPTY on purpose: "every mutual friend" is a set the server
 * owns, and enumerating it client-side would freeze a circle that changes.
 */
export function resolveStoryRecipients(input: {
  choice: StoryAudienceChoice;
  /** Accepted mutual friends, as profile ids. */
  mutualIds: readonly string[];
  /** The chosen audience group's fixed members. */
  groupMemberIds?: readonly string[];
  /** Hand-picked recipients. */
  customIds?: readonly string[];
}): readonly string[] {
  if (input.choice === 'friends') return [];
  const picked =
    input.choice === 'group' ? (input.groupMemberIds ?? []) : (input.customIds ?? []);
  return picked.filter((id) => input.mutualIds.includes(id));
}

/**
 * True when a narrowed story audience has nobody behind it.
 *
 * V8-R-CMP-005 fails CLOSED here: "if the mutual-friend set cannot be resolved
 * the action FAILS CLOSED rather than delivering to the unintersected group."
 * An unresolved circle (`mutualsReady:false`) is treated exactly like an empty
 * one, because a narrowing computed against a list that has not loaded is a
 * narrowing against nothing.
 */
export function storyAudienceLapsed(input: {
  choice: StoryAudienceChoice;
  mutualsReady: boolean;
  resolved: readonly string[];
}): boolean {
  if (input.choice === 'friends') return false;
  return !input.mutualsReady || input.resolved.length === 0;
}

/**
 * V8-R-CMP-014 — the pre-publish summary, in words, directly above the only
 * publishing button: who sees this, for how long, who is tagged, the bar tag,
 * and that there are no public like counts.
 */
export function summaryLines(input: {
  destinations: readonly DestinationKey[];
  storyAudience: StoryAudienceChoice;
  /** How many people the story actually reaches; null for "all your friends". */
  storyRecipientCount: number | null;
  /** Names of the selected Group DESTINATIONS. */
  groupNames: readonly string[];
  nightOutLabel: string | null;
  tagged: readonly TaggedPerson[];
  barName: string | null;
}): readonly string[] {
  const lines: string[] = [];
  const has = (key: DestinationKey): boolean => input.destinations.includes(key);

  if (has('feed')) {
    lines.push(`Feed · your friends · ${DESTINATION_RETENTION.feed}`);
  }
  if (has('story')) {
    const who =
      input.storyAudience === 'friends'
        ? 'your friends'
        : `${input.storyRecipientCount ?? 0} ${input.storyRecipientCount === 1 ? 'person' : 'people'}`;
    lines.push(`Story · ${who} · ${DESTINATION_RETENTION.story}`);
  }
  if (has('night_out')) {
    const where = input.nightOutLabel ?? 'tonight';
    lines.push(`Night Out · everyone on ${where} · ${DESTINATION_RETENTION.night_out}`);
  }
  if (has('group')) {
    const names = input.groupNames.length > 0 ? input.groupNames.join(', ') : 'no group yet';
    lines.push(`Group · ${names} · ${DESTINATION_RETENTION.group}`);
  }
  if (lines.length === 0) {
    lines.push('Nowhere yet · pick at least one place');
  }

  lines.push(
    input.tagged.length === 0
      ? 'Nobody is tagged'
      : `Tagged: ${input.tagged.map((person) => person.name).join(', ')}`,
  );
  lines.push(input.barName === null ? 'No bar tagged' : `Bar: ${input.barName}`);
  // V8-R-CMP-014's one exclusion, restated at the moment of publishing.
  lines.push('No public like counts');
  return lines;
}

/**
 * V8-R-CMP-008 — "the CTA names its effect". Never a bare "Share".
 */
export function ctaLabel(destinations: readonly DestinationKey[]): string {
  if (destinations.length === 0) return 'Pick a place to share';
  if (destinations.length === 1) return `Share to ${DESTINATION_LABELS[destinations[0]]}`;
  if (destinations.length === 2) {
    return `Share to ${DESTINATION_LABELS[destinations[0]]} and ${DESTINATION_LABELS[destinations[1]]}`;
  }
  return `Share to ${destinations.length} places`;
}

/**
 * V8-R-CMP-002 — "a partial publish must not leave the post live on one
 * destination and silently absent from another". What is missing, in words.
 */
export function missingDestinations(
  selected: readonly DestinationKey[],
  delivered: readonly DestinationKey[],
): readonly DestinationKey[] {
  return selected.filter((key) => !delivered.includes(key));
}

/**
 * V8-R-CMP-008 — every selected destination that the CTA could not actually
 * deliver to, in canonical order.
 *
 * "The CTA writes to EVERY selected destination", so a selection the CTA cannot
 * honour is refused BEFORE publishing rather than reported afterwards as a
 * partial. Two destinations can be selected and yet have no target:
 *
 *   - GROUP with no group chosen. `sendGroupMessage` takes one group id, so an
 *     empty list reaches no thread at all.
 *   - NIGHT OUT whose night out has gone away since it was selected. The row
 *     disables itself but stays ON, and `addNightOutMedia` needs an id — so
 *     without this the composer would send `night_out` with `nightOutId:null`.
 *
 * The Story audience fails closed by its own route (`storyAudienceLapsed`),
 * because it reopens the sheet rather than merely disabling the CTA.
 */
export function undeliverableDestinations(input: {
  destinations: readonly DestinationKey[];
  groupIds: readonly string[];
  hasNightOut: boolean;
}): readonly DestinationKey[] {
  const missing: DestinationKey[] = [];
  if (input.destinations.includes('group') && input.groupIds.length === 0) {
    missing.push('group');
  }
  if (input.destinations.includes('night_out') && !input.hasNightOut) {
    missing.push('night_out');
  }
  return missing;
}

/**
 * V8-R-CMP-005 — tagging somebody the story will not reach.
 *
 * The inherited Story backend refuses it outright: `publish_story` raises 42501
 * with "everyone you tag must be in a custom story's audience"
 * (`0066_media_boundary.sql`), and a narrowed composer audience reaches that RPC
 * as a custom one. So tagging Alex while narrowing the story to a set without
 * Alex cannot land, and the composer must not offer it.
 *
 * It FAILS CLOSED rather than quietly adding the tagged person to the audience:
 * widening a narrowing to make a tag work is exactly what D-C-37 forbids.
 * `friends` needs no check — an unnarrowed story reaches every mutual friend,
 * and only a mutual friend can be tagged.
 */
export function taggedOutsideStoryAudience(input: {
  destinations: readonly DestinationKey[];
  storyAudience: StoryAudienceChoice;
  storyAudienceIds: readonly string[];
  tagIds: readonly string[];
}): readonly string[] {
  if (!input.destinations.includes('story')) return [];
  if (input.storyAudience === 'friends') return [];
  return input.tagIds.filter((id) => !input.storyAudienceIds.includes(id));
}
