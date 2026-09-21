'use client';

import { useState } from 'react';

import BarPicker from '@/components/BarPicker';
import Sheet from '@/components/story/Sheet';
import StoryFrame from '@/components/story/StoryFrame';
import { PeopleSheet } from '@/components/story/StorySheets';
import { Glyph, MartiniGlyphPaths, PersonGlyphPaths } from '@/components/icons';
import type { StoryPhoto, TaggedPerson } from '@/components/story/storyStore';
import { useModalDialog } from '@/hooks/useModalDialog';
import type { Bar } from '@/types';

import { MAX_COMPOSER_CAPTION } from './types';

/** README §9.3: the caption counter shows only once this many characters remain. */
const CAPTION_COUNTER_FROM = 40;

/**
 * Step 1 of 3 — Compose (V8-R-CMP-001).
 *
 * "Compose carries only two metadata rows, Bar and People, each opening an
 * optional picker that returns straight to Compose." Both pickers are SHEETS
 * over this screen, never further full-screen steps, which is why the modal
 * trap here is disarmed while one is open — two traps over one document fight
 * for focus.
 *
 * The caption (V8-R-CMP-010) lives HERE and only here. Since S-11 this is the
 * one compose screen for every entry point — Add-to-Story hands its approved
 * pair to this composer rather than carrying a caption-free dock of its own.
 *
 * The bar sheet wraps the app's ONE `BarPicker` rather than growing a second
 * search list — the same reuse `story/StorySheets.tsx` makes — but it is opened
 * from here with its own test id so a composer assertion cannot accidentally
 * pass against the story branch's sheet.
 */
export default function ComposeStep({
  photo,
  caption,
  bar,
  people,
  friends,
  failure,
  busy = false,
  onCaptionChange,
  onBarChange,
  onPeopleChange,
  onNext,
  onRetake,
  onExit,
}: {
  photo: StoryPhoto;
  caption: string;
  bar: Bar | null;
  people: readonly TaggedPerson[];
  /** Accepted MUTUAL friends — the only people who can be tagged. */
  friends: readonly TaggedPerson[];
  /**
   * A publish that did not land. V8-R-CMP-001: "an upload failure saves the
   * draft in Compose and is never silently dropped" — so the flow comes back
   * here with every field intact and says so out loud.
   */
  failure: string | null;
  /**
   * True while a publish is in flight. Compose is not where publishing happens,
   * so this is defence in depth behind the Destinations Back lock: if any future
   * route ever lands here mid-write, this screen's ✕ and Escape must not be the
   * hole that discards the receipt.
   */
  busy?: boolean;
  onCaptionChange: (next: string) => void;
  onBarChange: (next: Bar | null) => void;
  onPeopleChange: (next: readonly TaggedPerson[]) => void;
  onNext: () => void;
  /** README §9.3's Retake pill — discards the pair and reopens the capture options. */
  onRetake: () => void;
  onExit: () => void;
}): JSX.Element {
  const [sheet, setSheet] = useState<'bar' | 'people' | null>(null);
  const ref = useModalDialog<HTMLDivElement>(busy ? null : onExit, sheet === null);
  const remaining = MAX_COMPOSER_CAPTION - caption.length;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Share a moment"
      data-testid="composer-compose"
      tabIndex={-1}
      className="fixed inset-0 z-[1100] bg-bg flex flex-col overflow-y-auto px-5 pt-[calc(env(safe-area-inset-top)+16px)] outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-[22px] font-bold leading-tight">Share a moment.</h2>
        <ExitButton testId="composer-compose-exit" onClick={onExit} disabled={busy} />
      </div>

      {/* README §9.3: the pair as a 104px thumbnail with its inset, and the
          Retake pill beside it. Retake discards the pair and reopens the
          capture options — the same contract as the review screen's Retake. */}
      <div className="mt-4 flex items-center gap-4">
        <StoryFrame
          photo={photo}
          barId={bar?.id ?? null}
          className="w-[104px] shrink-0 aspect-[3/4] rounded-2xl border border-border"
          insetClassName="w-8"
        />
        <button
          type="button"
          data-testid="composer-retake"
          onClick={onRetake}
          disabled={busy}
          aria-disabled={busy}
          className="min-h-[44px] px-5 rounded-full border border-border font-display text-xs uppercase tracking-widest touch-manipulation hover:border-accent transition-colors disabled:bg-held disabled:text-muted"
        >
          Retake
        </button>
      </div>

      <div className="mt-4">
        <label htmlFor="composer-caption" className="block text-sm">
          Caption <span className="text-muted text-[11px]">(optional)</span>
        </label>
        <textarea
          id="composer-caption"
          data-testid="composer-caption"
          value={caption}
          rows={2}
          // Belt AND braces: `maxLength` stops typing past the bound, and the
          // slice stops a paste that a browser would otherwise let through in
          // one go. Neither is the authority — the destination backends bound
          // their own captions — but the screen must not show 200 characters
          // and then publish 140.
          maxLength={MAX_COMPOSER_CAPTION}
          onChange={(event) =>
            onCaptionChange(event.target.value.slice(0, MAX_COMPOSER_CAPTION))
          }
          placeholder="Say something (optional)"
          className="mt-2 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
        />
        {/* README §9.3: the counter appears only in the last 40 characters —
            a count nobody is near yet is noise, not information. */}
        {remaining <= CAPTION_COUNTER_FROM ? (
          <p
            data-testid="composer-caption-count"
            // Announced politely rather than interrupting each keystroke.
            aria-live="polite"
            className="text-muted text-[11px] mt-1 text-right"
          >
            {remaining} characters left
          </p>
        ) : null}
      </div>

      <div className="mt-4 space-y-2">
        <MetaRow
          testId="composer-bar"
          icon={<Glyph><MartiniGlyphPaths /></Glyph>}
          label="Bar"
          value={bar?.name ?? ''}
          action={bar === null ? 'Choose' : 'Change'}
          onClick={() => setSheet('bar')}
        />
        <MetaRow
          testId="composer-people"
          icon={<Glyph><PersonGlyphPaths /></Glyph>}
          label="People"
          value={peopleLabel(people)}
          action={people.length === 0 ? 'Add' : 'Change'}
          onClick={() => setSheet('people')}
        />
      </div>

      <div className="mt-auto pb-[calc(env(safe-area-inset-bottom)+20px)] pt-4 space-y-3">
        {failure !== null ? (
          <p
            data-testid="composer-publish-failed"
            role="alert"
            className="text-sm leading-relaxed text-center rounded-2xl border border-accent px-4 py-3"
          >
            {failure} Your draft is still here.
          </p>
        ) : null}
        <button
          type="button"
          data-testid="composer-next"
          onClick={onNext}
          className="w-full min-h-[54px] rounded-2xl bg-accent text-bg font-display text-sm uppercase tracking-widest touch-manipulation hover:bg-accentDim transition-colors"
        >
          Next
        </button>
      </div>

      {sheet === 'bar' ? (
        <Sheet
          label="Where was this?"
          testId="composer-bar-sheet"
          onClose={() => setSheet(null)}
        >
          <p className="text-muted text-[11px] mb-3 leading-relaxed">
            The venue is chosen by you. It is never read from your location.
          </p>
          <div className="max-h-[55vh] overflow-y-auto">
            <BarPicker
              onPick={(picked) => {
                onBarChange(picked);
                setSheet(null);
              }}
            />
          </div>
        </Sheet>
      ) : null}

      {sheet === 'people' ? (
        <PeopleSheet
          friends={friends}
          selected={people}
          onToggle={(person) =>
            onPeopleChange(
              people.some((entry) => entry.id === person.id)
                ? people.filter((entry) => entry.id !== person.id)
                : [...people, person],
            )
          }
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}

/** V8-R-CMP-009 — every full-screen composer state carries this exact control. */
export function ExitButton({
  testId,
  onClick,
  disabled = false,
  label = 'Close without sharing',
}: {
  testId: string;
  onClick: () => void;
  /** Set while a publish is in flight — leaving then would discard its receipt. */
  disabled?: boolean;
  label?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      aria-label={label}
      className="w-11 h-11 -mr-2 -mt-1 shrink-0 flex items-center justify-center rounded-full border border-border text-muted touch-manipulation disabled:bg-held"
    >
      ✕
    </button>
  );
}

function peopleLabel(people: readonly TaggedPerson[]): string {
  // Empty: the row's ACTION already says "Add"; printing it twice read as two
  // controls on the phone (owner, 2026-09-20).
  if (people.length === 0) return '';
  const first = people[0].name.split(/\s+/)[0];
  return people.length === 1 ? first : `${first} + ${people.length - 1}`;
}

function MetaRow({
  testId,
  icon,
  label,
  value,
  action,
  onClick,
}: {
  testId: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  /** Named on the row itself, per V8-R-CMP-013's accessibility line. */
  action: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      data-value={value}
      onClick={onClick}
      aria-label={`${action} ${label.toLowerCase()}`}
      className="w-full flex items-center gap-3 min-h-[56px] px-4 rounded-2xl border border-border bg-surface text-left touch-manipulation hover:border-accent transition-colors"
    >
      <span aria-hidden="true" className="text-muted">
        {icon}
      </span>
      <span className="flex-1 text-sm">{label}</span>
      <span className="text-muted text-sm truncate max-w-[45%]">{value}</span>
      <span className="text-accent text-[11px] uppercase tracking-widest">{action}</span>
    </button>
  );
}
