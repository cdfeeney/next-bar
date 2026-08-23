'use client';

import { useState } from 'react';
import { useModalDialog } from '@/hooks/useModalDialog';
import CaptureFlow from '@/components/capture/CaptureFlow';
import type { Pair } from '@/components/capture/pairing';
import { getBarById } from '@/lib/catalog';
import type { Bar } from '@/types';
import StoryFrame from './StoryFrame';
import { AudienceSheet, BarSheet, PeopleSheet } from './StorySheets';
import type { StoryAudience, StoryItem, StoryPhoto, TaggedPerson } from './storyStore';

/**
 * Add to Story — the plus-badge entry branch, per
 * `next-bar-add-story-flow.png`. FIVE screens, not six: capture, review,
 * compose, audience, shared. There is deliberately NO destination picker
 * here, because entering through the plus on your own avatar has already
 * answered "where does this go?".
 *
 * Everything except this file's compose dock and receipt is reused, not
 * rebuilt: the capture pipeline is `CaptureFlow` unchanged, the bar and
 * people sheets are the same ones compose opens elsewhere, and the audience
 * sheet is the action-time component.
 *
 * ON THE GLOBAL "SHARE A MOMENT" PATH — stated plainly because the earlier
 * wording here ("untouched by this branch") read as though it existed.
 * It does NOT exist in this repository, and it did not exist at this goal's
 * base commit either: `git grep -i "share a moment"` over `src/` and `e2e/`
 * at the base finds nothing. So criterion 10's "the global path is unchanged"
 * is satisfied only vacuously — nothing was changed because there is nothing
 * there — and criterion 9's closing "then destination/audience/summary" names
 * that absent surface's destination step, not this branch's, which criterion 8
 * explicitly forbids ("No destination picker in this branch").
 *
 * It is deliberately NOT built here. A destination picker needs a second
 * destination that something can actually store, and this build has exactly
 * one: your story. A "Choose where to share" screen listing a single option,
 * or listing a Night Out that nothing persists a photo to, would be a control
 * whose behaviour does not exist. Reviewers have raised the gap twice; it is a
 * scope decision for the operator, not something to paper over from inside
 * this lane.
 */

/**
 * The capture pipeline hands back data URLs. Publication needs BYTES, because
 * the story lives in a private bucket rather than in this browser. `fetch` on
 * a data: URL is the one conversion that needs no hand-rolled base64 decode.
 */
async function dataUrlToBlob(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url);
    return await response.blob();
  } catch {
    return null;
  }
}

type Step = 'capture' | 'compose' | 'shared';

export default function AddStoryFlow({
  friends,
  friendsReady,
  onCancel,
  onPublish,
  onUndo,
  onViewStory,
}: {
  /** Accepted MUTUAL friends — the only permissible recipients. */
  friends: readonly TaggedPerson[];
  /** False until the real circle has resolved; narrowing is held until then. */
  friendsReady: boolean;
  onCancel: () => void;
  /**
   * Publishes to the SERVER. Resolves `ok:false` with a message when the story
   * did not land — the receipt is shown only on `ok:true`, because it claims
   * the story is live for 24 hours.
   */
  onPublish: (input: {
    main: Blob;
    inset?: Blob | null;
    barId?: string | null;
    caption?: string | null;
    audience: StoryAudience;
    audienceIds?: string[];
    tagIds?: string[];
  }) => Promise<{ ok: true; storyId: string } | { ok: false; message: string }>;
  /** Author delete, from the receipt's Undo. */
  onUndo: (storyId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  onViewStory: () => void;
}): JSX.Element {
  const [step, setStep] = useState<Step>('capture');
  const [pair, setPair] = useState<Pair | null>(null);
  const [bar, setBar] = useState<Bar | null>(null);
  const [people, setPeople] = useState<TaggedPerson[]>([]);
  const [audience, setAudience] = useState<StoryAudience>('friends');
  const [audienceIds, setAudienceIds] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'bar' | 'people' | 'audience' | null>(null);
  const [postedId, setPostedId] = useState<string | null>(null);
  /** Set when a post was refused because the narrowed audience had emptied. */
  const [audienceLapsed, setAudienceLapsed] = useState(false);

  /**
   * The recipients that are still real at THIS moment, resolved against the
   * live friends list rather than trusting the earlier pick. The server checks
   * this again — every custom recipient must be an accepted mutual friend or
   * `publish_story` refuses — so this is the honest UI half of a rule the
   * database enforces, not the rule itself.
   */
  const liveIds = audienceIds.filter((id) => friends.some((f) => f.id === id));

  if (step === 'capture') {
    return (
      <CaptureFlow
        title="Add to your story"
        subtitle="Capture now, then choose who sees it."
        onCancel={onCancel}
        onApproved={(approved) => {
          setPair(approved);
          setStep('compose');
        }}
      />
    );
  }

  const photo = {
    kind: pair?.inset != null ? ('dual' as const) : ('single' as const),
    main: pair?.main ?? null,
    inset: pair?.inset ?? null,
    // Compose shows the capture the author just took, held in memory as a data
    // URL. There is no signing step in this direction, so there is no signing
    // failure to report — a null here is simply "nothing captured yet".
    state: 'ok' as const,
  };

  /**
   * Dismissing the audience sheet — backdrop, ✕ or Escape — is not Done.
   * `onChange` commits the row the moment it is tapped, so leaving that way
   * with nobody picked used to store `groups`/`custom` with an empty
   * `audienceHandles`: the label with nothing behind it that both the sheet's
   * Done gate and `StoryItem`'s contract exist to prevent. The narrowing is
   * dropped rather than the dismissal blocked, because a dismissal is a
   * decision not to narrow.
   */
  const closeAudience = (): void => {
    if (audience !== 'friends' && liveIds.length === 0) {
      setAudience('friends');
    }
    setSheet(null);
  };

  const add = async (): Promise<void> => {
    if (busy) return;
    // A narrowing whose recipients have all left your circle is NOT quietly
    // downgraded to Friends. That was a show-vs-store mismatch in the more
    // dangerous direction: the compose row still read "Custom" at the moment
    // of the tap while the story went out to Friends, i.e. BROADER than the
    // screen said. Refuse the post and reopen the audience sheet.
    if (audience !== 'friends' && liveIds.length === 0) {
      setAudienceLapsed(true);
      setSheet('audience');
      return;
    }
    if (pair === null) return;
    setBusy(true);
    setFailure(null);
    const main = await dataUrlToBlob(pair.main);
    const inset = pair.inset === null ? null : await dataUrlToBlob(pair.inset);
    if (main === null || (pair.inset !== null && inset === null)) {
      setBusy(false);
      setFailure('That photo could not be read. Nothing was shared.');
      return;
    }
    const result = await onPublish({
      main,
      inset,
      barId: bar?.id ?? null,
      caption: null,
      audience,
      audienceIds: audience === 'friends' ? [] : liveIds,
      tagIds: people.map((person) => person.id),
    });
    setBusy(false);
    // The receipt claims the story is LIVE FOR 24 HOURS. It is shown only when
    // the server actually took it — both the upload and the metadata publish.
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    setPostedId(result.storyId);
    setStep('shared');
  };

  if (step === 'shared' && postedId !== null) {
    return (
      <SharedReceipt
        photo={photo}
        barId={bar?.id ?? null}
        // A failed Undo used to be stored in state and rendered nowhere: the
        // receipt had no failure slot, so the user tapped Undo, saw the screen
        // sit there unchanged, and was left believing the story had been
        // withdrawn while it stayed live for all their friends. The one
        // outcome this screen must never be silent about.
        failure={failure}
        onClose={onCancel}
        onViewStory={onViewStory}
        onUndo={() => {
          // Undo DELETES on the server. Closing regardless would leave a story
          // live that the user was told had been undone.
          setFailure(null);
          void onUndo(postedId).then((result) => {
            if (result.ok) onCancel();
            else setFailure(result.message);
          });
        }}
      />
    );
  }

  return (
    <ComposeDialog sheetOpen={sheet !== null} onCancel={onCancel}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-2xl">Add to your story.</h2>
        <button
          type="button"
          data-testid="story-compose-cancel"
          onClick={onCancel}
          aria-label="Discard this story"
          className="w-11 h-11 -mr-2 -mt-1 shrink-0 flex items-center justify-center rounded-full border border-border text-muted touch-manipulation"
        >
          ✕
        </button>
      </div>

      <StoryFrame
        photo={photo}
        barId={bar?.id ?? null}
        className="mt-4 rounded-2xl border border-border aspect-[4/5]"
        insetClassName="w-24"
      />

      <div className="mt-4 space-y-2">
        <MetaRow
          testId="story-compose-bar"
          icon="◎"
          label="Bar"
          value={bar?.name ?? 'Choose'}
          onClick={() => setSheet('bar')}
        />
        <MetaRow
          testId="story-compose-people"
          icon="◑"
          label="People"
          value={peopleLabel(people)}
          onClick={() => setSheet('people')}
        />
      </div>

      <div className="mt-auto pb-[calc(env(safe-area-inset-bottom)+20px)] pt-4 space-y-3">
        <button
          type="button"
          data-testid="story-compose-audience"
          onClick={() => setSheet('audience')}
          className="w-full flex items-center gap-3 min-h-[48px] px-4 rounded-2xl border border-accent text-left touch-manipulation"
        >
          <span className="flex-1 text-sm">Story audience</span>
          <span className="text-accent text-sm">{audienceLabel(audience)}</span>
          <span aria-hidden="true" className="text-accent">
            ›
          </span>
        </button>
        <button
          type="button"
          data-testid="story-compose-add"
          onClick={() => { void add(); }}
          aria-disabled={busy}
          className="w-full min-h-[52px] rounded-2xl bg-accent text-bg font-display text-sm uppercase tracking-widest touch-manipulation hover:bg-accentDim transition-colors"
        >
          Add to my story
        </button>
        {failure !== null ? (
          <p
            data-testid="story-save-failed"
            role="alert"
            className="text-sm leading-relaxed text-center"
          >
            {failure}
          </p>
        ) : null}
      </div>

      {sheet === 'bar' ? (
        <BarSheet
          onPick={(picked) => {
            setBar(picked);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'people' ? (
        <PeopleSheet
          friends={friends}
          selected={people}
          onToggle={(person) =>
            setPeople((current) =>
              current.some((entry) => entry.id === person.id)
                ? current.filter((entry) => entry.id !== person.id)
                : [...current, person],
            )
          }
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'audience' ? (
        <AudienceSheet
          value={audience}
          friends={friendsReady ? friends : []}
          handles={audienceIds}
          onChange={setAudience}
          onToggleHandle={(id) =>
            setAudienceIds((current: string[]) =>
              current.includes(id)
                ? current.filter((entry) => entry !== id)
                : [...current, id],
            )
          }
          lapsed={audienceLapsed}
          onDone={() => {
            setAudienceLapsed(false);
            setSheet(null);
          }}
          onClose={() => {
            setAudienceLapsed(false);
            closeAudience();
          }}
        />
      ) : null}
    </ComposeDialog>
  );
}

/**
 * The compose screen's dialog shell. It is its own component so the shared
 * modal contract mounts WITH compose rather than with the flow — the flow
 * opens on the capture step, which is a dialog of its own, and two traps armed
 * over one document fight for focus.
 */
function ComposeDialog({
  sheetOpen,
  onCancel,
  children,
}: {
  sheetOpen: boolean;
  onCancel: () => void;
  children: React.ReactNode;
}): JSX.Element {
  const ref = useModalDialog<HTMLDivElement>(onCancel, !sheetOpen);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Add to your story"
      data-testid="story-compose"
      tabIndex={-1}
      className="fixed inset-0 z-[1100] bg-bg flex flex-col overflow-y-auto px-5 pt-[calc(env(safe-area-inset-top)+16px)] outline-none"
    >
      {children}
    </div>
  );
}

function peopleLabel(people: readonly TaggedPerson[]): string {
  if (people.length === 0) return 'Add';
  const first = people[0].name.split(/\s+/)[0];
  return people.length === 1 ? first : `${first} + ${people.length - 1}`;
}

function audienceLabel(audience: StoryAudience): string {
  return audience === 'custom' ? 'Custom' : 'Friends';
}

function MetaRow({
  testId,
  icon,
  label,
  value,
  onClick,
}: {
  testId: string;
  icon: string;
  label: string;
  value: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="w-full flex items-center gap-3 min-h-[52px] px-4 rounded-2xl border border-border bg-surface text-left touch-manipulation hover:border-accent transition-colors"
    >
      <span aria-hidden="true" className="text-muted">
        {icon}
      </span>
      <span className="flex-1 text-sm">{label}</span>
      <span className="text-muted text-sm truncate max-w-[45%]">{value}</span>
      <span aria-hidden="true" className="text-muted">
        ›
      </span>
    </button>
  );
}

/**
 * The locked receipt shape: concise confirmation, two actions, ✕ exits. Your
 * avatar now carries a live ring AND keeps the plus — viewing and adding stay
 * two distinct targets on one avatar.
 */
function SharedReceipt({
  photo,
  barId,
  failure,
  onClose,
  onViewStory,
  onUndo,
}: {
  photo: StoryPhoto;
  barId: string | null;
  /** Set when Undo did not reach the server. The story is STILL LIVE. */
  failure: string | null;
  onClose: () => void;
  onViewStory: () => void;
  onUndo: () => void;
}): JSX.Element {
  const bar = barId !== null ? getBarById(barId) : undefined;
  const ref = useModalDialog<HTMLDivElement>(onClose);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Added to your story"
      data-testid="story-shared-receipt"
      tabIndex={-1}
      className="fixed inset-0 z-[1100] bg-bg flex flex-col overflow-y-auto px-5 pt-[calc(env(safe-area-inset-top)+16px)] outline-none"
    >
      <div className="flex justify-end">
        <button
          type="button"
          data-testid="story-receipt-close"
          onClick={onClose}
          aria-label="Close"
          className="w-11 h-11 -mr-2 flex items-center justify-center rounded-full border border-border text-muted touch-manipulation"
        >
          ✕
        </button>
      </div>

      <h2 className="font-display text-2xl text-center mt-2">
        Added to your story.
      </h2>
      <p className="text-muted text-sm text-center mt-1">
        {bar ? `${bar.name} · ` : ''}Live for 24 hours
      </p>

      <StoryFrame
        photo={photo}
        barId={barId}
        className="mt-5 rounded-2xl border border-border aspect-[4/5]"
        insetClassName="w-24"
      />

      <div className="mt-auto pb-[calc(env(safe-area-inset-bottom)+20px)] pt-4 flex items-center gap-3">
        <button
          type="button"
          data-testid="story-receipt-view"
          onClick={onViewStory}
          className="flex-1 min-h-[52px] rounded-2xl border border-border font-display text-sm uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
        >
          View story
        </button>
        <button
          type="button"
          data-testid="story-receipt-undo"
          onClick={onUndo}
          className="flex-1 min-h-[52px] rounded-2xl border border-border font-display text-sm uppercase tracking-widest touch-manipulation hover:border-accent transition-colors"
        >
          Undo
        </button>
      </div>
      {failure !== null ? (
        <p
          data-testid="story-undo-failed"
          role="alert"
          className="text-sm leading-relaxed text-center pb-[calc(env(safe-area-inset-bottom)+20px)]"
        >
          {failure} Your story is still live.
        </p>
      ) : null}
    </div>
  );
}
