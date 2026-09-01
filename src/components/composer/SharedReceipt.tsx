'use client';

import StoryFrame from '@/components/story/StoryFrame';
import type { StoryPhoto } from '@/components/story/storyStore';
import { useModalDialog } from '@/hooks/useModalDialog';

import { ExitButton } from './ComposeStep';
import {
  DESTINATION_LABELS,
  missingDestinations,
  receiptFor,
  type DestinationKey,
} from './types';

/**
 * Step 3 of 3 — Shared (V8-R-CMP-011).
 *
 * Exactly three receipts, chosen by `receiptFor`, and each carries EXACTLY TWO
 * actions: its own primary (View post / View story / Done) and Undo. No "Back
 * to Social", no reassurance copy.
 *
 * TWO THINGS THIS SCREEN MUST NEVER BE SILENT ABOUT, both of which are
 * requirement clauses rather than polish:
 *
 *   - A PARTIAL publish (V8-R-CMP-002): "must not leave the post live on one
 *     destination and silently absent from another". The receipt counts what
 *     LANDED, and names what did not.
 *   - A FAILED UNDO (V8-R-CMP-011): "a failed Undo must not report success".
 *     The post is still live and the screen says so.
 *
 * A QUEUED publish (V8-R-CMP-008) is labelled queued and never labelled Shared,
 * so the counted receipt's headline is replaced rather than decorated.
 */
export default function SharedReceipt({
  photo,
  barId,
  selected,
  delivered,
  missingGroupNames = [],
  queued = false,
  undoFailure,
  undoing = false,
  onExit,
  onUndo,
  onViewPost,
  onViewStory,
}: {
  photo: StoryPhoto;
  barId: string | null;
  /** What the author chose. */
  selected: readonly DestinationKey[];
  /** What actually landed. */
  delivered: readonly DestinationKey[];
  /**
   * Group threads that were chosen but did not receive it. `delivered` cannot
   * carry this — Group is ONE key covering N threads — so a publish that reached
   * one group and missed another would show the Group chip and say nothing about
   * the miss. V8-R-CMP-002's "never silent" applies one level down too.
   */
  missingGroupNames?: readonly string[];
  queued?: boolean;
  /** Set when Undo did not reach the server. What was published is STILL LIVE. */
  undoFailure: string | null;
  /**
   * True while an Undo is in flight. Every way OFF this screen is locked until
   * it settles: leaving first means a failed Undo can never say so, and the
   * author walks away believing a still-live post was withdrawn (V8-R-CMP-011,
   * "a failed Undo must not report success"). It also stops a second tap
   * dispatching a concurrent deletion.
   */
  undoing?: boolean;
  onExit: () => void;
  onUndo: () => void;
  onViewPost: () => void;
  onViewStory: () => void;
}): JSX.Element {
  const ref = useModalDialog<HTMLDivElement>(undoing ? null : onExit);
  const receipt = receiptFor(delivered);
  const missing = missingDestinations(selected, delivered);
  const headline = queued
    ? `Queued for ${delivered.length} ${delivered.length === 1 ? 'place' : 'places'}`
    : receipt.headline;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={headline}
      data-testid="composer-receipt"
      data-receipt-kind={queued ? 'queued' : receipt.kind}
      tabIndex={-1}
      className="fixed inset-0 z-[1100] bg-bg flex flex-col overflow-y-auto px-5 pt-[calc(env(safe-area-inset-top)+16px)] outline-none"
    >
      <div className="flex justify-end">
        {/* After Share, ✕ returns to Social (V8-R-CMP-009). */}
        <ExitButton
          testId="composer-receipt-exit"
          onClick={onExit}
          disabled={undoing}
          label={undoing ? 'Undoing — please wait' : 'Back to Social'}
        />
      </div>

      <h2 data-testid="composer-receipt-headline" className="font-display text-2xl text-center mt-2">
        {headline}
      </h2>

      {/* Per-destination indicators — the counted receipt's third element. */}
      <ul
        data-testid="composer-receipt-destinations"
        aria-label="Where this went"
        className="mt-2 flex flex-wrap justify-center gap-2"
      >
        {delivered.map((key) => (
          <li
            key={key}
            data-testid="composer-receipt-destination"
            data-destination={key}
            className="text-[11px] uppercase tracking-widest text-accent border border-accent rounded-full px-3 py-1"
          >
            {DESTINATION_LABELS[key]}
          </li>
        ))}
      </ul>

      {missing.length > 0 || missingGroupNames.length > 0 ? (
        <p
          data-testid="composer-receipt-partial"
          role="alert"
          className="text-sm leading-relaxed text-center mt-3 rounded-2xl border border-accent px-4 py-3"
        >
          {[
            ...missing.map((key) => DESTINATION_LABELS[key]),
            ...missingGroupNames,
          ].join(' and ')}{' '}
          did not go through. Try those again.
        </p>
      ) : null}

      <StoryFrame
        photo={photo}
        barId={barId}
        className="mt-5 rounded-2xl border border-border aspect-[4/5]"
        insetClassName="w-24"
      />

      <div className="mt-auto pb-[calc(env(safe-area-inset-bottom)+20px)] pt-4 flex items-center gap-3">
        <button
          type="button"
          data-testid="composer-receipt-primary"
          data-action={receipt.primaryAction}
          disabled={undoing}
          aria-disabled={undoing}
          onClick={
            receipt.primaryAction === 'view-post'
              ? onViewPost
              : receipt.primaryAction === 'view-story'
                ? onViewStory
                : onExit
          }
          className="flex-1 min-h-[52px] rounded-2xl border border-border font-display text-sm uppercase tracking-widest touch-manipulation disabled:opacity-40 hover:border-accent transition-colors"
        >
          {receipt.primaryLabel}
        </button>
        <button
          type="button"
          data-testid="composer-receipt-undo"
          onClick={onUndo}
          disabled={undoing}
          aria-disabled={undoing}
          className="flex-1 min-h-[52px] rounded-2xl border border-border font-display text-sm uppercase tracking-widest touch-manipulation disabled:opacity-40 hover:border-accent transition-colors"
        >
          {undoing ? 'Undoing…' : 'Undo'}
        </button>
      </div>

      {undoFailure !== null ? (
        <p
          data-testid="composer-undo-failed"
          role="alert"
          className="text-sm leading-relaxed text-center pb-[calc(env(safe-area-inset-bottom)+20px)]"
        >
          {undoFailure} It is still live.
        </p>
      ) : null}
    </div>
  );
}
