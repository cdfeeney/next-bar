'use client';

/**
 * README §7 SHORTLIST — heading with "CLOSES 11:00 PM" / "VOTING CLOSED" in
 * accent, one row per bar (20px radius, `surface`, accent border on the leader
 * while open): a 46px vote control on the left (▲ over the count; accent
 * border/tint/text when it holds your vote), name over "LES · suggested by
 * you", and "LEADING" / "PICKED" on the leading row only. Then "Suggest another
 * bar…", and for the host "Lock in <leader>".
 *
 * VOTING IS NOT SINGLE-TRANSFER HERE, and this file does not pretend it is.
 * `vote_night_out_bar` is insert-only (one row per bar per member, on conflict
 * do nothing) and no RPC clears a vote, so "tapping a new bar moves your vote"
 * and "tapping your current one clears it" cannot be built without a
 * migration — which S-07 forbids and its body says to surface. A row that
 * holds your vote renders the held control and writes nothing; every other
 * open row casts an additional vote, exactly as before this goal.
 *
 * State and the refresh wrapper stay on the page; this renders what it is
 * given. A FAILED board read (`board === null`) is stated, never drawn as an
 * empty shortlist.
 */
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getBarById } from '@/lib/catalog';
import { remainingLabel } from '@/lib/nightOutPlan';
import { lockNightOut, removeNightOutSuggestion, type NightOutVoting } from '../planActions';
import {
  suggestNightOutBar,
  voteNightOutBar,
  type NightOut,
  type NightOutBoardEntry,
} from '@/lib/nightOuts.server';
import { ShortlistOverflow, barLabel, deadlineLabel } from './planPage';

const LABEL = 'font-label text-[11px] font-bold uppercase tracking-[0.25em]';

export default function PlanShortlist({
  plan,
  board,
  rankedBoard,
  voting,
  wordsNow,
  isCancelled,
  isOwner,
  isPlanOpen,
  votingOpen,
  isDeclined,
  canParticipate,
  myHandle,
  overflowBarId,
  setOverflowBarId,
  suggestInput,
  setSuggestInput,
  setActionError,
  withRefresh,
}: {
  plan: NightOut;
  /** Null = the board READ failed — distinct from a plan with no bars yet. */
  board: NightOutBoardEntry[] | null;
  rankedBoard: NightOutBoardEntry[];
  voting: NightOutVoting | null;
  wordsNow: number;
  isCancelled: boolean;
  isOwner: boolean;
  isPlanOpen: boolean;
  votingOpen: boolean;
  isDeclined: boolean;
  canParticipate: boolean;
  myHandle: string | null;
  overflowBarId: string | null;
  setOverflowBarId: (next: string | null | ((current: string | null) => string | null)) => void;
  suggestInput: string;
  setSuggestInput: (next: string) => void;
  setActionError: (next: string | null) => void;
  withRefresh: (action: () => Promise<boolean>, capacityRefusable?: boolean) => () => Promise<void>;
}): JSX.Element | null {
  if (isCancelled) return null;
  const decided = plan.status === 'decided';
  const leaderId = isPlanOpen && votingOpen && rankedBoard.length > 0 && rankedBoard[0].votes > 0
    ? rankedBoard[0].barId
    : null;
  const leaderName = rankedBoard.length > 0 ? barLabel(rankedBoard[0].barId) : null;

  return (
    <section className="mt-8" data-testid="plan-shortlist">
      <div className="flex items-baseline justify-between">
        <h2 className={`${LABEL} text-muted`}>Shortlist</h2>
        {/* V8-R-NO-005: the deadline is stated on the plan, on both sides of it;
            the sentence with the remaining minutes in words lives below. */}
        {decided || (voting !== null && !voting.votingOpen) ? (
          <span className={`${LABEL} text-accent`} data-testid="shortlist-state">Voting closed</span>
        ) : voting?.votingClosesAt != null ? (
          <span className={`${LABEL} text-accent`} data-testid="shortlist-state">
            Closes {deadlineLabel(voting.votingClosesAt)}
          </span>
        ) : null}
      </div>
      {voting?.votingClosesAt != null ? (
        <p className="mt-1 text-xs text-muted" data-testid="night-out-deadline">
          {voting.votingOpen
            ? `Voting closes ${deadlineLabel(voting.votingClosesAt)} — ${remainingLabel(voting.votingClosesAt, wordsNow)}.`
            : `Voting closed ${deadlineLabel(voting.votingClosesAt)}.`}
        </p>
      ) : null}

      {board === null ? (
        <p className="mt-3 text-sm text-red-400" role="status" data-testid="night-out-board-failed">
          The shortlist couldn&apos;t be loaded. Pull to refresh, or try again in a moment.
        </p>
      ) : (
        <ul className="mt-3 space-y-2" data-testid="night-out-board">
          {rankedBoard.map((entry) => {
            const bar = getBarById(entry.barId);
            const leading = leaderId === entry.barId;
            const picked = decided && plan.decidedBarId === entry.barId;
            const suggestedByYou = myHandle !== null && entry.suggestedByHandle === myHandle;
            const voteClass = [
              'flex h-[46px] w-[46px] shrink-0 flex-col items-center justify-center rounded-[14px] border text-[11px] leading-none touch-manipulation',
              entry.callerVoted ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted',
            ].join(' ');
            return (
              <li
                key={entry.barId}
                data-testid="shortlist-row"
                data-bar-id={entry.barId}
                data-leading={leading ? 'true' : undefined}
                data-picked={picked ? 'true' : undefined}
                className={[
                  'flex items-center gap-3 rounded-[20px] border bg-surface px-3 py-2.5',
                  leading || picked ? 'border-accent' : 'border-border',
                ].join(' ')}
              >
                {canParticipate && !entry.callerVoted ? (
                  <button
                    type="button"
                    aria-label={`Vote for ${barLabel(entry.barId)}`}
                    onClick={withRefresh(() => {
                      const supabase = getBrowserSupabase();
                      return supabase
                        ? voteNightOutBar(supabase, plan.id, entry.barId)
                        : Promise.resolve(false);
                    })}
                    className={voteClass}
                  >
                    <span aria-hidden="true">▲</span>
                    <span className="mt-0.5 font-display text-sm font-semibold tabular-nums">{entry.votes}</span>
                  </button>
                ) : (
                  <span
                    className={voteClass}
                    aria-label={entry.callerVoted ? `Your vote — ${entry.votes} ${entry.votes === 1 ? 'vote' : 'votes'}` : `${entry.votes} ${entry.votes === 1 ? 'vote' : 'votes'}`}
                    data-testid={entry.callerVoted ? 'shortlist-voted' : undefined}
                  >
                    <span aria-hidden="true">▲</span>
                    <span className="mt-0.5 font-display text-sm font-semibold tabular-nums">{entry.votes}</span>
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base font-semibold truncate">{barLabel(entry.barId)}</p>
                  <p className="text-[11px] uppercase tracking-wider text-muted truncate">
                    {bar?.neighborhood ? `${bar.neighborhood} · ` : ''}
                    suggested by {suggestedByYou ? 'you' : (entry.suggestedByHandle ?? 'someone')}
                    {/* The count in words, for the reader and for the e2e that keys on "N votes". */}
                    <span className="sr-only"> · {entry.votes} {entry.votes === 1 ? 'vote' : 'votes'}</span>
                  </p>
                </div>
                {picked ? (
                  <span className="font-label text-[10px] font-bold uppercase tracking-[0.25em] text-accent" data-testid="shortlist-picked">Picked</span>
                ) : leading ? (
                  <span className="font-label text-[10px] font-bold uppercase tracking-[0.25em] text-accent" data-testid="shortlist-leading">Leading</span>
                ) : null}
                {/* V8-R-SOC-008. "The overflow renders only on a row the viewer may
                    act on — their own suggestion as a participant, every row as the
                    owner", and the same predicate the RPC enforces decides it.
                    `canParticipate`, not `isPlanOpen` (round-5 panel, Codex):
                    `remove_night_out_suggestion` asks `night_out_voting_open`. */}
                {canParticipate && (isOwner || suggestedByYou) ? (
                  <ShortlistOverflow
                    barName={barLabel(entry.barId)}
                    open={overflowBarId === entry.barId}
                    onToggle={() =>
                      setOverflowBarId((current) => (current === entry.barId ? null : entry.barId))
                    }
                    onRemove={() => {
                      setOverflowBarId(null);
                      void withRefresh(() => {
                        const supabase = getBrowserSupabase();
                        return supabase
                          ? removeNightOutSuggestion(supabase, plan.id, entry.barId)
                          : Promise.resolve(false);
                      })();
                    }}
                  />
                ) : null}
              </li>
            );
          })}
          {board.length === 0 ? (
            <li className="text-sm text-muted">No suggestions yet.</li>
          ) : null}
        </ul>
      )}

      {!canParticipate ? (
        <p className="mt-3 text-sm text-muted" data-testid="night-out-voting-closed">
          {!isPlanOpen
            ? 'The plan is settled — suggestions are closed.'
            : !votingOpen
              ? 'Voting has closed for this plan.'
              : isDeclined
                ? "You're out for this one. Count yourself back in to suggest a bar."
                : "Say you're in to suggest a bar."}
        </p>
      ) : (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const barId = suggestInput.trim().toLowerCase();
            if (getBarById(barId) === undefined) {
              setActionError('Pick a bar from the catalog (its id).');
              return;
            }
            setSuggestInput('');
            void withRefresh(() => {
              const supabase = getBrowserSupabase();
              return supabase
                ? suggestNightOutBar(supabase, plan.id, barId)
                : Promise.resolve(false);
            })();
          }}
        >
          <input
            value={suggestInput}
            onChange={(event) => setSuggestInput(event.target.value)}
            placeholder="Suggest another bar…"
            aria-label="Suggest a bar"
            className="min-h-[44px] flex-1 rounded-2xl border border-border bg-surface px-4 py-2 text-text"
          />
          <button type="submit" className="min-h-[44px] rounded-full border border-border px-4 text-sm touch-manipulation">
            Suggest
          </button>
        </form>
      )}

      {/* V8-R-SOC-007. ONE action with a fixed object, not a Pick-this on every
          row (round-3 panel, Codex, HIGH). The top bar is chosen by
          `lock_night_out` inside the same serialized section that takes it. */}
      {isOwner && isPlanOpen ? (
        <>
          <button
            type="button"
            disabled={board === null || board.length === 0}
            onClick={withRefresh(async () => {
              const supabase = getBrowserSupabase();
              if (!supabase) return false;
              return (await lockNightOut(supabase, plan.id)) !== null;
            })}
            data-testid="night-out-lock"
            className="mt-5 inline-flex min-h-[52px] w-full touch-manipulation items-center justify-center rounded-full bg-accent px-6 font-display font-semibold text-bg disabled:bg-held disabled:text-muted"
          >
            {leaderName !== null ? `Lock in ${leaderName}` : 'Lock in'}
          </button>
          <p className="mt-2 text-xs text-muted">
            {board !== null && board.length === 0
              ? 'Nothing to lock yet — the shortlist is empty.'
              : voting?.votingClosesAt != null
                ? `You're the host, so you decide. Voting closes on its own ${deadlineLabel(voting.votingClosesAt)}.`
                : "You're the host, so you decide."}
          </p>
        </>
      ) : null}
    </section>
  );
}
