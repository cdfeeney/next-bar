'use client';

import { useState } from 'react';

import type { StoryPhoto, TaggedPerson } from '@/components/story/storyStore';
import type { Bar } from '@/types';

import ComposeStep from './ComposeStep';
import DestinationsStep from './DestinationsStep';
import SharedReceipt from './SharedReceipt';
import StoryAudienceSheet from './StoryAudienceSheet';
import {
  DESTINATION_LABELS,
  groupTargetsMissing,
  resolveStoryRecipients,
  storyAudienceLapsed,
  type ComposerGroup,
  type ComposerNightOut,
  type DestinationKey,
  type PublishInput,
  type PublishResult,
  type StoryAudienceChoice,
} from './types';

/**
 * The global composer — "Share a moment" (WP4).
 *
 * THREE STEPS AND THREE ONLY (V8-R-CMP-001): Compose, Destinations, Shared.
 * Bar, People and the Story audience are BRANCHES — sheets over the step that
 * opened them — never steps, and there is no confirm or review page between
 * choosing and posting.
 *
 * WHAT THIS COMPONENT DELIBERATELY DOES NOT DO. It performs no upload, no RPC
 * and no navigation. `onPublish` receives ONE `PublishInput` naming ONE media
 * object and every selected destination, which is what makes V8-R-CMP-003
 * structural rather than aspirational: there is no code path here that can
 * publish the same capture twice. The host owns the Supabase client and fans
 * that one input out to `publishFeedPost`, `publishStory`, `sendGroupMessage`
 * and `addNightOutMedia` — three of which already take a media id and the
 * fourth a storage path in the same bucket. `AddStoryFlow` takes its `onPublish`
 * the same way, for the same reason.
 *
 * NOTHING IS PUBLISHED BEFORE THE CTA (V8-R-CMP-001 trust boundary, -008):
 * every toggle on this surface is device state, and `onPublish` is called from
 * exactly one place.
 */
export default function GlobalComposer({
  photo,
  main,
  inset = null,
  friends,
  friendsReady,
  groups,
  nightOut,
  defaultStoryAudience = 'friends',
  onPublish,
  onUndo,
  onExit,
  onViewPost,
  onViewStory,
}: {
  /** The capture, already reviewed. Capture is upstream — it is not a composer step. */
  photo: StoryPhoto;
  /** The capture's bytes, as data URLs. Passed through untouched; this component does no I/O. */
  main: string;
  inset?: string | null;
  /** Accepted MUTUAL friends. Tagging and the story audience both draw from this. */
  friends: readonly TaggedPerson[];
  /** False until the real circle has resolved. A narrowing fails closed until then. */
  friendsReady: boolean;
  /** The author's named groups, with their FIXED membership. */
  groups: readonly ComposerGroup[];
  /** Tonight's night out, or null. */
  nightOut: ComposerNightOut | null;
  /** The Account default the Story audience subrow is pre-filled from (V8-R-CMP-005). */
  defaultStoryAudience?: StoryAudienceChoice;
  onPublish: (input: PublishInput) => Promise<PublishResult>;
  onUndo: (publishId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** ✕ — before Share it leaves without publishing, after Share it returns to Social. */
  onExit: () => void;
  onViewPost: (postId: string | null) => void;
  onViewStory: () => void;
}): JSX.Element {
  const [step, setStep] = useState<'compose' | 'destinations' | 'shared'>('compose');
  const [caption, setCaption] = useState('');
  const [bar, setBar] = useState<Bar | null>(null);
  const [people, setPeople] = useState<readonly TaggedPerson[]>([]);
  const [destinations, setDestinations] = useState<readonly DestinationKey[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<readonly string[]>([]);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [storyAudience, setStoryAudience] =
    useState<StoryAudienceChoice>(defaultStoryAudience);
  const [audienceGroupId, setAudienceGroupId] = useState<string | null>(null);
  const [customIds, setCustomIds] = useState<readonly string[]>([]);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [audienceLapsed, setAudienceLapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [composeFailure, setComposeFailure] = useState<string | null>(null);
  const [destinationFailure, setDestinationFailure] = useState<string | null>(null);
  const [undoFailure, setUndoFailure] = useState<string | null>(null);
  const [published, setPublished] = useState<{
    publishId: string;
    postId: string | null;
    selected: readonly DestinationKey[];
    delivered: readonly DestinationKey[];
    queued: boolean;
  } | null>(null);

  const mutualIds = friendsReady ? friends.map((friend) => friend.id) : [];
  const audienceGroup = groups.find((group) => group.id === audienceGroupId) ?? null;
  /**
   * Resolved against the LIVE circle every render, never against the pick made
   * earlier: unfollow someone in another tab and the count on screen drops with
   * them. The server intersects again and refuses a non-mutual, so this is the
   * honest UI half of a rule the database enforces.
   */
  const storyRecipients = resolveStoryRecipients({
    choice: storyAudience,
    mutualIds,
    groupMemberIds: audienceGroup?.memberIds ?? [],
    customIds,
  });
  const storyRecipientCount = storyAudience === 'friends' ? null : storyRecipients.length;

  const toggleDestination = (key: DestinationKey): void => {
    setDestinationFailure(null);
    setDestinations((current) =>
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : // Kept in the canonical Feed / Story / Night Out / Group order rather
          // than tap order, so the CTA, the summary and the receipt all name the
          // destinations the same way round.
          ORDER.filter((entry) => entry === key || current.includes(entry)),
    );
    // Turning Group off drops its picks. Leaving them behind meant a later
    // re-tap silently restored a selection the summary had stopped showing.
    if (key === 'group' && destinations.includes('group')) {
      setSelectedGroupIds([]);
      setGroupsOpen(false);
    }
  };

  /**
   * The audience as it was last COMMITTED with Done, so dismissing the sheet
   * restores that decision instead of discarding it. Browsing to another option
   * and backing out must never widen a narrowing the author already made.
   */
  const [committedAudience, setCommittedAudience] = useState<{
    choice: StoryAudienceChoice;
    groupId: string | null;
    customIds: readonly string[];
  }>({ choice: defaultStoryAudience, groupId: null, customIds: [] });

  const publish = async (): Promise<void> => {
    if (busy || destinations.length === 0) return;

    // FAIL CLOSED (V8-R-CMP-007/-008). Group selected with no group chosen
    // reaches no thread, so it is refused here rather than published and then
    // reported as a partial. The CTA is already unavailable; this is the guard
    // behind it, so no caller can publish an undeliverable selection.
    if (groupTargetsMissing({ destinations, groupIds: selectedGroupIds })) {
      setDestinationFailure('Choose a group first, or turn the Group row off.');
      return;
    }

    // FAIL CLOSED (V8-R-CMP-005). A narrowed story audience that reaches nobody
    // — including one whose circle has not resolved — is refused and the sheet
    // is reopened. It is never quietly widened to Friends, which would deliver
    // BROADER than the screen said.
    if (
      destinations.includes('story')
      && storyAudienceLapsed({
        choice: storyAudience,
        mutualsReady: friendsReady,
        resolved: storyRecipients,
      })
    ) {
      setAudienceLapsed(true);
      setAudienceOpen(true);
      return;
    }

    setBusy(true);
    setDestinationFailure(null);
    let result: PublishResult;
    try {
      result = await onPublish({
        main,
        inset,
        destinations,
        caption: caption.trim().length > 0 ? caption.trim() : null,
        barId: bar?.id ?? null,
        tagIds: people.map((person) => person.id),
        storyAudience,
        storyAudienceIds: storyRecipients,
        storyAudienceGroupId: storyAudience === 'group' ? audienceGroupId : null,
        groupIds: destinations.includes('group') ? selectedGroupIds : [],
        nightOutId: destinations.includes('night_out') ? (nightOut?.id ?? null) : null,
      });
    } catch {
      // A REJECTED promise is a publish that landed nowhere, not a state to sit
      // in. Without this the composer keeps `busy` forever: the CTA stays
      // disabled reading "Sharing…" and the draft can neither be published nor
      // recovered. Treated exactly like `{ok:false}` with nothing delivered.
      setBusy(false);
      setComposeFailure('That did not send.');
      setStep('compose');
      return;
    } finally {
      setBusy(false);
    }

    if (!result.ok) {
      // A publish that landed NOWHERE returns to Compose with the draft intact
      // (V8-R-CMP-001 failure recovery).
      const landed = result.delivered ?? [];
      if (landed.length === 0) {
        setComposeFailure(result.message);
        setStep('compose');
        return;
      }
      // A publish that landed SOMEWHERE is a PARTIAL, and the one thing it must
      // never do is invite a retry of the whole selection: tapping Share again
      // would send the same capture to a destination that already has it, which
      // is the duplicate publish V8-R-CMP-003 forbids.
      //
      // When the host identifies what landed, go to the receipt for exactly
      // that part. It already names the rest as missing and offers Undo, so the
      // live half is both stated and withdrawable.
      if (result.publishId !== undefined) {
        setComposeFailure(null);
        setPublished({
          publishId: result.publishId,
          postId: null,
          selected: destinations,
          delivered: landed,
          queued: false,
        });
        setStep('shared');
        return;
      }
      // With no publishId there is nothing to Undo, so the least this can do is
      // make the retry safe: drop what already landed from the selection, so a
      // second tap re-sends only what is genuinely still missing.
      setDestinations((current) => current.filter((key) => !landed.includes(key)));
      setDestinationFailure(
        `${result.message} ${landed.map((key) => DESTINATION_LABELS[key]).join(' and ')} already went through, so ${landed.length === 1 ? 'it is' : 'they are'} no longer selected.`,
      );
      return;
    }

    setComposeFailure(null);
    setPublished({
      publishId: result.publishId,
      postId: result.postId ?? null,
      selected: destinations,
      delivered: result.delivered,
      queued: result.queued === true,
    });
    setStep('shared');
  };

  if (step === 'shared' && published !== null) {
    return (
      <SharedReceipt
        photo={photo}
        barId={bar?.id ?? null}
        selected={published.selected}
        delivered={published.delivered}
        queued={published.queued}
        undoFailure={undoFailure}
        onExit={onExit}
        onViewPost={() => onViewPost(published.postId)}
        onViewStory={onViewStory}
        onUndo={() => {
          // Undo DELETES on the server. Closing regardless would leave live
          // posts the author was told had been withdrawn.
          setUndoFailure(null);
          void onUndo(published.publishId).then((result) => {
            if (result.ok) onExit();
            else setUndoFailure(result.message);
          });
        }}
      />
    );
  }

  if (step === 'destinations') {
    return (
      <>
        <DestinationsStep
          destinations={destinations}
          groups={groups}
          selectedGroupIds={selectedGroupIds}
          groupsOpen={groupsOpen}
          nightOut={nightOut}
          storyAudience={storyAudience}
          storyRecipientCount={storyRecipientCount}
          people={people}
          barName={bar?.name ?? null}
          busy={busy}
          failure={destinationFailure}
          sheetOpen={audienceOpen}
          onToggleDestination={toggleDestination}
          onToggleGroupsOpen={() => setGroupsOpen((open) => !open)}
          onToggleGroup={(groupId) =>
            setSelectedGroupIds((current) =>
              current.includes(groupId)
                ? current.filter((entry) => entry !== groupId)
                : [...current, groupId],
            )
          }
          onOpenAudience={() => setAudienceOpen(true)}
          onBack={() => setStep('compose')}
          onExit={onExit}
          onPublish={() => {
            void publish();
          }}
        />
        {audienceOpen ? (
          <StoryAudienceSheet
            value={storyAudience}
            groups={groups}
            groupId={audienceGroupId}
            friends={friendsReady ? friends : []}
            friendsReady={friendsReady}
            customIds={customIds}
            resolvedCount={storyRecipients.length}
            lapsed={audienceLapsed}
            onChangeChoice={setStoryAudience}
            onChangeGroup={setAudienceGroupId}
            onToggleCustom={(profileId) =>
              setCustomIds((current) =>
                current.includes(profileId)
                  ? current.filter((entry) => entry !== profileId)
                  : [...current, profileId],
              )
            }
            onDone={() => {
              // Done is the only commit. Everything after this dismisses back
              // to exactly this decision.
              setCommittedAudience({
                choice: storyAudience,
                groupId: audienceGroupId,
                customIds,
              });
              setAudienceLapsed(false);
              setAudienceOpen(false);
            }}
            onClose={() => {
              // Dismissing DISCARDS what was being browsed and restores the
              // last committed audience. It must not resolve a half-made choice
              // to Friends: an author who had already committed "Bar Crew" and
              // then tapped Custom to look would have had their narrowing
              // widened to everyone by a gesture that means "never mind".
              //
              // Only when the RESTORED choice is itself unpublishable — nothing
              // has ever been committed and the Account default cannot resolve —
              // does it fall back to Friends, which is the original fail-closed
              // intent and never widens a decision the author actually made.
              const restoredRecipients = resolveStoryRecipients({
                choice: committedAudience.choice,
                mutualIds,
                groupMemberIds:
                  groups.find((group) => group.id === committedAudience.groupId)?.memberIds ?? [],
                customIds: committedAudience.customIds,
              });
              const restoredLapses = storyAudienceLapsed({
                choice: committedAudience.choice,
                mutualsReady: friendsReady,
                resolved: restoredRecipients,
              });
              setStoryAudience(restoredLapses ? 'friends' : committedAudience.choice);
              setAudienceGroupId(restoredLapses ? null : committedAudience.groupId);
              setCustomIds(restoredLapses ? [] : committedAudience.customIds);
              setAudienceLapsed(false);
              setAudienceOpen(false);
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <ComposeStep
      photo={photo}
      caption={caption}
      bar={bar}
      people={people}
      friends={friends}
      failure={composeFailure}
      onCaptionChange={setCaption}
      onBarChange={setBar}
      onPeopleChange={setPeople}
      onNext={() => {
        setComposeFailure(null);
        setStep('destinations');
      }}
      onExit={onExit}
    />
  );
}

/** Feed / Story / Night Out / Group — the order every surface names them in. */
const ORDER: readonly DestinationKey[] = ['feed', 'story', 'night_out', 'group'];
