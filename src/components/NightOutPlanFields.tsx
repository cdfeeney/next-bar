'use client';

import { useCallback, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBarById } from '@/lib/catalog';
import { nycNightKey } from '@/lib/nightKey';
import { useMyPresence } from '@/app/friends/_components/usePinnedHandles';
import {
  setNightOutArea,
  setNightOutStart,
  setNightOutVotingDeadline,
} from '@/lib/nightOutPlan';

/**
 * The three editable rows of the Start a Night Out form — When, Area and
 * Voting closes (V8-R-NO-002, V8-R-NO-003, V8-R-NO-005).
 *
 * WHY THIS EXISTS AT ALL (round-9 panel). Migration 0068 grew the columns and
 * the three owner writers in round 4, and nothing in `src` ever called them:
 * the form the ledger names as their entry point had no rows, so all three
 * approved requirements were unreachable. The CTA under them creates the plan;
 * these rows are applied to it the moment it exists.
 *
 * A ROW NEVER BLOCKS THE CTA. Both NO-002 and NO-003 say so in as many words,
 * and it is also the safe direction: every value here has a server-side
 * default, so a row left alone, mistyped or refused still leaves a real plan
 * with a real start time. What must never happen is a refusal that says
 * nothing — the owner would go on believing they had set a time the plan does
 * not have — so `apply` reports exactly which edits did not land.
 *
 * THE DEFAULTS ARE VISIBLE, not hidden behind a tap (NO-002's accessibility
 * clause): 9:00 PM is in the field, not in a placeholder.
 *
 * A separate file, not more of `StartNightOutButton`, which is already at the
 * repository's 800-line ceiling.
 */

/** NO-002: "Tonight, 9:00 PM" — the plan's own night, at nine. */
const DEFAULT_START_TIME = '21:00';

/** NO-003: the column's own limit, so the field cannot offer what 0068 refuses. */
const AREA_MAX_LENGTH = 60;

type DeadlineMode = 'none' | 'time';

export type NightOutPlanFields = {
  /** The rows, ready to render above the CTA. */
  fields: JSX.Element;
  /**
   * Apply the three edits to a plan that now exists. Never throws and never
   * reports a failure as a success; what did not land is shown in `fields`.
   */
  apply: (supabase: SupabaseClient, planId: string) => Promise<void>;
};

/** 'YYYY-MM-DDTHH:mm' — what `<input type="datetime-local">` reads and writes. */
function defaultStartValue(): string {
  return `${nycNightKey()}T${DEFAULT_START_TIME}`;
}

/**
 * A datetime-local value as an ISO instant, or null when it is not a time.
 *
 * `new Date('2026-08-28T21:00')` is read in the DEVICE's zone, which is what
 * the owner typed. The night it lands in is then the server's question, asked
 * below with the same `nycNightKey` the database uses.
 */
function isoOf(value: string): string | null {
  if (value === '') return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** "in about 40 minutes" / "in about 2 hours", for NO-005's words-not-colour rule. */
function remainingLabel(iso: string, now: number = Date.now()): string {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return 'immediately';
  if (minutes < 60) return `in about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `in about ${hours} hour${hours === 1 ? '' : 's'}`;
}

const ROW = 'block w-full min-h-[44px] rounded-2xl border border-border bg-surface px-4 py-2 text-text touch-manipulation';
const LABEL = 'block font-display text-xs uppercase tracking-[0.2em] text-muted mb-1';

export function useNightOutPlanFields({
  disabled = false,
  hasInvitees = false,
}: {
  disabled?: boolean;
  /**
   * NO-005: "the row appears once at least one person or group is selected."
   * A solo plan has nobody to vote, so a deadline for that vote is not a state
   * the requirement has.
   */
  hasInvitees?: boolean;
} = {}): NightOutPlanFields {
  const [start, setStart] = useState(defaultStartValue);
  const [startDefault] = useState(defaultStartValue);
  /**
   * NO-003: "reuses the area already known from Tonight." That is the
   * neighbourhood of the bar this account pinned tonight — the one area the app
   * already knows — and it is a SEED, not a lock: the field is editable and
   * clearing it is one of the requirement's own three states.
   */
  const mine = useMyPresence();
  const inherited =
    mine?.barId != null ? (getBarById(mine.barId)?.neighborhood ?? '') : '';
  const [areaEdit, setAreaEdit] = useState<string | null>(null);
  const area = areaEdit ?? inherited;
  const [deadlineMode, setDeadlineMode] = useState<DeadlineMode>('none');
  const [deadline, setDeadline] = useState('');
  const [refused, setRefused] = useState<readonly string[]>([]);

  /**
   * The night this device believes it is, checked BEFORE the write rather than
   * after a refusal: `set_night_out_start` bounds the start to the plan's own
   * night, so a time typed into a different day is declined server-side with
   * nothing on screen explaining why. Said here, in the row it belongs to.
   */
  const startIso = isoOf(start);
  const startOffNight =
    startIso !== null && nycNightKey(new Date(startIso)) !== nycNightKey();

  const apply = useCallback(
    async (supabase: SupabaseClient, planId: string): Promise<void> => {
      const failed: string[] = [];
      // UNCHANGED IS NOT UNSET. A start left at 9:00 PM is already the server's
      // own default, so there is nothing to write and no way for that write to
      // fail; an edited one is written, and an off-night one is not attempted.
      if (startIso !== null && start !== startDefault && !startOffNight) {
        if (!(await setNightOutStart(supabase, planId, startIso))) failed.push('the time');
      }
      const trimmedArea = area.trim();
      if (trimmedArea !== '') {
        if (!(await setNightOutArea(supabase, planId, trimmedArea))) failed.push('the area');
      }
      // 'none' IS THE DEFAULT AND NEEDS NO WRITE — `voting_closes_at` starts
      // null, which is what "No deadline" means.
      if (hasInvitees && deadlineMode === 'time') {
        const closesIso = isoOf(deadline);
        if (
          closesIso === null
          || !(await setNightOutVotingDeadline(supabase, planId, closesIso))
        ) {
          failed.push('the voting deadline');
        }
      }
      setRefused(failed);
    },
    [start, startDefault, startIso, startOffNight, area, deadlineMode, deadline, hasInvitees],
  );

  const deadlineIso = deadlineMode === 'time' ? isoOf(deadline) : null;

  const fields = (
    <div className="mt-4 space-y-3 text-left" data-testid="night-out-plan-fields">
      <div>
        <label className={LABEL} htmlFor="night-out-when">
          When
        </label>
        <input
          id="night-out-when"
          type="datetime-local"
          className={ROW}
          value={start}
          disabled={disabled}
          onChange={(e) => setStart(e.target.value)}
        />
        {startOffNight ? (
          <p className="mt-1 text-sm text-red-400" data-testid="when-off-night">
            That&apos;s a different night — pick a time on tonight, or leave it
            at 9:00 PM.
          </p>
        ) : null}
      </div>

      <div>
        <label className={LABEL} htmlFor="night-out-area">
          Area <span className="normal-case tracking-normal">(optional)</span>
        </label>
        <input
          id="night-out-area"
          type="text"
          className={ROW}
          value={area}
          maxLength={AREA_MAX_LENGTH}
          disabled={disabled}
          placeholder="Anywhere"
          onChange={(e) => setAreaEdit(e.target.value)}
        />
      </div>

      {hasInvitees ? (
        <fieldset>
          <legend className={LABEL}>Voting closes</legend>
          {(['none', 'time'] as const).map((mode) => (
            <label
              key={mode}
              className="flex items-center gap-3 min-h-[44px] touch-manipulation"
            >
              <input
                type="radio"
                name="night-out-deadline"
                value={mode}
                checked={deadlineMode === mode}
                disabled={disabled}
                onChange={() => setDeadlineMode(mode)}
              />
              <span>{mode === 'none' ? 'No deadline' : 'Pick a time'}</span>
            </label>
          ))}
          {deadlineMode === 'time' ? (
            <>
              <input
                aria-label="Voting closes at"
                type="datetime-local"
                className={ROW}
                value={deadline}
                disabled={disabled}
                onChange={(e) => setDeadline(e.target.value)}
              />
              {deadlineIso !== null ? (
                <p className="mt-1 text-sm text-muted" data-testid="deadline-remaining">
                  Voting closes {remainingLabel(deadlineIso)}.
                </p>
              ) : null}
            </>
          ) : null}
        </fieldset>
      ) : null}

      {refused.length > 0 ? (
        <p className="text-sm text-red-400" role="status" data-testid="plan-fields-refused">
          Your night out was created, but we couldn&apos;t save{' '}
          {refused.join(' or ')}. Open the plan and try again.
        </p>
      ) : null}
    </div>
  );

  return { fields, apply };
}
