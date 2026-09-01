'use client';

import { useModalDialog } from '@/hooks/useModalDialog';
import type { TaggedPerson } from '@/components/story/storyStore';

import { ExitButton } from './ComposeStep';
import {
  DESTINATION_LABELS,
  ctaLabel,
  summaryLines,
  type ComposerGroup,
  type ComposerNightOut,
  type DestinationKey,
  type RetiredDestinations,
  type StoryAudienceChoice,
} from './types';

/**
 * Step 2 of 3 — Destinations (V8-R-CMP-001, -002).
 *
 * FOUR ROWS, NO FIFTH, and everything the screen needs resolved INLINE:
 * "the destination screen resolves audience and groups inline and its CTA
 * publishes. There is no separate review page."
 *
 *   - Feed (V8-R-CMP-004) — one tap, persists until the author deletes it.
 *   - Story (V8-R-CMP-005) — one tap, plus an audience SUBROW joined to it. The
 *     subrow governs the story only and opens a sheet, not a fourth frame.
 *   - Night Out (V8-R-CMP-006) — one tap; with no night out tonight the row
 *     SAYS SO rather than silently doing nothing.
 *   - Group (V8-R-CMP-007) — expands IN PLACE. The dropdown is joined to the
 *     row it came from and the selected summary stays on the row itself whether
 *     it is open or closed, so it never reads as a new screen.
 *
 * The pre-publish summary (V8-R-CMP-014) sits directly above the CTA, which is
 * the only publishing button on the surface, and the CTA names its effect
 * (V8-R-CMP-008). Nothing here writes: selection is device state until the CTA
 * fires.
 */
export default function DestinationsStep({
  destinations,
  groups,
  selectedGroupIds,
  groupsOpen,
  nightOut,
  storyAudience,
  storyRecipientCount,
  people,
  barName,
  busy,
  failure,
  retired = {},
  undeliverable,
  sheetOpen = false,
  onToggleDestination,
  onToggleGroupsOpen,
  onToggleGroup,
  onOpenAudience,
  onBack,
  onExit,
  onPublish,
}: {
  destinations: readonly DestinationKey[];
  groups: readonly ComposerGroup[];
  selectedGroupIds: readonly string[];
  groupsOpen: boolean;
  /** Tonight's night out, or null — the row states which (V8-R-CMP-006). */
  nightOut: ComposerNightOut | null;
  storyAudience: StoryAudienceChoice;
  /** Recipients AFTER the D-C-37 intersection; null means "all your friends". */
  storyRecipientCount: number | null;
  people: readonly TaggedPerson[];
  barName: string | null;
  busy: boolean;
  failure: string | null;
  /**
   * Destinations closed to further sending, and why — `sent` (confirmed) or
   * `maybe` (the attempt threw and said nothing). Both lock the row, because one
   * media object reaches one destination at most once (V8-R-CMP-003); only the
   * wording differs, since the composer must not claim a delivery it cannot know.
   */
  retired?: RetiredDestinations;
  /**
   * Selected destinations that currently have no target, reconciled against the
   * live props by the parent. Passed in rather than recomputed so the CTA, the
   * summary and the publish guard cannot drift apart.
   */
  undeliverable: readonly DestinationKey[];
  /**
   * True while the Story-audience sheet is open ABOVE this screen. It disarms
   * this dialog's own key handling: two live traps on one document race, the
   * outer one fires first, and Escape would exit the whole composer — losing
   * the draft — instead of closing the sheet. `useModalDialog`'s `enabled` flag
   * exists for exactly this, and `ComposeStep` already uses it for its own two
   * sheets.
   */
  sheetOpen?: boolean;
  onToggleDestination: (key: DestinationKey) => void;
  onToggleGroupsOpen: () => void;
  onToggleGroup: (groupId: string) => void;
  onOpenAudience: () => void;
  onBack: () => void;
  onExit: () => void;
  onPublish: () => void;
}): JSX.Element {
  // Escape is inert WHILE PUBLISHING (`onClose` null) so an in-flight write
  // cannot be abandoned before its receipt, and inert under the sheet so the
  // two traps do not race. The Tab cycle stays armed in both cases.
  const ref = useModalDialog<HTMLDivElement>(busy ? null : onExit, !sheetOpen);
  const on = (key: DestinationKey): boolean => destinations.includes(key);
  const ready = destinations.length > 0 && !busy && undeliverable.length === 0;
  /**
   * A row that is ON must ALWAYS be turn-off-able.
   *
   * Round 3 disabled the Night Out row whenever its night out was gone, which
   * also disabled it when the row was still ON from an earlier selection — so
   * the author could not clear it, the CTA stayed disabled demanding they clear
   * it, and the whole share was stranded with only ✕ (losing the draft) as a
   * way out. `disabled` may prevent turning a destination ON. It may never
   * prevent turning one OFF.
   */
  const rowDisabled = (key: DestinationKey, unavailable = false): boolean =>
    !on(key) && (unavailable || retired[key] !== undefined);
  /** What a closed row may CLAIM — only what the composer actually knows. */
  const retiredHint = (key: DestinationKey): string | null =>
    retired[key] === 'sent'
      ? 'Already shared here'
      : retired[key] === 'maybe'
        ? 'May already be shared'
        : null;

  const lines = summaryLines({
    destinations,
    storyAudience,
    storyRecipientCount,
    groupNames: groups
      .filter((group) => selectedGroupIds.includes(group.id))
      .map((group) => group.name),
    nightOutLabel: nightOut?.label ?? null,
    tagged: people,
    barName,
  });

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Choose where to share"
      data-testid="composer-destinations"
      tabIndex={-1}
      className="fixed inset-0 z-[1100] bg-bg flex flex-col overflow-y-auto px-5 pt-[calc(env(safe-area-inset-top)+16px)] outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          data-testid="composer-back"
          onClick={onBack}
          // Back is an EXIT ROUTE, not just navigation: Compose carries its own
          // ✕ and its own armed Escape, so leaving this screen mid-write walks
          // straight past the lock below and unmounts the composer before its
          // receipt arrives. Locking ✕ and Escape here and leaving this open was
          // the round-4 defect.
          disabled={busy}
          aria-disabled={busy}
          className="text-muted text-sm min-h-[44px] -ml-1 pr-3 touch-manipulation disabled:opacity-40"
        >
          ‹ Back
        </button>
        {/* Closing mid-write would discard the receipt for something that is
            about to be live — including a partial, which V8-R-CMP-002 says must
            never be silent. Unavailable until the publish settles. */}
        <ExitButton
          testId="composer-destinations-exit"
          onClick={onExit}
          disabled={busy}
          label={busy ? 'Sharing — please wait' : undefined}
        />
      </div>

      <h2 className="font-display text-2xl mt-1">Where does this go?</h2>

      <ul className="mt-5 space-y-2">
        <li>
          <DestinationRow
            testId="composer-destination-feed"
            destination="feed"
            hint={retiredHint('feed') ?? 'Stays until you delete it · friends can comment'}
            on={on('feed')}
            disabled={rowDisabled('feed')}
            onClick={() => onToggleDestination('feed')}
          />
        </li>

        <li>
          <DestinationRow
            testId="composer-destination-story"
            destination="story"
            hint={retiredHint('story') ?? 'Visible for 24 hours'}
            on={on('story')}
            disabled={rowDisabled('story')}
            onClick={() => onToggleDestination('story')}
          />
          {/* JOINED to the row it governs — no gap, no separate card — so its
              scope is unambiguous. Rendered only while Story is on, because an
              audience for a destination nobody selected is a control with no
              subject. */}
          {on('story') ? (
            <button
              type="button"
              data-testid="composer-story-audience"
              onClick={onOpenAudience}
              className="w-full flex items-center gap-3 min-h-[44px] px-4 -mt-2 pt-3 rounded-b-2xl border border-t-0 border-accent text-left touch-manipulation"
            >
              <span className="flex-1 text-[13px]">Story audience</span>
              <span data-testid="composer-story-audience-value" className="text-accent text-[13px]">
                {audienceLabel(storyAudience, storyRecipientCount)}
              </span>
              <span aria-hidden="true" className="text-accent">
                ›
              </span>
            </button>
          ) : null}
        </li>

        <li>
          <DestinationRow
            testId="composer-destination-night_out"
            destination="night_out"
            hint={
              retiredHint('night_out')
              ?? (nightOut === null
                ? 'No night out tonight'
                : `${nightOut.label} · 24 hours from the start`)
            }
            on={on('night_out')}
            // With no night out there is nothing to save to, so the row cannot
            // be turned ON — but one already on can always be turned OFF.
            disabled={rowDisabled('night_out', nightOut === null)}
            onClick={() => onToggleDestination('night_out')}
          />
        </li>

        <li>
          <DestinationRow
            testId="composer-destination-group"
            destination="group"
            hint={retiredHint('group') ?? groupSummary(groups, selectedGroupIds)}
            on={on('group')}
            disabled={rowDisabled('group')}
            onClick={() => onToggleDestination('group')}
          />
          {/* EXPANDS IN PLACE. The dropdown is joined to its row, and the
              summary above stays on the row whether this is open or closed. */}
          {on('group') ? (
            <div
              data-testid="composer-group-dropdown"
              className="-mt-2 pt-3 rounded-b-2xl border border-t-0 border-accent px-4 pb-3"
            >
              <button
                type="button"
                data-testid="composer-group-toggle"
                aria-expanded={groupsOpen}
                onClick={onToggleGroupsOpen}
                className="w-full flex items-center gap-3 min-h-[44px] text-left touch-manipulation"
              >
                <span className="flex-1 text-[13px]">
                  {groupsOpen ? 'Hide groups' : 'Choose groups'}
                </span>
                <span aria-hidden="true" className="text-accent">
                  {groupsOpen ? '⌄' : '›'}
                </span>
              </button>
              {groupsOpen ? (
                groups.length === 0 ? (
                  <p data-testid="composer-group-empty" className="text-sm leading-relaxed">
                    You have no groups yet. Nothing is created here.
                  </p>
                ) : (
                  <ul>
                    {groups.map((group) => {
                      const picked = selectedGroupIds.includes(group.id);
                      return (
                        <li key={group.id}>
                          <button
                            type="button"
                            data-testid="composer-group-option"
                            data-group={group.id}
                            aria-pressed={picked}
                            onClick={() => onToggleGroup(group.id)}
                            className="w-full flex items-center gap-3 min-h-[44px] border-b border-border text-left touch-manipulation"
                          >
                            <span className="min-w-0 flex-1 text-[13px] truncate">
                              {group.name}
                            </span>
                            <span
                              className={`text-[11px] uppercase tracking-widest ${picked ? 'text-accent' : 'text-muted'}`}
                            >
                              {picked ? 'On' : 'Off'}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : null}
            </div>
          ) : null}
        </li>
      </ul>

      <div className="mt-auto pb-[calc(env(safe-area-inset-bottom)+20px)] pt-6 space-y-3">
        {/* THE GATE. Directly above the only publishing button, never two
            levels back in Account. */}
        <ul
          data-testid="composer-summary"
          aria-label="What happens when you share"
          className="rounded-2xl border border-border bg-surface px-4 py-3 space-y-1"
        >
          {lines.map((line) => (
            <li key={line} data-testid="composer-summary-line" className="text-[12px] text-muted leading-relaxed">
              {line}
            </li>
          ))}
        </ul>

        {failure !== null ? (
          <p
            data-testid="composer-destinations-failed"
            role="alert"
            className="text-sm leading-relaxed text-center rounded-2xl border border-accent px-4 py-3"
          >
            {failure}
          </p>
        ) : null}

        <button
          type="button"
          data-testid="composer-share"
          onClick={onPublish}
          disabled={!ready}
          aria-disabled={!ready}
          className="w-full min-h-[52px] rounded-2xl bg-accent text-bg font-display text-sm uppercase tracking-widest touch-manipulation disabled:opacity-40 hover:bg-accentDim transition-colors"
        >
          {/* An unavailable CTA says WHY. A disabled button with a label that
              still promises "Share to Group" is the same silence the
              requirement's fail-closed clause exists to prevent. */}
          {busy
            ? 'Sharing…'
            : undeliverable.length > 0
              ? undeliverableLabel(undeliverable)
              : ctaLabel(destinations)}
        </button>
      </div>
    </div>
  );
}

function DestinationRow({
  testId,
  destination,
  hint,
  on,
  disabled = false,
  onClick,
}: {
  testId: string;
  destination: DestinationKey;
  hint: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      data-destination={destination}
      aria-pressed={on}
      disabled={disabled}
      aria-disabled={disabled}
      onClick={onClick}
      className={`w-full flex items-center gap-3 min-h-[56px] px-4 rounded-2xl border text-left touch-manipulation disabled:opacity-40 ${on ? 'border-accent' : 'border-border'} bg-surface`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{DESTINATION_LABELS[destination]}</span>
        <span className="block text-[11px] text-muted truncate">{hint}</span>
      </span>
      {/* Labelled, not colour-only. */}
      <span
        data-testid={`${testId}-indicator`}
        className={`text-[11px] uppercase tracking-widest ${on ? 'text-accent' : 'text-muted'}`}
      >
        {on ? 'On' : 'Off'}
      </span>
    </button>
  );
}

/** Why the CTA is unavailable, named on the button itself. */
function undeliverableLabel(missing: readonly DestinationKey[]): string {
  if (missing.includes('group') && missing.includes('night_out')) {
    return 'Choose a group, and turn Night Out off';
  }
  return missing[0] === 'group' ? 'Choose a group to share to' : 'Turn Night Out off to share';
}

function audienceLabel(
  choice: StoryAudienceChoice,
  count: number | null,
): string {
  if (choice === 'friends') return 'Friends';
  const people = `${count ?? 0} ${count === 1 ? 'person' : 'people'}`;
  return choice === 'group' ? `Group · ${people}` : `Custom · ${people}`;
}

/** Restated ON THE ROW, open or closed (V8-R-CMP-007). */
function groupSummary(
  groups: readonly ComposerGroup[],
  selected: readonly string[],
): string {
  const names = groups
    .filter((group) => selected.includes(group.id))
    .map((group) => group.name);
  if (names.length === 0) return 'Straight into a group thread';
  if (names.length <= 2) return names.join(', ');
  return `${names[0]} + ${names.length - 1} more`;
}
