'use client';

import { useState } from 'react';
import CaptureFlow from '@/components/capture/CaptureFlow';
import type { Pair } from '@/components/capture/pairing';
import GlobalComposer from '@/components/composer/GlobalComposer';
import type {
  ComposerGroup,
  ComposerNightOut,
  PublishInput,
  PublishResult,
} from '@/components/composer/types';
import type { StoryPhoto, TaggedPerson } from './storyStore';

/**
 * Add to Story — the plus-badge entry branch, now the ONE photo flow (README
 * §9): capture → approve/retake → compose → destinations → receipt.
 *
 * This file owns exactly one thing: the capture step, and the hand-off of an
 * APPROVED pair to the composer. Everything after review is
 * `composer/GlobalComposer` — the same compose, destinations and receipt for
 * every entry point, so there is no second caption field, no second audience
 * sheet and no second receipt to drift.
 *
 * Until S-11 this branch carried its own compose dock that published to Story
 * only and had no destinations step. That dock is gone: entering through the
 * plus on your own avatar no longer pre-answers "where does this go?" — the
 * four-row Destinations screen does, and Story is one of the four.
 *
 * Publishing is the HOST's: `onPublish` receives one `PublishInput` naming one
 * capture and every selected destination (see `useAddStoryPublish`), and the
 * receipt's Undo hands back the `publishId` that call returned.
 */
export default function AddStoryFlow({
  friends,
  friendsReady,
  groups,
  nightOut,
  onCancel,
  onPublish,
  onUndo,
  onViewPost,
  onViewStory,
}: {
  /** Accepted MUTUAL friends — the only permissible tag targets and story recipients. */
  friends: readonly TaggedPerson[];
  /** False until the real circle has resolved; narrowing is held until then. */
  friendsReady: boolean;
  /** The author's named groups (Group DESTINATION targets). */
  groups: readonly ComposerGroup[];
  /** Tonight's night out, or null when there is none. */
  nightOut: ComposerNightOut | null;
  onCancel: () => void;
  onPublish: (input: PublishInput) => Promise<PublishResult>;
  onUndo: (publishId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  onViewPost: (postId: string | null) => void;
  onViewStory: () => void;
}): JSX.Element {
  const [pair, setPair] = useState<Pair | null>(null);

  if (pair === null) {
    return (
      <CaptureFlow
        title="Add to your story"
        subtitle="Capture now, then choose who sees it."
        onCancel={onCancel}
        onApproved={setPair}
      />
    );
  }

  const photo: StoryPhoto = {
    kind: pair.inset !== null ? 'dual' : 'single',
    main: pair.main,
    inset: pair.inset,
    // Compose shows the capture the author just took, held in memory as a data
    // URL. There is no signing step in this direction, so no signing failure.
    state: 'ok',
  };

  return (
    <GlobalComposer
      photo={photo}
      main={pair.main}
      inset={pair.inset}
      friends={friends}
      friendsReady={friendsReady}
      groups={groups}
      nightOut={nightOut}
      onPublish={onPublish}
      onUndo={onUndo}
      onExit={onCancel}
      // Retake DISCARDS: the pair is dropped here, and CaptureFlow mounts fresh
      // on its capture options, so nothing rejected can reach compose again.
      onRetake={() => setPair(null)}
      onViewPost={onViewPost}
      onViewStory={onViewStory}
    />
  );
}
