'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
   * Monotonic epoch, bumped whenever the auth status changes. Every member load
   * captures it and refuses to paint if it has moved on.
   *
   * Cold panel (Codex): loadMemberView called setState unconditionally and never
   * saw the effect's `cancelled` flag, so an authenticated load started before a
   * sign-out could settle afterwards and put PRIVATE member data back on screen
   * for a signed-out viewer. The effect's own cancel flag could not cover it —
   * the direct callers (join, rejoin, refresh) are outside that closure.
   */
  const authEpoch = useRef(0);
  // Guards every withRefresh action against re-entrant taps. See withRefresh.
  const actionInFlight = useRef(false);
  useEffect(() => {
    authEpoch.current += 1;
    // Blocking a stale load from painting is only half of it (cold panel 2,
    // Codex): on a sign-out the member view ALREADY on screen stayed rendered
    // until the anonymous preview settled, so accepted-member data sat in front
    // of a signed-out viewer for as long as that request took. Drop it now and
    // let the reload decide what a signed-out viewer may see.
    if (auth.status !== 'signed-in') {
      setState((current) => (current.kind === 'member' ? { kind: 'loading' } : current));
    }
  }, [auth.status]);

  const loadMemberView = useCallback(
    async (planId: string): Promise<boolean> => {
      const supabase = getBrowserSupabase();
      if (!supabase) return false;
      const epoch = authEpoch.current;
      const [plan, members, board] = await Promise.all([
        getNightOut(supabase, planId),
        getNightOutMembers(supabase, planId),
        getNightOutBoard(supabase, planId),
      ]);
      if (plan === null) return false;
      // Auth moved while we were away: this answer belongs to a session that is
      // no longer the one looking at the screen.
      if (epoch !== authEpoch.current) return false;
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
    void (async () => {
      if (auth.status === 'signed-in') {
        // Viewing never mutates (review round 1, both lanes): an existing
        // member — pending, accepted, or declined — RESOLVES straight to
        // their plan view. Joining is always the explicit button below.
        const planId = await resolveNightOutByToken(supabase, token);
        if (cancelled) return;
        if (planId !== null && (await loadMemberView(planId))) return;
        if (cancelled) return;
      }
      // Signed-out, non-member, or the link is dead/cancelled: bearer
      // preview only.
      const preview = await previewNightOut(supabase, token);
      if (cancelled) return;
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
      // A ref, not state: two taps landing in the same render both read a stale
      // `false` from state and both fire. Without this, a fast double-tap of
      // "Count me back in" sends the second request carrying the status the
      // FIRST one just invalidated, and the user sees a failure for an action
      // that actually succeeded.
      if (actionInFlight.current) return;
      actionInFlight.current = true;
      setActionError(null);
      try {
        const ok = await action();
        if (!ok) {
          const supabase = capacityRefusable ? getBrowserSupabase() : null;
          const full = supabase ? await isNightOutFullByToken(supabase, token) : false;
          // Re-read BEFORE advising a retry (round-2 review, Codex, medium).
          // 0059's expected-status/revision guard makes a rejection
          // deterministic: this view still holds the revision the RPC just
          // refused, so retrying from it re-sends the same rejected pair and
          // fails identically until the user reloads by hand. Refreshing first
          // means the next tap carries the truth. Awaited, not
          // fired-and-forgotten, so the error below survives the re-render
          // rather than racing it.
          if (state.kind === 'member') await loadMemberView(state.plan.id);
          setActionError(
            full
              ? 'This night out is full.'
              : "That didn't go through — try again.",
          );
          return;
        }
        if (state.kind === 'member') await loadMemberView(state.plan.id);
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
                setActionError(null);
                const planId = await joinNightOutByToken(supabase, token);
                if (planId === null) {
                  // The link is fine when the plan is merely full; saying it
                  // expired sends the user to ask for a new one.
                  setActionError(
                    (await isNightOutFullByToken(supabase, token))
                      ? 'This night out is full.'
                      : "Couldn't join — the link may have expired.",
                  );
                } else if (!(await loadMemberView(planId))) {
                  // The join SUCCEEDED and the membership is stored; only the
                  // follow-up read failed. Reporting "full" here contradicted
                  // the database when the join took the last seat (fresh-cycle
                  // review, Codex).
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
                setActionError(null);
                const planId = await declineNightOutByToken(supabase, token);
                if (planId === null || !(await loadMemberView(planId))) {
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
                const url = `${window.location.origin}/night-out/${token}`;
                try {
                  await navigator.clipboard.writeText(url);
                  setShareNotice('Invite link copied.');
                } catch {
                  // Clipboard is permission-gated and absent in some in-app
                  // browsers; show the link so it can still be copied by hand
                  // rather than failing silently.
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
              onClick={withRefresh(respondAs(true))}
              className="rounded-full bg-white px-5 py-2 font-semibold text-black"
            >
              I&apos;m in
            </button>
          ) : null}
          {isDeclined ? (
            <button
              type="button"
              onClick={withRefresh(respondAs(true), true)}
              className="rounded-full border px-5 py-2"
            >
              Count me back in
            </button>
          ) : !isOwner ? (
            <button
              type="button"
              onClick={withRefresh(respondAs(false))}
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
