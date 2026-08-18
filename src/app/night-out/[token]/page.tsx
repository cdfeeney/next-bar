'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { getBarById } from '@/lib/catalog';
import { consumePendingInvite, peekPendingInvite, storePendingInvite } from '@/lib/pendingInvite';
import {
  cancelNightOut,
  decideNightOut,
  declineNightOutByToken,
  getNightOut,
  getNightOutBoard,
  getNightOutMembers,
  isNightOutFullByToken,
  joinNightOutByToken,
  previewNightOut,
  resolveNightOutByToken,
  respondNightOut,
  suggestNightOutBar,
  voteNightOutBar,
  type NightOut,
  type NightOutBoardEntry,
  type NightOutMember,
  type NightOutPreview,
} from '@/lib/nightOuts.server';

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

type PageState =
  | { kind: 'loading' }
  | { kind: 'gone' }
  | { kind: 'preview'; preview: NightOutPreview }
  | {
      kind: 'member';
      plan: NightOut;
      members: NightOutMember[];
      board: NightOutBoardEntry[];
    };

/**
 * Has the page reached a TERMINAL state — i.e. has the invite handoff finished
 * its job, whatever the outcome?
 *
 * This predicate is the root of a bug that has now been "fixed" three times,
 * each time by approximating the same invariant slightly differently:
 *
 *   round 1: consume in PendingInviteRedirect  -> it navigated away before
 *            arriving, so an interrupted trip lost the plan
 *   round 2: consume on MOUNT                  -> mount is not arrival;
 *            OnboardingGate redirected first and the token was already gone
 *   round 3: consume on state.kind==='member'  -> membership is not the only
 *            arrival; a signed-in non-member settling in 'preview' or 'gone'
 *            never spent the token, so PendingInviteRedirect replayed the
 *            navigation on EVERY route change for the rest of the session
 *
 * The invariant was always: the handoff is spent once the destination SETTLES,
 * regardless of which terminal state it settles into. Stating it once, here,
 * is what stops a fourth variant appearing.
 *
 * The exhaustive switch is deliberate. Adding a fifth PageState will fail to
 * compile until someone classifies it as settled or not — the next person
 * cannot silently inherit the wrong answer.
 */
function isSettled(kind: PageState['kind']): boolean {
  switch (kind) {
    case 'member':
    case 'preview':
    case 'gone':
      return true;
    case 'loading':
      return false;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function nightDateLabel(nightKey: string): string {
  const [y, m, d] = nightKey.split('-').map(Number);
  if (!y || !m || !d) return nightKey;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function barLabel(barId: string): string {
  return getBarById(barId)?.name ?? barId;
}

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
    async (planId: string, startedAt?: number): Promise<boolean> => {
      const supabase = getBrowserSupabase();
      if (!supabase) return false;
      const epoch = startedAt ?? viewEpoch.current;
      if (epoch !== viewEpoch.current) return false;
      const [plan, members, board] = await Promise.all([
        getNightOut(supabase, planId),
        getNightOutMembers(supabase, planId),
        getNightOutBoard(supabase, planId),
      ]);
      if (plan === null) return false;
      // The view moved while we were away: this answer belongs to a session, or
      // a plan, that is no longer the one on screen.
      if (epoch !== viewEpoch.current) return false;
      setState({
        kind: 'member',
        plan,
        members: members ?? [],
        board: board ?? [],
      });
      return true;
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
  }, [state.kind, token]);

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
        if (planId !== null && (await loadMemberView(planId, startedAt))) return;
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
      const startedAt = viewEpoch.current;
      setActionError(null);
      const ok = await action();
      // The view this action belonged to is gone — neither its error banner nor
      // its refresh addresses whatever is on screen now.
      if (startedAt !== viewEpoch.current) return;
      if (!ok) {
        const supabase = capacityRefusable ? getBrowserSupabase() : null;
        const full = supabase ? await isNightOutFullByToken(supabase, token) : false;
        if (startedAt !== viewEpoch.current) return;
        setActionError(
          full
            ? 'This night out is full.'
            : "That didn't go through — try again.",
        );
        return;
      }
      if (state.kind === 'member') void loadMemberView(state.plan.id, startedAt);
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
    const host = preview.ownerDisplayName ?? preview.ownerHandle ?? 'A friend';
    return (
      <main className="min-h-screen px-6 py-10 text-center">
        <p className="text-sm uppercase tracking-wide opacity-60">
          You&apos;re invited
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          {preview.title ?? `${host}'s night out`}
        </h1>
        <p className="mt-2 opacity-80">{nightDateLabel(preview.night)}</p>
        <p className="mt-1 text-sm opacity-60">
          Hosted by {host}
          {preview.acceptedCount > 0
            ? ` · ${preview.acceptedCount} in so far`
            : ''}
        </p>
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
                } else if (!(await loadMemberView(planId, startedAt))) {
                  // The join SUCCEEDED and the membership is stored; only the
                  // follow-up read failed. Reporting "full" here contradicted
                  // the database when the join took the last seat (fresh-cycle
                  // review, Codex).
                  //
                  // Round 4 (Codex): `loadMemberView` returning false is
                  // AMBIGUOUS — it means either "the read failed" or "the view
                  // moved on and I refused to paint". Only the first is a
                  // failure to report. Without this, a stale abort announced
                  // "You're in" over whatever plan is now on screen.
                  if (startedAt !== viewEpoch.current) return;
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
                if (planId === null || !(await loadMemberView(planId, startedAt))) {
                  // Same ambiguity as the join branch above (round 4, Codex):
                  // a refused paint is not a failed decline.
                  if (startedAt !== viewEpoch.current) return;
                  setActionError("Couldn't send that — the link may have expired.");
                }
              })();
            }}
            className="mt-3 block w-full rounded-full border px-6 py-3"
          >
            Not tonight
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSignInToJoin}
            className="mt-6 rounded-full bg-white px-6 py-3 font-semibold text-black"
          >
            Sign in to join
          </button>
        )}
        {actionError !== null ? (
          <p className="mt-3 text-sm text-red-400">{actionError}</p>
        ) : null}
      </main>
    );
  }

  const { plan, members, board } = state;
  const isOwner = plan.callerRole === 'owner';
  const accepted = members.filter((m) => m.inviteStatus === 'accepted');
  const isCancelled = plan.status === 'cancelled';
  const isDeclined = plan.callerStatus === 'declined';
  // Mirror of the write RPCs' own preconditions. suggest_night_out_bar and
  // vote_night_out_bar both require status in ('draft','open') and reject a
  // caller who is not an accepted member, so rendering those controls to
  // anyone else offers an action that cannot succeed — the user tapped Vote on
  // a decided plan and got "That didn't go through", which reads as a bug in
  // the app rather than a closed plan. Kept as ONE predicate so the UI and the
  // SQL cannot drift apart silently.
  const isPlanOpen = plan.status === 'draft' || plan.status === 'open';
  const canParticipate =
    isPlanOpen && (isOwner || plan.callerStatus === 'accepted');

  return (
    <main className="min-h-screen px-6 py-8">
      <header className="text-center">
        <h1 className="text-2xl font-semibold">
          {plan.title ?? 'Night out'}
        </h1>
        <p className="mt-1 opacity-80">{nightDateLabel(plan.night)}</p>
        <p className="mt-1 text-sm opacity-60">
          Hosted by {plan.ownerDisplayName ?? plan.ownerHandle ?? 'a friend'}
        </p>
        {isCancelled ? (
          <p className="mt-3 font-semibold text-red-400">
            This night out was cancelled.
          </p>
        ) : plan.status === 'decided' && plan.decidedBarId !== null ? (
          <p className="mt-3 font-semibold">
            It&apos;s decided: {barLabel(plan.decidedBarId)}
          </p>
        ) : null}

        {/* Round-2 review (Codex, high): creating a plan produced a link the
            app gave you no way to send. The consensus page's "Invite friends"
            still shares /join, and this page had no share control at all, so
            the canonical invitation lifecycle had no reachable invite step. */}
        {!isCancelled ? (
          <button
            type="button"
            onClick={() => {
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
            }}
            className="mt-4 rounded-full border px-5 py-2 text-sm"
          >
            Copy invite link
          </button>
        ) : null}
        {shareNotice !== null ? (
          <p className="mt-2 break-all text-xs opacity-70" role="status">
            {shareNotice}
          </p>
        ) : null}
      </header>

      {actionError !== null ? (
        <p className="mt-4 text-center text-sm text-red-400">{actionError}</p>
      ) : null}

      {!isCancelled ? (
        <section className="mt-6 flex justify-center gap-3">
          {plan.callerStatus === 'pending' ? (
            // An invited member accepts EXPLICITLY (viewing never mutates).
            <button
              type="button"
              onClick={withRefresh(() => {
                const supabase = getBrowserSupabase();
                return supabase
                  ? respondNightOut(supabase, plan.id, true)
                  : Promise.resolve(false);
              })}
              className="rounded-full bg-white px-5 py-2 font-semibold text-black"
            >
              I&apos;m in
            </button>
          ) : null}
          {isDeclined ? (
            <button
              type="button"
              onClick={withRefresh(() => {
                const supabase = getBrowserSupabase();
                return supabase
                  ? respondNightOut(supabase, plan.id, true)
                  : Promise.resolve(false);
              }, true)}
              className="rounded-full border px-5 py-2"
            >
              Count me back in
            </button>
          ) : !isOwner ? (
            <button
              type="button"
              onClick={withRefresh(() => {
                const supabase = getBrowserSupabase();
                return supabase
                  ? respondNightOut(supabase, plan.id, false)
                  : Promise.resolve(false);
              })}
              className="rounded-full border px-5 py-2"
            >
              Not tonight
            </button>
          ) : (
            <button
              type="button"
              onClick={withRefresh(() => {
                const supabase = getBrowserSupabase();
                return supabase
                  ? cancelNightOut(supabase, plan.id)
                  : Promise.resolve(false);
              })}
              className="rounded-full border border-red-400 px-5 py-2 text-red-400"
            >
              Cancel night out
            </button>
          )}
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="font-semibold">Who&apos;s in ({accepted.length})</h2>
        <ul className="mt-2 space-y-1">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2 text-sm">
              <span>{m.displayName ?? m.handle ?? 'Someone'}</span>
              <span className="opacity-50">
                {m.role === 'owner'
                  ? 'host'
                  : m.inviteStatus === 'accepted'
                    ? 'in'
                    : m.inviteStatus === 'declined'
                      ? 'not tonight'
                      : 'invited'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {!isCancelled ? (
        <section className="mt-8">
          <h2 className="font-semibold">Where should we go?</h2>
          <ul className="mt-2 space-y-2">
            {board.map((entry) => (
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
                  {isOwner && plan.status !== 'decided' ? (
                    <button
                      type="button"
                      onClick={withRefresh(() => {
                        const supabase = getBrowserSupabase();
                        return supabase
                          ? decideNightOut(supabase, plan.id, entry.barId)
                          : Promise.resolve(false);
                      })}
                      className="rounded-full border px-3 py-1 text-sm"
                    >
                      Pick this
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
            {board.length === 0 ? (
              <li className="text-sm opacity-60">No suggestions yet.</li>
            ) : null}
          </ul>
          {!canParticipate ? (
            <p className="mt-3 text-sm opacity-60">
              {!isPlanOpen
                ? 'The plan is settled — suggestions are closed.'
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
    </main>
  );
}
