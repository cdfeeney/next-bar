'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { getBarById } from '@/lib/catalog';
import { consumePendingInvite, peekPendingInvite, storePendingInvite } from '@/lib/pendingInvite';
import {
  cancelNightOut,
  decideNightOut,
  getNightOut,
  getNightOutBoard,
  getNightOutMembers,
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
  const token = decodeURIComponent(params.token);

  const loadMemberView = useCallback(
    async (planId: string): Promise<boolean> => {
      const supabase = getBrowserSupabase();
      if (!supabase) return false;
      const [plan, members, board] = await Promise.all([
        getNightOut(supabase, planId),
        getNightOutMembers(supabase, planId),
        getNightOutBoard(supabase, planId),
      ]);
      if (plan === null) return false;
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
  useEffect(() => {
    if (peekPendingInvite() === token) consumePendingInvite();
  }, [token]);

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

  const withRefresh =
    (action: () => Promise<boolean>) => async (): Promise<void> => {
      setActionError(null);
      const ok = await action();
      if (!ok) {
        setActionError("That didn't go through — try again.");
        return;
      }
      if (state.kind === 'member') void loadMemberView(state.plan.id);
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
        <Link href="/" className="mt-6 inline-block underline">
          Find your next bar
        </Link>
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
                if (planId === null || !(await loadMemberView(planId))) {
                  setActionError("Couldn't join — the link may have expired.");
                }
              })();
            }}
            className="mt-6 rounded-full bg-white px-6 py-3 font-semibold text-black"
          >
            Join this night out
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
              })}
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
                  {!entry.callerVoted ? (
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
                  ) : (
                    <span className="text-sm opacity-50">voted</span>
                  )}
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
        </section>
      ) : null}
    </main>
  );
}
