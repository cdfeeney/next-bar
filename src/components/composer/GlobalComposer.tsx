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
  reconcileSelection,
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
  /**
   * Destinations this capture is already live on, from a partial failure the
   * host could not give an Undo handle for. They can never be re-selected
   * (V8-R-CMP-003) — the composer publishes one media object to each
   * destination at most once.
   */
  const [landed, setLanded] = useState<readonly DestinationKey[]>([]);
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
  /**
   * THE SINGLE RECONCILIATION. Every value the screens render and every value
   * `onPublish` receives is derived here from the LIVE props on each render, so
   * a stored choice can never outlive the thing it points at: unfollow someone
   * in another tab and the count on screen drops with them, delete a group and
   * it stops being a target, end the night out and its row stops being
   * deliverable. Reconciling only narrows, never substitutes.
   */
  const live = reconcileSelection({
    selection: {
      destinations,
      groupIds: selectedGroupIds,
      tagIds: people.map((person) => person.id),
      storyAudience,
      storyAudienceGroupId: audienceGroupId,
      customIds,
    },
    groups,
    mutualIds,
    mutualsReady: friendsReady,
    hasNightOut: nightOut !== null,
  });
  const storyRecipients = live.storyAudienceIds;
  const storyRecipientCount = storyAudience === 'friends' ? null : storyRecipients.length;
  /** Tagged people who are still mutual friends — what the screens show and what publishes. */
  const taggedPeople = people.filter((person) => live.tagIds.includes(person.id));

  const toggleDestination = (key: DestinationKey): void => {
    // V8-R-CMP-003. A destination that already has this capture can never be
    // selected again: dropping it from the selection after a partial failure
    // stops the reflex retry, but nothing stopped the author tapping it back on
    // and sending the same media twice. One capture reaches one destination at
    // most once, for the life of this composer.
    if (landed.includes(key)) return;
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

    // FAIL CLOSED (V8-R-CMP-008). A selected destination with no target reaches
    // nothing, so it is refused here rather than sent and then reported as a
    // partial. The CTA is already unavailable; this is the guard behind it, so
    // no caller can publish an undeliverable selection.
    if (live.undeliverable.length > 0) {
      setDestinationFailure(
        `${live.undeliverable.map((key) => DESTINATION_LABELS[key]).join(' and ')} has nowhere to go. Choose a target or turn it off.`,
      );
      return;
    }

    // FAIL CLOSED (V8-R-CMP-005). A narrowed story audience that reaches nobody
    // — including one whose circle has not resolved — is refused and the sheet
    // is reopened. It is never quietly widened to Friends, which would deliver
    // BROADER than the screen said.
    if (live.storyLapsed) {
      setAudienceLapsed(true);
      setAudienceOpen(true);
      return;
    }

    // FAIL CLOSED on a tag the story will not reach. `publish_story` refuses it
    // outright (42501, "everyone you tag must be in a custom story's audience"),
    // so publishing would lose the Story destination at the server. Refused here
    // rather than silently ADDING the tagged person to the audience, because
    // widening a narrowing to make a tag work is what D-C-37 forbids.
    if (live.strandedTagIds.length > 0) {
      const names = people
        .filter((person) => live.strandedTagIds.includes(person.id))
        .map((person) => person.name)
        .join(', ');
      setDestinationFailure(
        `${names} cannot be tagged in a story they will not see. Add them to the story audience, or untag them.`,
      );
      return;
    }

    setBusy(true);
    setDestinationFailure(null);
    /** What this attempt could possibly have delivered to, for the throw path. */
    const attempted = destinations;
    let result: PublishResult;
    try {
      result = await onPublish({
        main,
        inset,
        destinations,
        caption: caption.trim().length > 0 ? caption.trim() : null,
        barId: bar?.id ?? null,
        // Every id below is RECONCILED, so nothing that has stopped existing can
        // reach a backend that would reject it.
        tagIds: live.tagIds,
        storyAudience,
        storyAudienceIds: storyRecipients,
        storyAudienceGroupId: storyAudience === 'group' ? audienceGroupId : null,
        groupIds: destinations.includes('group') ? live.groupIds : [],
        nightOutId: destinations.includes('night_out') ? (nightOut?.id ?? null) : null,
      });
    } catch {
      // A REJECTED promise is INDETERMINATE, and the first version of this
      // handler got that wrong: it reported "landed nowhere" and returned to
      // Compose with the whole selection intact, so a host that had already
      // committed Feed and then threw while publishing Story left the obvious
      // retry re-sending Feed. A thrown error carries no `delivered`, so the
      // composer cannot know what landed — and unlike `{ok:false}` it is the
      // uncontrolled path, so it must not be ASSUMED empty.
      //
      // So it fails safe: the draft is kept, and every destination that was
      // ATTEMPTED is RETIRED — added to `landed` — because any of them may now
      // hold this capture. Clearing the selection alone was not enough; the
      // author could re-select Feed by hand and send it twice, which is the
      // same duplicate CMP-003 forbids, reached by a different route. Retiring
      // the attempted set is conservative on purpose: the cost of retiring a
      // destination that did NOT receive it is one un-shared destination, and
      // the cost of the opposite mistake is a duplicate post nobody asked for.
      setLanded((current) => ORDER.filter((key) => attempted.includes(key) || current.includes(key)));
      setDestinations([]);
      setComposeFailure(
        'That did not finish, and some places may already have it. Check before sharing again.',
      );
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
      // make the retry safe: drop what already landed from the selection AND
      // remember it, so neither a second tap nor a deliberate re-selection can
      // send this capture to the same destination twice.
      setLanded((current) => ORDER.filter((key) => landed.includes(key) || current.includes(key)));
      setDestinations((current) => current.filter((key) => !landed.includes(key)));
      setDestinationFailure(
        `${result.message} ${landed.map((key) => DESTINATION_LABELS[key]).join(' and ')} already went through, so ${landed.length === 1 ? 'it is' : 'they are'} no longer available.`,
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
          void onUndo(published.publishId).then(
            (result) => {
              if (result.ok) onExit();
              else setUndoFailure(result.message);
            },
            // A REJECTED Undo is a failed Undo. Without this the rejection went
            // unhandled, `undoFailure` stayed null, and the screen said nothing
            // at all — while the post was still live. V8-R-CMP-011: "a failed
            // Undo must not report success", and saying nothing is worse than
            // reporting success, because the author is left to assume it worked.
            () => setUndoFailure('That did not reach the server.'),
          );
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
          selectedGroupIds={live.groupIds}
          groupsOpen={groupsOpen}
          nightOut={nightOut}
          storyAudience={storyAudience}
          storyRecipientCount={storyRecipientCount}
          people={taggedPeople}
          barName={bar?.name ?? null}
          busy={busy}
          failure={destinationFailure}
          landed={landed}
          undeliverable={live.undeliverable}
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
              // Dismissing DISCARDS what was being browsed and restores the last
              // committed audience, whatever it is. It NEVER resolves anything to
              // Friends: an author who committed "Bar Crew" and then tapped
              // Custom to look would otherwise have had their narrowing widened
              // to everyone by a gesture that means "never mind".
              //
              // An earlier version kept a Friends fallback for the case where the
              // restored choice ITSELF lapses — a circle that changed after the
              // commit, or an Account default that never resolved. That is still
              // a widening, and D-C-37 does not care whether the narrowing lapsed
              // after it was made: the audience on screen would grow from one
              // person to everyone without the author choosing it. So the lapsed
              // narrowing is KEPT. `publish()` refuses it and reopens this sheet,
              // which is a fail-closed dead end with two one-tap exits — pick a
              // different audience, or turn Story off.
              setStoryAudience(committedAudience.choice);
              setAudienceGroupId(committedAudience.groupId);
              setCustomIds(committedAudience.customIds);
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
      people={taggedPeople}
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
