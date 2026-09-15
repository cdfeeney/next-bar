'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { consumePendingInvite, peekPendingInvite, storePendingInvite } from '@/lib/pendingInvite';
import { forgetStartedNightOut } from '@/components/StartNightOutButton';
import NightOutMedia from './NightOutMedia';
import InvitePreview from './InvitePreview';
import { fetchAnonRsvpCounts, fetchNightOutVoting } from './planActions';
import {
  declineNightOutByToken,
  getNightOut,
  getNightOutBoard,
  getNightOutMembers,
  isNightOutFullByToken,
  joinNightOutByToken,
  previewNightOut,
  resolveNightOutByToken,
  respondNightOut,
} from '@/lib/nightOuts.server';
import PlanHeader from './_components/PlanHeader';
import RsvpRow from './_components/RsvpRow';
import MemberBoard from './_components/MemberBoard';
import DecidedBanner from './_components/DecidedBanner';
import PlanFooter from './_components/PlanFooter';
import PlanShortlist from './_components/PlanShortlist';
import {
  DEADLINE_GRACE_MS,
  MAX_REARM_MS,
  MIN_RECHECK_MS,
  SKEW_TOLERANCE_MS,
  clampRecheck,
  isSettled,
  type MemberLoad,
  type PageState,
} from './_components/planPage';

/**
 * /night-out/[token] — the canonical Night Out plan (V8-3).
 *
 * Anonymous: the bearer-token PREVIEW only (explicitly shared plan data —
 * date, title, host identity, headcount) plus a sign-in CTA that stores the
 * invite context so the handoff survives /auth (criterion 7).
 *
 * Signed-in: joining via the link makes the caller an accepted member
 * (server-side RPC — criterion 6); the member board shows members,
 * suggestions and votes, with "Not tonight" (= declined, the PRD's locked
 * state) always available. The owner can decide a bar or cancel the plan.
 */

export default function NightOutPage({
  params,
}: {
  params: { token: string };
}): JSX.Element {
  const auth = useAuth();
  const router = useRouter();
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [suggestInput, setSuggestInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  /** Which shortlist row's overflow menu is open, if any (V8-R-SOC-008). */
  const [overflowBarId, setOverflowBarId] = useState<string | null>(null);
  // Bumped by the voting-deadline timer itself, so the next one is armed
  // whether or not the answer that came back was different.
  const [deadlineTick, setDeadlineTick] = useState(0);
  /**
   * Re-renders the remaining-minutes WORDING, and nothing else.
   *
   * Deliberately not `deadlineTick`: that one is the server's asking schedule
   * and now runs at most twice an hour outside the approach window, which left
   * the sentence saying "in about 6 hours" four hours later (round-10 round 9,
   * Codex). Recomputing a label costs a render, not a round trip, so the two
   * cadences have no reason to be the same one.
   *
   * It holds the INSTANT rather than a counter, because `remainingLabel` takes
   * a `now` and this is what that parameter is for: the label stays a function
   * of its inputs instead of a value that happens to be recomputed by an
   * unrelated re-render. Seeded at mount so the first paint is right; the
   * member view only exists after an async load, so it is never in the
   * prerendered HTML and there is no hydration mismatch to guard against.
   */
  const [wordsNow, setWordsNow] = useState(() => Date.now());
  const token = decodeURIComponent(params.token);

  /**
   * Monotonic epoch identifying WHICH VIEW is on screen — the pair (auth
   * identity, plan token). Every member load captures it and refuses to paint
   * if it has moved on.
   *
   * Cold panel (Codex): loadMemberView called setState unconditionally and never
   * saw the effect's `cancelled` flag, so an authenticated load started before a
   * sign-out could settle afterwards and put PRIVATE member data back on screen
   * for a signed-out viewer. The effect's own cancel flag could not cover it —
   * the direct callers (join, rejoin, refresh) are outside that closure.
   *
   * Fix round 1 (both lanes): the guard covered auth ONLY, which left the same
   * defect shape alive one axis over. Next's client router REUSES this component
   * across `/night-out/A` → `/night-out/B`, so a load for plan A could settle and
   * paint A's private member state under B's URL — no remount, no sign-out, and
   * the auth epoch never moves. The epoch is the whole view identity now, which
   * is why it is no longer called authEpoch: naming it for one of its two axes is
   * what made adding the second one feel out of scope.
   */
  const viewEpoch = useRef(0);
  /**
   * WHICH MEMBER LOAD IS NEWER — the epoch cannot say, and now something must.
   *
   * Round-10 round 8, Codex. `viewEpoch` separates VIEWS; two loads of the same
   * view share it, so a later one wins on screen only if it also lands later.
   * The deadline timer makes that ordinary: it issues a load as voting closes
   * while a pre-deadline one is still stalled, the new closed board paints, and
   * then the old response passes the same epoch and puts Suggest, Vote and
   * Remove back — every one of which the server now refuses. Loads are numbered
   * on issue and a response older than the newest one already painted is
   * dropped, which is also a failure to paint, so it answers false.
   */
  const memberLoadSeq = useRef(0);
  const memberPaintedSeq = useRef(0);
  /**
   * Has this view's voting state EVER been read successfully? Separates "never
   * known" from "knew, then a read failed" — states a null `voting` collapses
   * into one. Only the second is a regression worth re-asking about; see the
   * deadline effect.
   */
  const hadVoting = useRef(false);
  // Guards every withRefresh action against re-entrant taps. See withRefresh.
  const actionInFlight = useRef(false);
  /**
   * LAYOUT effect, not a passive one (round-5 panel, Codex).
   *
   * Passive effects flush in a task AFTER paint, so between React committing a
   * new (auth, token) pair and this effect running there is a window where
   * `viewEpoch.current` still holds the OLD value. A member read resolving in
   * that window compares the old epoch against itself, passes, and paints the
   * previous plan's private data into the committed new view — the exact defect
   * the epoch exists to stop, arriving through the guard rather than around it.
   *
   * `StartNightOutButton` already learned this on its own identity ref and says
   * so in its comments; the page did not get the lesson. A layout effect runs
   * synchronously inside the commit, so no external task can observe the epoch
   * stale against a committed UI. It still runs before the passive loading
   * effect below, which is the ordering that effect depends on.
   */
  useLayoutEffect(() => {
    viewEpoch.current += 1;
    // The new view's voting state has never been read, whatever we knew about
    // the previous one — so a null there is "not yet", not "we lost it".
    hadVoting.current = false;
    // Blocking a stale load from painting is only half of it (cold panel 2,
    // Codex): on a sign-out the member view ALREADY on screen stayed rendered
    // until the anonymous preview settled, so accepted-member data sat in front
    // of a signed-out viewer for as long as that request took. Drop it now and
    // let the reload decide what the new viewer may see.
    //
    // The same argument applies unchanged to a token change, which is why this
    // clears on ANY epoch bump rather than on sign-out only: while plan B loads,
    // plan A's member list — names, statuses, the whole board — would otherwise
    // sit on screen under plan B's URL. That is the identical leak as the async
    // one the epoch guard blocks, arriving synchronously instead.
    //
    // EVERY settled kind, not just 'member' (round-3 panel, Codex, HIGH). Only
    // the member view was cleared, because the reasoning above was about
    // LEAKING private data and a preview is public bearer data. That missed
    // what the stale view can still DO: plan A's preview stayed on screen and
    // stayed interactive under plan B's URL, and its Join button reads `token`
    // from the current render — so tapping the "Join" under A's title and A's
    // host accepted membership in B. A settled view whose identity has moved on
    // is not a display problem, it is a live control wired to the wrong plan.
    setState((current) => (current.kind === 'loading' ? current : { kind: 'loading' }));
    // Everything else on screen belongs to the view that is leaving, too
    // (round-5 panel, Codex). `shareNotice` is the one that bites: when the
    // clipboard write is refused the notice holds plan A's share URL as a
    // selectable fallback, and it sat there under plan B — offering one plan's
    // invite link from another plan's page. `actionError` and `suggestInput`
    // are the same argument with a smaller blast radius.
    setShareNotice(null);
    setActionError(null);
    setSuggestInput('');
    // This effect is declared BEFORE the loading effect, so on either change the
    // epoch has already moved by the time the new load captures it.
  }, [auth.status, token]);

  /**
   * `startedAt` is the epoch the CALLER was looking at, and it defaults to the
   * current one only for callers with nothing in flight ahead of them.
   *
   * Cold-panel round 2 (Codex): reading `viewEpoch.current` here was too late.
   * Every direct caller awaits a WRITE first (join, decline, an action refresh),
   * and only then calls this — so a user who taps Join on plan A and navigates
   * to plan B before the RPC answers reaches this line after the epoch has
   * already moved, captures plan B's epoch, and paints plan A's private member
   * board under plan B's URL. The guard compared the load against itself.
   *
   * The view identity has to be captured before the FIRST await of the whole
   * sequence, not before the last one.
   */
  const loadMemberView = useCallback(
    async (planId: string, startedAt?: number): Promise<MemberLoad> => {
      const supabase = getBrowserSupabase();
      if (!supabase) return 'failed';
      const epoch = startedAt ?? viewEpoch.current;
      if (epoch !== viewEpoch.current) return 'superseded';
      memberLoadSeq.current += 1;
      const seq = memberLoadSeq.current;
      const [plan, members, board, voting, anonRsvps] = await Promise.all([
        getNightOut(supabase, planId),
        getNightOutMembers(supabase, planId),
        getNightOutBoard(supabase, planId),
        // 0044's get_night_out predates the deadline column and belongs to
        // another lane, so these two ride alongside it rather than through it.
        fetchNightOutVoting(supabase, planId),
        fetchAnonRsvpCounts(supabase, planId),
      ]);
      // The ONLY genuine failure: the plan itself could not be read.
      if (plan === null) return 'failed';
      // The view moved while we were away: this answer belongs to a session, or
      // a plan, that is no longer the one on screen.
      if (epoch !== viewEpoch.current) return 'superseded';
      // ...and a newer load of the SAME view has already painted. See
      // `memberLoadSeq`.
      if (seq <= memberPaintedSeq.current) return 'superseded';
      memberPaintedSeq.current = seq;
      if (voting !== null) hadVoting.current = true;
      setState({
        kind: 'member',
        plan,
        members: members ?? [],
        board,
        voting,
        anonRsvps,
      });
      return 'painted';
    },
    [],
  );

  // The destination performs the single consume of the handoff context
  // (PendingInviteRedirect only peeks — an interrupted navigation must not
  // lose the token). Only our own token is consumed.
  //
  // SETTLED, not mounted and not "member": see isSettled() above for why this
  // exact predicate is the root. While the page is still 'loading' the trip is
  // not over — OnboardingGate can still redirect — so the token must survive.
  // Once ANY terminal state renders, the handoff has done its job and the token
  // must be spent, or PendingInviteRedirect replays it on every later
  // navigation for the rest of the session.
  useEffect(() => {
    if (!isSettled(state.kind)) return;
    if (peekPendingInvite() === token) consumePendingInvite();
    // THIS is what "opened" means (round-9 panel, Codex). StartNightOutButton
    // used to clear its parked record and then call `router.push`, which is
    // fire-and-forget — a navigation that failed or was superseded before the
    // route committed dropped the record anyway, and a later remount armed
    // Start into a duplicate plan. The record is spent where the plan actually
    // renders, for the member who owns it, and nowhere else.
    // ...and only for THIS plan (round-10 panel, Codex): clearing whatever the
    // user had parked meant opening any plan they belong to spent plan A's
    // record, re-arming Start into a duplicate.
    if (state.kind === 'member' && auth.status === 'signed-in') {
      forgetStartedNightOut(auth.user.id, state.plan.id);
    }
  }, [state, token, auth]);

  useEffect(() => {
    if (auth.status === 'loading') return;
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setState({ kind: 'gone' });
      return;
    }
    let cancelled = false;
    // The epoch this effect belongs to, captured before its first await, exactly
    // as `loadMemberView` documents its contract (round-6 panel, Claude).
    //
    // `cancelled` alone does NOT cover this, and the layout effect above made
    // that worse rather than better: the epoch bump now happens synchronously
    // inside the commit, while THIS effect's cleanup runs in the later passive
    // flush. In the window between them the epoch has already moved and
    // `cancelled` is still false, so a resolve settling there passed both
    // guards and painted the previous view's private board under the new token.
    // Every other caller got this fix; the one that runs on every navigation
    // did not.
    const startedAt = viewEpoch.current;
    void (async () => {
      if (auth.status === 'signed-in') {
        // Viewing never mutates (review round 1, both lanes): an existing
        // member — pending, accepted, or declined — RESOLVES straight to
        // their plan view. Joining is always the explicit button below.
        const planId = await resolveNightOutByToken(supabase, token);
        if (cancelled || startedAt !== viewEpoch.current) return;
        // Anything but a genuine read failure ends this effect. A `superseded`
        // load must NOT fall through to the bearer preview below (round-10
        // round 9): the seq axis does not move the epoch, so the guard on the
        // next line would not have caught it, and the preview would have
        // painted over a member board that had just loaded correctly.
        if (planId !== null && (await loadMemberView(planId, startedAt)) !== 'failed') return;
        if (cancelled || startedAt !== viewEpoch.current) return;
      }
      // Signed-out, non-member, or the link is dead/cancelled: bearer
      // preview only.
      const preview = await previewNightOut(supabase, token);
      if (cancelled || startedAt !== viewEpoch.current) return;
      setState(preview !== null ? { kind: 'preview', preview } : { kind: 'gone' });
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status, token, loadMemberView]);

  /**
   * THE DEADLINE ARRIVES WITHOUT A RELOAD (round-6 panel, Codex, MEDIUM).
   *
   * `voting.votingOpen` is a snapshot taken when the member view loaded, and
   * nothing re-read it as `votingClosesAt` passed — so a plan left open across
   * its deadline went on rendering Vote, Suggest and Remove for a server that
   * had already made it read-only, and the first tap was necessarily refused
   * before the action's own refresh finally corrected the page. V8-R-NO-005's
   * closed state is a state the surface has to be able to REACH on its own.
   *
   * The device clock chooses only WHEN to re-ask; `night_out_voting_open` on
   * the server is still the one that answers. A deadline that lands while the
   * tab is asleep is caught by the timer firing late, which is exactly when we
   * want it.
   *
   * A DEADLINE ALREADY BEHIND THIS DEVICE STILL ARMS (round-7 panel, Codex).
   * Round 7 returned without a timer when `at <= Date.now()`, which drops the
   * commonest case of all: the read starts before the deadline, the server
   * answers `votingOpen: true`, and the response reaches React after the
   * instant has passed — no skewed clock required, just latency. Vote, Suggest
   * and Remove then stayed live indefinitely for a plan the server had made
   * read-only. So it arms regardless, with `MIN_RECHECK_MS` as the floor FOR
   * THAT CASE: while this device and the server disagree it costs one read a
   * minute, and that ends the moment the server says closed, because a closed
   * vote arms nothing.
   *
   * A DEADLINE STILL AHEAD IS WAITED FOR EXACTLY (round-9 panel). The floor was
   * applied to every delay, so a deadline five seconds away was re-read after
   * sixty: Suggest, Vote and Remove stayed editable for most of a minute past
   * an expiry the server was already enforcing, and the first tap in that
   * window was refused instead of the page having gone read-only. See
   * `clampRecheck` above — this file and NightOutMedia each carry the rule,
   * and the panel filed the same defect against both copies.
   */
  /**
   * Keep the remaining-minutes wording honest while the page sits open. Armed
   * only while there is an open deadline to describe, so a plan without one —
   * or one whose vote has closed — runs no interval at all.
   */
  useEffect(() => {
    if (state.kind !== 'member') return;
    const voting = state.voting;
    if (voting === null || !voting.votingOpen || voting.votingClosesAt == null) return;
    const id = setInterval(() => setWordsNow(Date.now()), MIN_RECHECK_MS);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (state.kind !== 'member') return;
    const voting = state.voting;
    if (voting === null) {
      // A DEADLINE WE COULD NOT READ IS NOT A PLAN WITHOUT ONE (round-10 round
      // 9, Codex). `fetchNightOutVoting` rides alongside `get_night_out` rather
      // than through it, so it can fail on its own: the plan paints, `voting`
      // becomes null, this effect returned, and `votingOpen` fell back to the
      // plan's status. One transport blip on a refresh therefore left Vote,
      // Suggest and Remove editable past a deadline the server was already
      // enforcing, permanently — the exact state the whole timer exists to
      // prevent, reached by the one path that disarmed it.
      //
      // No instant to wait for, so it asks again on the floor until an answer
      // arrives; an answer that carries a deadline arms it properly below, and
      // one that says voting is closed arms nothing, as before.
      if (!hadVoting.current) return;
      const planId = state.plan.id;
      const startedAt = viewEpoch.current;
      const timer = setTimeout(() => {
        setDeadlineTick((n) => n + 1);
        void loadMemberView(planId, startedAt);
      }, MIN_RECHECK_MS);
      return () => clearTimeout(timer);
    }
    if (!voting.votingOpen || voting.votingClosesAt == null) return;
    const at = Date.parse(voting.votingClosesAt);
    if (!Number.isFinite(at)) return;
    const planId = state.plan.id;
    const startedAt = viewEpoch.current;
    const timer = setTimeout(() => {
      // THE RE-ARM IS EXPLICIT. Depending on `state` alone meant a re-read that
      // returned the same still-open answer — the whole disagreement case —
      // produced no new state and therefore no next timer: one retry, then
      // silence, exactly where the asking has to continue.
      setDeadlineTick((n) => n + 1);
      void loadMemberView(planId, startedAt);
    }, clampRecheck(at - Date.now() + DEADLINE_GRACE_MS));
    return () => clearTimeout(timer);
  }, [state, deadlineTick, loadMemberView]);

  const handleSignInToJoin = (): void => {
    // The handoff (criterion 7): the token rides sessionStorage through
    // /auth; PendingInviteRedirect completes the round trip.
    storePendingInvite(token);
    router.push('/auth');
  };

  /**
   * `capacityRefusable` marks the ONE action the member cap can actually
   * refuse: a declined member rejoining. Asking "is it full?" after every
   * failure mislabels unrelated ones — on a full plan, a suggestion-cap or
   * vote failure was reported as "This night out is full" (fresh-cycle review,
   * both lanes). The probe is a diagnosis for a specific refusal, not a
   * general explanation for failure.
   */
  const withRefresh =
    (action: () => Promise<boolean>, capacityRefusable = false) =>
    async (): Promise<void> => {
      // A ref, not state: two taps landing in the same render both read a stale
      // `false` from state and both fire. Without this, a fast double-tap of
      // "Count me back in" sends the second request carrying the status the
      // FIRST one just invalidated, and the user sees a failure for an action
      // that actually succeeded.
      if (actionInFlight.current) return;
      actionInFlight.current = true;
      const startedAt = viewEpoch.current;
      setActionError(null);
      try {
        const ok = await action();
        // The view this action belonged to is gone — neither its error banner nor
        // its refresh addresses whatever is on screen now.
        if (startedAt !== viewEpoch.current) return;
        if (!ok) {
          const supabase = capacityRefusable ? getBrowserSupabase() : null;
          const full = supabase ? await isNightOutFullByToken(supabase, token) : false;
          if (startedAt !== viewEpoch.current) return;
          // Re-read BEFORE advising a retry (round-2 review, Codex, medium).
          // 0059's expected-status/revision guard makes a rejection
          // deterministic: this view still holds the revision the RPC just
          // refused, so retrying from it re-sends the same rejected pair and
          // fails identically until the user reloads by hand. Refreshing first
          // means the next tap carries the truth. Awaited, not
          // fired-and-forgotten, so the error below survives the re-render
          // rather than racing it.
          if (state.kind === 'member') await loadMemberView(state.plan.id, startedAt);
          if (startedAt !== viewEpoch.current) return;
          setActionError(
            full
              ? 'This night out is full.'
              : "That didn't go through — try again.",
          );
          return;
        }
        if (state.kind === 'member') await loadMemberView(state.plan.id, startedAt);
      } finally {
        actionInFlight.current = false;
      }
    };

  if (state.kind === 'loading') {
    return (
      <main className="min-h-screen px-6 py-10">
        <p className="text-center opacity-70">Loading this night out…</p>
      </main>
    );
  }

  if (state.kind === 'gone') {
    return (
      <main className="min-h-screen px-6 py-10 text-center">
        <h1 className="text-2xl font-semibold">This night out isn&apos;t here</h1>
        <p className="mt-3 opacity-70">
          The plan was cancelled, or the link is no longer active.
        </p>
        {/* A dead link is a terminal state, so isSettled() has already spent the
            pending token by the time this renders — without that, these links
            bounced straight back here and the user had no way out of the app's
            own invite page. Two real destinations rather than one, because "/"
            is location-first and can redirect again on its own. */}
        <div className="mt-6 flex flex-col items-center gap-3">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center rounded-full bg-white px-6 font-semibold text-black"
          >
            Find your next bar
          </Link>
          <Link href="/friends" className="inline-flex min-h-[44px] items-center underline">
            Back to your circle
          </Link>
        </div>
      </main>
    );
  }

  if (state.kind === 'preview') {
    const { preview } = state;
    // THE BEARER SURFACE IS ITS OWN COMPONENT (round-3 panel, Codex, HIGH).
    // What used to be here was a four-line poster and "Sign in to join", which
    // is D-C-23 inverted: a token-scoped recipient may view the plan AND RSVP
    // without an account. InvitePreview carries that contract; the signed-in
    // non-member's Join / Not tonight actions are still the page's, because they
    // need its epoch guard and its member loader, and are passed through.
    return (
      <InvitePreview
        token={token}
        preview={preview}
        signedIn={auth.status === 'signed-in'}
        onSignIn={handleSignInToJoin}
      >
        {auth.status === 'signed-in' ? (
          // Joining is EXPLICIT (review round 1): a signed-in non-member
          // sees the preview and chooses to join — the RPC is the accept.
          <button
            type="button"
            onClick={() => {
              void (async () => {
                const supabase = getBrowserSupabase();
                if (!supabase) return;
                const startedAt = viewEpoch.current;
                setActionError(null);
                const planId = await joinNightOutByToken(supabase, token);
                if (startedAt !== viewEpoch.current) return;
                if (planId === null) {
                  // The link is fine when the plan is merely full; saying it
                  // expired sends the user to ask for a new one.
                  const full = await isNightOutFullByToken(supabase, token);
                  // Round 4 (Codex): the capacity probe is another await, and
                  // the banner it produces belongs to the view that asked.
                  if (startedAt !== viewEpoch.current) return;
                  setActionError(
                    full
                      ? 'This night out is full.'
                      : "Couldn't join — the link may have expired.",
                  );
                } else if ((await loadMemberView(planId, startedAt)) === 'failed') {
                  // The join SUCCEEDED and the membership is stored; only the
                  // follow-up read failed. Reporting "full" here contradicted
                  // the database when the join took the last seat (fresh-cycle
                  // review, Codex).
                  //
                  // Round 4 (Codex) hand-checked the epoch here, because `false`
                  // meant both "the read failed" and "I refused to paint". Round
                  // 9 moved that distinction into `MemberLoad` — see its comment
                  // — so only a real failure reaches this branch and the epoch
                  // re-check that used to sort them out is gone with it.
                  setActionError("You're in — but this page couldn't load. Refresh to see it.");
                }
              })();
            }}
            className="mt-6 rounded-full bg-white px-6 py-3 font-semibold text-black"
          >
            Join this night out
          </button>
        ) : null}
        {auth.status === 'signed-in' ? (
          // Declining must not route through joining (round-2 review, Codex
          // high): tapping "Not tonight" here used to require joining first,
          // which recorded an acceptance and emitted an 'accepted' event the
          // host could see before the decline landed.
          <button
            type="button"
            onClick={() => {
              void (async () => {
                const supabase = getBrowserSupabase();
                if (!supabase) return;
                const startedAt = viewEpoch.current;
                setActionError(null);
                const planId = await declineNightOutByToken(supabase, token);
                if (startedAt !== viewEpoch.current) return;
                if (
                  planId === null
                  || (await loadMemberView(planId, startedAt)) === 'failed'
                ) {
                  // Same distinction as the join branch above, and now carried
                  // by the return type rather than re-derived here: a refused
                  // paint is not a failed decline.
                  setActionError("Couldn't send that — the link may have expired.");
                }
              })();
            }}
            className="mt-3 block w-full rounded-full border px-6 py-3"
          >
            Not tonight
          </button>
        ) : null}
        {actionError !== null ? (
          <p className="mt-3 text-sm text-red-400">{actionError}</p>
        ) : null}
      </InvitePreview>
    );
  }

  const { plan, members, board, voting, anonRsvps } = state;
  const isOwner = plan.callerRole === 'owner';
  const accepted = members.filter((m) => m.inviteStatus === 'accepted');
  const isCancelled = plan.status === 'cancelled';
  const isDeclined = plan.callerStatus === 'declined';

  /**
   * One response call site for all three buttons, carrying the status AND the
   * revision THIS RENDER was built from (0059). Passing the rendered pair is the
   * whole mechanism: re-reading at click time would re-open the replay window
   * inside the client.
   *
   * It refuses rather than substituting a default when either value is absent.
   * The previous `plan.callerStatus ?? 'pending'` fabricated a status that was
   * never rendered; doing the same for the revision would hand the RPC a
   * made-up version and defeat the check. `plan` is only non-null when the
   * caller has a membership row, so this branch is unreachable in practice —
   * which is the reason to make it refuse, not the reason to guess.
   */
  const respondAs = (accept: boolean) => (): Promise<boolean> => {
    const supabase = getBrowserSupabase();
    if (supabase === null || plan.callerStatus === null || plan.callerRevision === null) {
      return Promise.resolve(false);
    }
    return respondNightOut(
      supabase,
      plan.id,
      accept,
      plan.callerStatus,
      plan.callerRevision,
    );
  };
  // Mirror of the write RPCs' own preconditions. suggest_night_out_bar and
  // vote_night_out_bar both require status in ('draft','open') and reject a
  // caller who is not an accepted member, so rendering those controls to
  // anyone else offers an action that cannot succeed — the user tapped Vote on
  // a decided plan and got "That didn't go through", which reads as a bug in
  // the app rather than a closed plan. Kept as ONE predicate so the UI and the
  // SQL cannot drift apart silently.
  const isPlanOpen = plan.status === 'draft' || plan.status === 'open';
  /**
   * V8-R-NO-005. Once the deadline passes the plan is READ-ONLY for
   * participants, and the server refuses suggestions, votes and removals from
   * that instant — so the controls have to go with it, or they offer actions
   * that can only fail.
   *
   * A window we could not READ is not a closed one: `voting === null` means the
   * read failed, and treating that as closed would withdraw every control on a
   * guess. The plan's own status still governs in that case, exactly as before.
   */
  const votingOpen = voting === null ? isPlanOpen : voting.votingOpen;
  const canParticipate =
    isPlanOpen && votingOpen && (isOwner || plan.callerStatus === 'accepted');
  /**
   * MEDIA IS A DIFFERENT PERMISSION FROM SUGGESTING (round 2, Codex gate, HIGH).
   *
   * `canParticipate` also requires the plan to be draft or open, because
   * `suggest_night_out_bar` and `vote_night_out_bar` both close once a bar is
   * decided. `add_night_out_media` and `archive_night_out` do not: they check
   * `night_out_role(...) is not null` — accepted membership — and the media
   * window, and nothing else. Passing the suggestion predicate to the photo
   * section therefore hid Add-a-photo from every accepted member the moment the
   * plan was locked, which is exactly when the night is about to be
   * photographed. The two predicates are named apart so they cannot drift back
   * together.
   */
  //
  // ...AND NOT ON A CANCELLED PLAN (round-5 panel, Claude gate).
  // `add_night_out_media` refuses one outright, so offering the control
  // uploaded the bytes, had the attach refused, and blamed a window that was
  // not the reason — leaving a registered object with no destination every
  // time. The recap itself still renders for a cancelled plan, and archiving
  // still works: what closes is only the write.
  const canAddPhoto =
    !isCancelled && (isOwner || plan.callerStatus === 'accepted');

  /**
   * THE BOARD IS RANKED (round-3 panel, Codex, HIGH). It used to render in
   * whatever order `get_night_out_board` returned, with a "Pick this" on every
   * row — so "the top bar" was not a thing the surface showed, and the owner's
   * action was "choose any of these" rather than V8-R-SOC-007's "take the top
   * bar". Ranked the same way `lock_night_out` ranks it (votes, then the row's
   * own order as a stable tiebreak) so the row on top IS the one a lock takes.
   *
   * THE TIEBREAK IS THE SERVER'S (round-6 panel, Codex, MEDIUM). This sort is
   * stable, so it preserves whatever order the board arrived in — and 0044's
   * board ordered by `created_at` alone, which is not total. Two rows sharing a
   * timestamp arrived in an arbitrary order while `lock_night_out` broke that
   * tie on `bar_id`, so the top row and the locked bar could differ. 0068
   * replaces `get_night_out_board` with the lock's exact total order; the board
   * carries no `created_at`, so this could never have been reconstructed here.
   *
   * A COPY, not a sort in place: `board` is state, and `Array.prototype.sort`
   * mutates its receiver.
   */
  const rankedBoard = [...(board ?? [])].sort((a, b) => b.votes - a.votes);

  /**
   * The viewer's own handle, for deciding which rows get an overflow control.
   * The board carries the suggester's HANDLE and no id, so this is the only
   * join available; the authorization itself is the RPC's, and this decides
   * rendering only.
   */
  const myHandle =
    auth.status === 'signed-in'
      ? (members.find((m) => m.userId === auth.user.id)?.handle ?? null)
      : null;

  const copyInviteLink = (): void => {
    void (async () => {
                // The clipboard write is an await like any other, so its
                // continuation belongs to the view that started it (round-6
                // panel, Codex). A late rejection otherwise printed plan A's
                // bearer URL under plan B.
                const startedAt = viewEpoch.current;
                const url = `${window.location.origin}/night-out/${token}`;
                try {
                  await navigator.clipboard.writeText(url);
                  if (startedAt !== viewEpoch.current) return;
                  setShareNotice('Invite link copied.');
                } catch {
                  // Clipboard is permission-gated and absent in some in-app
                  // browsers; show the link so it can still be copied by hand
                  // rather than failing silently.
                  if (startedAt !== viewEpoch.current) return;
                  setShareNotice(url);
                }
    })();
  };

  return (
    // pb-28 CLEARS THE BOTTOM NAV. This page carried only `py-8` and got away
    // with it while the suggestion form was the last thing on it — nothing at
    // the bottom was interactive enough to notice. Adding the photo section
    // below made it a real bug: the fixed `z-[1000]` nav sits over the last
    // ~7rem of every scrollable page, so Save and Add a photo were visible,
    // enabled, and un-tappable. Every other surface (/friends, /nights) already
    // reserves this.
    <main className="min-h-screen px-6 py-8 pb-28">
      <PlanHeader plan={plan} isOwner={isOwner} isCancelled={isCancelled} />

      {/* README §7: the decided banner, locked plans only. */}
      {!isCancelled && plan.status === 'decided' && plan.decidedBarId !== null ? (
        <DecidedBanner barId={plan.decidedBarId} onShare={copyInviteLink} />
      ) : null}

      {actionError !== null ? (
        <p className="mt-4 text-center text-sm text-red-400">{actionError}</p>
      ) : null}

      <PlanShortlist
        plan={plan}
        board={board}
        rankedBoard={rankedBoard}
        voting={voting}
        wordsNow={wordsNow}
        isCancelled={isCancelled}
        isOwner={isOwner}
        isPlanOpen={isPlanOpen}
        votingOpen={votingOpen}
        isDeclined={isDeclined}
        canParticipate={canParticipate}
        myHandle={myHandle}
        overflowBarId={overflowBarId}
        setOverflowBarId={setOverflowBarId}
        suggestInput={suggestInput}
        setSuggestInput={setSuggestInput}
        setActionError={setActionError}
        withRefresh={withRefresh}
      />

      <MemberBoard members={members} accepted={accepted} anonRsvps={anonRsvps} />

      <RsvpRow
        plan={plan}
        isCancelled={isCancelled}
        isDeclined={isDeclined}
        isOwner={isOwner}
        respondAs={respondAs}
        withRefresh={withRefresh}
      />

      {!isCancelled ? <PlanFooter shareNotice={shareNotice} onCopyInvite={copyInviteLink} /> : null}

      {/* V8-R-NO-008 / V8-R-NO-009. Rendered for a CANCELLED plan too: the
          night still happened, its photos are still inside their window, and
          the archive is the one thing a cancellation must not take away. */}
      <NightOutMedia planId={plan.id} canAddPhoto={canAddPhoto} />
    </main>
  );
}
