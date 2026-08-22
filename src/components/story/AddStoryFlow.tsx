'use client';

import { useState } from 'react';
import { useModalDialog } from '@/hooks/useModalDialog';
import CaptureFlow from '@/components/capture/CaptureFlow';
import type { Pair } from '@/components/capture/pairing';
import { getBarById } from '@/lib/catalog';
import type { Bar } from '@/types';
import StoryFrame from './StoryFrame';
import { AudienceSheet, BarSheet, PeopleSheet } from './StorySheets';
import type { StoryAudience, StoryItem, TaggedPerson } from './storyStore';

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
 * sheet is the action-time component. The global Share a moment → Choose
 * where to share → Shared path is untouched by this branch.
 */

function newId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `own-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

type Step = 'capture' | 'compose' | 'shared';

export default function AddStoryFlow({
  onCancel,
  onPosted,
  onUndo,
  onViewStory,
}: {
  onCancel: () => void;
  /** False when the store refused it — no receipt is shown in that case. */
  onPosted: (item: StoryItem) => boolean;
  onUndo: (itemId: string) => void;
  onViewStory: () => void;
}): JSX.Element {
  const [step, setStep] = useState<Step>('capture');
  const [pair, setPair] = useState<Pair | null>(null);
  const [bar, setBar] = useState<Bar | null>(null);
  const [people, setPeople] = useState<TaggedPerson[]>([]);
  const [audience, setAudience] = useState<StoryAudience>('friends');
  const [audienceHandles, setAudienceHandles] = useState<string[]>([]);
  const [saveFailed, setSaveFailed] = useState(false);
  const [sheet, setSheet] = useState<'bar' | 'people' | 'audience' | null>(null);
  const [posted, setPosted] = useState<StoryItem | null>(null);

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
  };

  const add = (): void => {
    const item: StoryItem = {
      id: newId(),
      postedAt: new Date().toISOString(),
      barId: bar?.id ?? null,
      caption: null,
      tagged: people,
      photo,
      audience,
      audienceHandles: audience === 'friends' ? [] : audienceHandles,
    };
    // The receipt is a claim that the story is live for 24 hours, so it is
    // shown only when the store actually took it. A blocked or full quota used
    // to reach the same screen, and the post was gone on the next reload.
    if (!onPosted(item)) {
      setSaveFailed(true);
      return;
    }
    setSaveFailed(false);
    setPosted(item);
    setStep('shared');
  };

  if (step === 'shared' && posted !== null) {
    return (
      <SharedReceipt
        item={posted}
        onClose={onCancel}
        onViewStory={onViewStory}
        onUndo={() => {
          onUndo(posted.id);
          onCancel();
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
          onClick={add}
          className="w-full min-h-[52px] rounded-2xl bg-accent text-bg font-display text-sm uppercase tracking-widest touch-manipulation hover:bg-accentDim transition-colors"
        >
          Add to my story
        </button>
        {saveFailed ? (
          <p
            data-testid="story-save-failed"
            role="alert"
            className="text-sm leading-relaxed text-center"
          >
            This device is out of room for stories. Free some space and try
            again — nothing was shared.
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
          selected={people}
          onToggle={(person) =>
            setPeople((current) =>
              current.some((entry) => entry.handle === person.handle)
                ? current.filter((entry) => entry.handle !== person.handle)
                : [...current, person],
            )
          }
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'audience' ? (
        <AudienceSheet
          value={audience}
          handles={audienceHandles}
          onChange={setAudience}
          onToggleHandle={(handle) =>
            setAudienceHandles((current) =>
              current.includes(handle)
                ? current.filter((entry) => entry !== handle)
                : [...current, handle],
            )
          }
          onDone={() => setSheet(null)}
          onClose={() => setSheet(null)}
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
  if (audience === 'groups') return 'Selected groups';
  if (audience === 'custom') return 'Custom';
  return 'Friends';
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
  item,
  onClose,
  onViewStory,
  onUndo,
}: {
  item: StoryItem;
  onClose: () => void;
  onViewStory: () => void;
  onUndo: () => void;
}): JSX.Element {
  const bar = item.barId !== null ? getBarById(item.barId) : undefined;
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
        photo={item.photo}
        barId={item.barId}
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
    </div>
  );
}
