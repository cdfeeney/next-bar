'use client';

/**
 * S-07 split (pure move): "Where should we go?" — the deadline sentence, the
 * ranked shortlist with vote / overflow, Lock the plan, and the suggest form.
 * State and the refresh wrapper stay on the page; this renders what it is given.
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
  board: NightOutBoardEntry[];
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
}): JSX.Element {
  return (
    <>
      {!isCancelled ? (
        <section className="mt-8">
          <h2 className="font-semibold">Where should we go?</h2>
          {/* V8-R-NO-005. "Participants see it and cannot change it" — so it is
              stated on the plan, on both sides of the deadline.

              AND IN REMAINING MINUTES, NOT ONLY AS A CLOCK TIME (round-10 round
              8, Codex). NO-005's accessibility line is "expressed in time and
              remaining minutes in words, never by colour alone", and the owner's
              own form has said both since it was written — but this page, the
              only surface a participant ever sees, stated the absolute New York
              time alone. "Voting closes Friday at 11:00 PM" leaves the reader to
              do the arithmetic against a zone that may not be theirs, which is
              the half the rule exists to remove. Same sentence, one shared
              `remainingLabel`.

              Only while voting is OPEN: once it has closed there is nothing
              remaining to state, and "in about 0 minutes" would be a countdown
              to an event that has already happened.

              IT HAS ITS OWN CLOCK (round-10 round 9, Codex). Round 8 tied this
              to `deadlineTick`, which only fires inside the ten-minute approach
              window, and claimed the coarse wording made the long wait outside
              it harmless. It does not: a page opened six hours early still said
              "in about 6 hours" four hours later. Coarse is not the same as
              stale, and this is the one sentence on the surface whose whole job
              is to say how long is left. `wordsTick` re-renders it every minute
              and costs no round trip — the server is asked on the boundary
              schedule, exactly as before; only the arithmetic is redone. */}
          {voting?.votingClosesAt != null ? (
            <p className="mt-1 text-xs opacity-60" data-testid="night-out-deadline">
              {voting.votingOpen
                ? `Voting closes ${deadlineLabel(voting.votingClosesAt)} — ${remainingLabel(voting.votingClosesAt, wordsNow)}.`
                : `Voting closed ${deadlineLabel(voting.votingClosesAt)}.`}
            </p>
          ) : null}
          <ul className="mt-2 space-y-2" data-testid="night-out-board">
            {rankedBoard.map((entry) => (
              <li
                key={entry.barId}
                className="flex items-center justify-between rounded-lg border px-3 py-2"
              >
                <div>
                  <p>{barLabel(entry.barId)}</p>
                  <p className="text-xs opacity-50">
                    suggested by {entry.suggestedByHandle ?? 'someone'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm opacity-70">
                    {entry.votes} {entry.votes === 1 ? 'vote' : 'votes'}
                  </span>
                  {entry.callerVoted ? (
                    <span className="text-sm opacity-50">voted</span>
                  ) : canParticipate ? (
                    <button
                      type="button"
                      onClick={withRefresh(() => {
                        const supabase = getBrowserSupabase();
                        return supabase
                          ? voteNightOutBar(supabase, plan.id, entry.barId)
                          : Promise.resolve(false);
                      })}
                      className="rounded-full border px-3 py-1 text-sm"
                    >
                      Vote
                    </button>
                  ) : null}
                  {/* V8-R-SOC-008. "The overflow renders only on a row the
                      viewer may act on — their own suggestion as a participant,
                      every row as the owner", and the same predicate the RPC
                      enforces decides it. A menu on a row whose removal the
                      server would refuse is a control that only produces an
                      error. */}
                  {/* `canParticipate`, not `isPlanOpen` (round-5 panel,
                      Codex): `remove_night_out_suggestion` asks
                      `night_out_voting_open`, so past the deadline the menu
                      offered an action the server necessarily refuses — the
                      exact drift this page's own rule forbids. */}
                  {canParticipate &&
                  (isOwner ||
                    (myHandle !== null &&
                      entry.suggestedByHandle === myHandle)) ? (
                    <ShortlistOverflow
                      barName={barLabel(entry.barId)}
                      open={overflowBarId === entry.barId}
                      onToggle={() =>
                        setOverflowBarId((current) =>
                          current === entry.barId ? null : entry.barId,
                        )
                      }
                      onRemove={() => {
                        setOverflowBarId(null);
                        void withRefresh(() => {
                          const supabase = getBrowserSupabase();
                          return supabase
                            ? removeNightOutSuggestion(
                                supabase,
                                plan.id,
                                entry.barId,
                              )
                            : Promise.resolve(false);
                        })();
                      }}
                    />
                  ) : null}
                </div>
              </li>
            ))}
            {board.length === 0 ? (
              <li className="text-sm opacity-60">No suggestions yet.</li>
            ) : null}
          </ul>

          {/* V8-R-SOC-007. ONE action with a fixed object, not a Pick-this on
              every row (round-3 panel, Codex, HIGH). "Closes voting
              immediately, takes the top bar, and tells everyone" — and the top
              bar is chosen by `lock_night_out` inside the same serialized
              section that takes it, so a vote landing mid-tap cannot leave the
              plan locked to a bar that was not the leader. "The primary action
              on the open plan", available whether or not a deadline is set. */}
          {isOwner && isPlanOpen ? (
            <button
              type="button"
              disabled={board.length === 0}
              onClick={withRefresh(async () => {
                const supabase = getBrowserSupabase();
                if (!supabase) return false;
                return (await lockNightOut(supabase, plan.id)) !== null;
              })}
              data-testid="night-out-lock"
              className="mt-4 inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center rounded-full bg-white px-6 font-semibold text-black disabled:opacity-60"
            >
              Lock the plan
            </button>
          ) : null}
          {isOwner && isPlanOpen && board.length === 0 ? (
            <p className="mt-2 text-sm opacity-60">
              Nothing to lock yet — the shortlist is empty.
            </p>
          ) : null}
          {!canParticipate ? (
            <p className="mt-3 text-sm opacity-60" data-testid="night-out-voting-closed">
              {!isPlanOpen
                ? 'The plan is settled — suggestions are closed.'
                : !votingOpen
                  ? // V8-R-NO-005's read-only state, said in words rather than
                    // left as controls that quietly stopped working.
                    'Voting has closed for this plan.'
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
              placeholder="Suggest a bar (id)"
              aria-label="Suggest a bar"
              className="flex-1 rounded-lg border bg-transparent px-3 py-2"
            />
            <button type="submit" className="rounded-lg border px-4 py-2">
              Suggest
            </button>
          </form>
          )}
        </section>
      ) : null}
    </>
  );
}
