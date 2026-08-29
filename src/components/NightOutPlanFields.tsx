'use client';

import { useCallback, useRef, useState } from 'react';
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

export type PlanEditOutcome = {
  /** The edits the server declined, named for the owner. */
  refused: readonly string[];
  /**
   * The plan's own night, when it is NOT the night these rows were showing.
   *
   * The rows derive their default from the clock at render time and
   * `create_night_out` reads it again at submit, so a 4:00 AM rollover landing
   * between the last render and the tap creates a plan for the NEXT night while
   * the form still says tonight (round-10 round 3, Codex). Nothing is written
   * wrongly — an untouched row writes nothing and the server's own default is
   * 9:00 PM on the plan's own night, which is right for the plan — but the
   * owner was shown a different date, and no write can reconcile that, because
   * `set_night_out_start` bounds the start to the plan's night. So it is
   * reported instead of quietly differing.
   */
  nightMoved: string | null;
};

export type NightOutPlanFields = {
  /** The rows, ready to render above the CTA. */
  fields: JSX.Element;
  /**
   * Apply the three edits to a plan that now exists, and RETURN the ones the
   * server declined. Never throws and never reports a failure as a success.
   *
   * IT RETURNS THEM RATHER THAN PAINTING THEM (round-10 panel, both lanes).
   * Two defects came from this hook owning the refusal message. It rendered
   * inside the creation form, which `router.push` unmounts a round trip later,
   * so the one thing the owner needed to read was the one thing they could not;
   * and `setRefused` fired with no identity check, so a cross-tab account switch
   * mid-apply painted "we couldn't save the area" about account A's plan into
   * account B's view, where nothing could clear it. Both are the caller's
   * business: it owns the epoch guard and it decides whether to navigate.
   */
  apply: (
    supabase: SupabaseClient,
    planId: string,
    /** The night `create_night_out` actually used, read once at submit. */
    planNight: string,
    /**
     * Whether the plan being created HAS invitees, from the caller's own
     * tap-time list — not from this hook's live prop.
     *
     * The two disagreed (round-10 round 6, Codex): the rows read `hasInvitees`
     * live while the invite loop used the selection captured at the tap, so
     * deselecting the last friend mid-create skipped the voting deadline while
     * still inviting them. One decision, one source: the guest list the plan
     * actually got.
     */
    planHasInvitees: boolean,
    /**
     * Aborts the REMAINING writes. Checked before each one, so a caller that
     * has stopped waiting also stops the work — see the budget in
     * `StartNightOutButton`. Without it, telling the owner an edit did not save
     * and then saving it a minute later is a report that was simply untrue.
     */
    signal?: AbortSignal,
  ) => Promise<PlanEditOutcome>;
};

/** 'YYYY-MM-DDTHH:mm' — what `<input type="datetime-local">` reads and writes. */
function defaultStartValue(): string {
  return `${nycNightKey()}T${DEFAULT_START_TIME}`;
}

const NYC_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** New York's UTC offset in milliseconds at the instant `at`. DST-aware. */
function nycOffsetMs(at: number): number {
  const parts = NYC_PARTS.formatToParts(new Date(at));
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asIfUtc - at;
}

/**
 * A datetime-local value as an ISO instant, READ IN AMERICA/NEW_YORK — or null
 * when it is not a time.
 *
 * NOT `new Date(value)` (round-10 round 2, Codex). That reads the naive string
 * in the DEVICE's zone, and every other clock in this feature is New York's:
 * the default this field is seeded with is NYC 9:00 PM, `nycNightKey` decides
 * which night the instant lands in, and the plan page formats it back in
 * America/New_York. On a device outside New York the owner therefore typed one
 * time and the plan showed another — off by the zone difference, and capable of
 * crossing the night boundary on its own.
 *
 * Offset-correct rather than offset-assumed: guess with the offset at the naive
 * instant, then re-measure at the guess. The second pass is what makes the two
 * DST edges right, where the offset before and after the guess differ.
 */
function isoOf(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (m === null) return null;
  const naive = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  );
  if (Number.isNaN(naive)) return null;
  const firstGuess = naive - nycOffsetMs(naive);
  const at = new Date(naive - nycOffsetMs(firstGuess));
  if (Number.isNaN(at.getTime())) return null;
  /**
   * THE ROUND TRIP IS THE VALIDATION (round-10 round 3, Codex).
   *
   * On the spring-forward night New York has no 2:30 AM — the clock goes
   * straight from 1:59 to 3:00 — and the conversion above resolves such an
   * input to 1:30 AM instead. That is the standard normalisation of a time no
   * wall clock has, but doing it SILENTLY is the defect: the owner picked one
   * time and the plan saved another an hour earlier with nothing said.
   *
   * So the instant is formatted back to New York and compared with what was
   * typed. They differ only when the input does not exist, which is exactly the
   * case the caller has to narrate. The fall-back hour, where a wall time
   * happens TWICE, round-trips successfully to the first occurrence — that is a
   * real instant and needs no warning, and picking the earlier one is the
   * conventional resolution.
   */
  return nycOffsetMs(at.getTime()) === naive - at.getTime() ? at.toISOString() : null;
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
  identity = null,
}: {
  disabled?: boolean;
  /**
   * The account these drafts belong to. A change RESETS every row.
   *
   * `useAuth` updates in place on a cross-tab sign-out and sign-in, with no
   * unmount, so without this the rows kept account A's When, Area and deadline
   * and `apply` wrote A's values onto B's plan (round-10 round 2, Codex).
   */
  identity?: string | null;
  /**
   * NO-005: "the row appears once at least one person or group is selected."
   * A solo plan has nobody to vote, so a deadline for that vote is not a state
   * the requirement has.
   */
  hasInvitees?: boolean;
} = {}): NightOutPlanFields {
  /**
   * THE DEFAULT IS DERIVED, NOT FROZEN AT MOUNT (round-10 panel, Codex HIGH).
   *
   * `useState(defaultStartValue)` captured the night key once. A form left open
   * across the 4:00 AM rollover then displayed YESTERDAY at 9:00 PM while
   * `createNightOut` used today's key, so the plan was created for a night the
   * form never showed — and `apply` skipped the write as "unchanged", so
   * nothing corrected it. Recomputing per render makes the row follow the clock,
   * and keying "unchanged" on `startEdit === null` rather than on a string
   * comparison means an untouched row can never write a stale instant: it writes
   * nothing at all and lets the server's own default — the plan's own night at
   * 9:00 PM — stand. Same `edit ?? derived` shape the Area row already uses.
   */
  const [startEdit, setStartEdit] = useState<string | null>(null);
  const start = startEdit ?? defaultStartValue();
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

  // Reset DURING render on an identity change, not in an effect: an effect
  // would let one commit render B's screen holding A's drafts, and `apply`
  // reads these values, not the DOM. This is React's documented shape for
  // "adjust state when a prop changes" and it re-renders before paint.
  const [draftOwner, setDraftOwner] = useState<string | null>(identity);
  if (identity !== draftOwner) {
    setDraftOwner(identity);
    setStartEdit(null);
    setAreaEdit(null);
    setDeadlineMode('none');
    setDeadline('');
  }

  /**
   * The night this device believes it is, checked BEFORE the write rather than
   * after a refusal: `set_night_out_start` bounds the start to the plan's own
   * night, so a time typed into a different day is declined server-side with
   * nothing on screen explaining why. Said here, in the row it belongs to.
   */
  const startIso = isoOf(start);
  const startOffNight =
    startIso !== null && nycNightKey(new Date(startIso)) !== nycNightKey();
  /**
   * Edited to something that is not a time — in practice, cleared.
   *
   * It silently fell through to the server's 9:00 PM default while the field
   * showed nothing, so the owner submitted a blank and got a time (round-10
   * round 2, Codex). The default is still what happens, because a Night Out
   * must have a start; the row now says so before the tap instead of after.
   */
  const startMissing =
    startEdit !== null && startEdit.trim() === '' && startIso === null;
  /**
   * A time New York's clocks skip. Kept apart from the cleared case because the
   * two need different sentences: one is "you left it blank", the other is "the
   * time you picked does not happen". Both land on the 9:00 PM default, and
   * saying which is which is the whole point of narrating them at all.
   */
  const startImpossible =
    startEdit !== null && startEdit.trim() !== '' && startIso === null;

  const deadlineIso = deadlineMode === 'time' ? isoOf(deadline) : null;
  /**
   * "Pick a time" chosen and no time picked. Said in the ROW, before the tap.
   *
   * This used to be reported afterwards as a refused edit, which was false
   * twice over: no RPC was ever called, so nothing refused it, and the notice
   * arrived on a screen the owner was already leaving (round-10 panel, Claude).
   * An empty field is simply not a deadline, so voting stays open — which the
   * row now says while it can still be acted on.
   */
  const deadlineMissing = deadlineMode === 'time' && deadlineIso === null;

  /**
   * The rows as they stand RIGHT NOW, readable from inside a running `apply`.
   *
   * `applyRef` in the caller fixed the outer half of this — `handleStart` no
   * longer calls the callback its closure captured at the tap — but the
   * callback it does call still froze every field for its whole sequence of
   * awaited writes (round-10 round 5, Codex). So a presence resolve landing
   * while `set_night_out_start` was in flight put the inherited Area on screen
   * and still skipped writing it. Each write reads this instead, so what is
   * sent is what the form shows when the write goes out.
   */
  const live = useRef({ startEdit, start, startIso, startOffNight, area, deadlineIso });
  live.current = { startEdit, start, startIso, startOffNight, area, deadlineIso };

  const apply = useCallback(
    async (
      supabase: SupabaseClient,
      planId: string,
      planNight: string,
      planHasInvitees: boolean,
      signal?: AbortSignal,
    ): Promise<PlanEditOutcome> => {
      const failed: string[] = [];
      /**
       * Checked before EVERY write, not once at the top.
       *
       * The caller's budget stopped waiting but not working (round-10 round 4,
       * Codex): the first RPC ran long, the owner was told the planning details
       * had not saved, and then the remaining writes went out anyway and changed
       * the plan behind them. An edit we have already reported as not landed
       * must not land. What has ALREADY gone to the server is beyond recall —
       * that is the honest limit of a client-side abort, and it is why the
       * report says these edits may not have saved rather than that they failed.
       */
      const stopped = (): boolean => signal?.aborted === true;
      // The night these rows were SHOWING, against the night the plan is for.
      // Only an untouched row can differ silently: an edited one that lands on
      // another night is already narrated by `startOffNight` and not sent.
      const nightMoved =
        live.current.startEdit === null && live.current.start.slice(0, 10) !== planNight
          ? planNight
          : null;
      // UNCHANGED IS NOT UNSET. An untouched row is already the server's own
      // default, so there is nothing to write and no way for that write to
      // fail; an edited one is written, and an off-night one is not attempted.
      const whenNow = live.current;
      if (whenNow.startEdit !== null && whenNow.startIso !== null && !whenNow.startOffNight) {
        if (stopped()) failed.push('the time');
        else if (!(await setNightOutStart(supabase, planId, whenNow.startIso))) {
          failed.push('the time');
        }
      }
      const trimmedArea = live.current.area.trim();
      if (trimmedArea !== '') {
        if (stopped()) failed.push('the area');
        else if (!(await setNightOutArea(supabase, planId, trimmedArea))) failed.push('the area');
      }
      // 'none' IS THE DEFAULT AND NEEDS NO WRITE — `voting_closes_at` starts
      // null, which is what "No deadline" means. A blank field is the same
      // thing and is narrated by `deadlineMissing` above, not reported here:
      // an edit that never reached the server was never refused by it.
      const closesAt = live.current.deadlineIso;
      if (planHasInvitees && closesAt !== null) {
        if (stopped()) failed.push('the voting deadline');
        else if (!(await setNightOutVotingDeadline(supabase, planId, closesAt))) {
          failed.push('the voting deadline');
        }
      }
      return { refused: failed, nightMoved };
    },
    // Every field is read through `live` and the guest list now arrives as an
    // argument, so this callback has NO dependencies at all: it is stable for
    // the life of the component and the caller's ref to it cannot go stale.
    [],
  );

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
          onChange={(e) => setStartEdit(e.target.value)}
        />
        {startOffNight ? (
          <p className="mt-1 text-sm text-red-400" data-testid="when-off-night">
            That&apos;s a different night — pick a time on tonight, or leave it
            at 9:00 PM.
          </p>
        ) : null}
        {startMissing ? (
          <p className="mt-1 text-sm text-red-400" data-testid="when-missing">
            Pick a time, or your night out starts at 9:00 PM.
          </p>
        ) : null}
        {startImpossible ? (
          <p className="mt-1 text-sm text-red-400" data-testid="when-impossible">
            New York&apos;s clocks skip that time — pick another, or your night
            out starts at 9:00 PM.
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
              {deadlineMissing ? (
                <p className="mt-1 text-sm text-red-400" data-testid="deadline-missing">
                  Pick a time, or voting stays open.
                </p>
              ) : null}
            </>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );

  return { fields, apply };
}
