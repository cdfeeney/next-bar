'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { displayHood } from '@/lib/hoodDisplay';
import { getBarById } from '@/lib/catalog';
import { useBars } from '@/lib/useBars';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { useFollows } from '@/hooks/useFollows';
import {
  AUDIENCE_LABELS,
  PRESENCE_LABELS,
  describePresence,
  type MyPresence,
  type PresenceAudience,
  type PresenceStatus,
} from '@/lib/presence';
import {
  clearPresence,
  fetchMyPresence,
  setPresence,
} from '@/lib/presence/server';
import { isAudienceHeld } from '@/lib/presence/PinDialogs';
import { usePinnedHandles, announcePresenceChanged } from './usePinnedHandles';
import { PinYourSpotStep, StepHeader, WhereAreYouStep, type PinStep } from './PinSteps';

/**
 * YOU TONIGHT — /friends/tonight (V8-R-SOC-001, V8-R-PRE-001..005; Social
 * redesign README §4–§5). Three pushed screens over ONE state machine:
 *
 *   status    "You tonight"    — ARE YOU GOING OUT? rows (each tap writes) and
 *                                the WHERE ARE YOU? row.
 *   where     "Where are you?" — the bar picker. Tapping a bar SELECTS it.
 *   audience  "Pin your spot"  — the audience rows, the inline Custom picker,
 *                                and Pin it: the ONE write of the sequence.
 *
 * The rules every step obeys:
 *
 *  * Manual and attributed to a person. Every line names who set it. There is
 *    no device signal anywhere in this component and nothing derives presence
 *    from location.
 *  * Presence LEADS WITH THE BAR, and the state is carried in WORDS on the
 *    line beneath — never by colour alone (V8-R-SOC-001, accessibility).
 *  * Nobody is described by an invented venue. `describePresence` is the one
 *    place that decides this, and it drops a bar that contradicts the status
 *    rather than rendering it.
 *  * A pin sets Going out (V8-R-PRE-004) and expires at 4:00 AM
 *    America/New_York (V8-R-PRE-005) — structurally, because every read is
 *    scoped to `nycNightKey()`.
 *
 * The three-state read matters: "still loading", "no pin" and "could not read"
 * render differently, and only the middle one may be written over.
 *
 * S-05b (owner decision 2026-09-14): the steps are pushed screens, not modals.
 * The step is mirrored to `?step=` so the back gesture, a refresh and a deep
 * link all land on a real screen; the pending pin itself lives only here.
 */

const STATUS_ORDER: readonly PresenceStatus[] = ['going', 'maybe', 'not-going'];

/**
 * The audience choices, in the contract's order (V8-R-PRE-002).
 *
 * 'close' sits between them as the mutual-follow narrowing this branch already
 * shipped. The contract's own third top-level choice — a single named GROUP —
 * is ABSENT because there is no groups model on this branch to name one; see
 * `PresenceAudience` and migration 0068 section 3c.
 */
const AUDIENCE_ORDER: readonly PresenceAudience[] = ['friends', 'close', 'people'];

/**
 * WHAT WE KNOW ABOUT THE VIEWER'S OWN PIN, as three states that cannot collapse.
 *
 * Round 2 separated "you have no pin" from "we could not read your pin", which
 * closed the write-with-a-default-audience hole for a FAILED read. Round 3
 * (Codex gate, HIGH) found the third state was still missing: while the very
 * first `get_my_presence` was in flight the component was in neither of the two,
 * so the status rows rendered ENABLED, and a tap in that window wrote
 * `audience: 'friends'` with an empty recipient list over a live 'close' or
 * 'people' pin. `set_night_presence` replaces the row wholesale.
 *
 * A union rather than a second boolean: the rows read `kind === 'ok'`, so a
 * fourth state added later cannot silently default to "safe to write".
 */
type MinePinState =
  /** The first read has not answered yet. We know nothing. */
  | { kind: 'loading' }
  /** The server answered: `presence` is the pin, or null for no pin at all. */
  | { kind: 'ok'; presence: MyPresence | null }
  /** The read failed. Different from "no pin", and never written over. */
  | { kind: 'unreadable' };

const TONIGHT_PATH = '/friends/tonight';

/** `?step=where|audience` → the step; anything else is the status screen. */
function stepFromSearch(search: string): PinStep {
  const step = new URLSearchParams(search).get('step');
  return step === 'where' || step === 'audience' ? step : 'status';
}

function stepHref(step: PinStep): string {
  return step === 'status' ? TONIGHT_PATH : `${TONIGHT_PATH}?step=${step}`;
}


export default function TonightPresence(): JSX.Element {
  // 0019 swap-day rule: this component renders getBarById lookups, so it
  // subscribes to a live server-catalog swap.
  useBars();
  const auth = useAuth();
  const router = useRouter();
  const { night, refresh } = usePinnedHandles();
  // The mutual-follow list the Custom audience picks from. Read here so the
  // picker stays a presentation of a list it is given, and so "still loading"
  // is distinguishable from "you have nobody".
  const follows = useFollows();
  const [minePin, setMinePin] = useState<MinePinState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /**
   * WHICH SCREEN. Initialised from the URL so a refresh or a deep link lands on
   * the named step; mirrored back to the URL on every transition (see `go`),
   * and re-read on popstate so the browser's back gesture works.
   */
  const [step, setStep] = useState<PinStep>('status');
  /**
   * A bar the user has CHOSEN but not yet pinned, plus the audience they are
   * choosing for it. Nothing here has been written; see `confirmPin`.
   */
  const [pendingBarId, setPendingBarId] = useState<string | null>(null);
  const [pendingAudience, setPendingAudience] = useState<PresenceAudience>('friends');
  const [pendingRecipients, setPendingRecipients] = useState<readonly string[]>([]);

  const userId = auth.status === 'signed-in' ? auth.user.id : null;

  /**
   * THE HISTORY ENTRIES THIS PAGE OWNS, oldest first — the entry it was opened
   * on, then one per step pushed since. Going back walks by the real number of
   * entries, never by the step's depth in the flow (S-05b panel round 2): the
   * live-pin Custom chip pushes `audience` straight from the status screen, so
   * assuming two entries sent `history.go(-2)` off the app entirely.
   */
  const entries = useRef<PinStep[]>(['status']);

  /** Forward: push a new entry. */
  const go = useCallback(
    (next: PinStep): void => {
      setStep(next);
      entries.current = [...entries.current, next];
      router.push(stepHref(next));
    },
    [router],
  );

  /** Backward: walk our own entries when the target is one of them; else replace. */
  const goBackTo = useCallback(
    (target: PinStep): void => {
      const stack = entries.current;
      const index = stack.lastIndexOf(target);
      if (index >= 0 && index < stack.length - 1) {
        entries.current = stack.slice(0, index + 1);
        // popstate re-reads the step from the URL and clears any pending pin.
        window.history.go(index - (stack.length - 1));
        return;
      }
      setStep(target);
      entries.current = [...stack.slice(0, -1), target];
      router.replace(stepHref(target));
    },
    [router],
  );

  useEffect(() => {
    // Read the URL after mount (never during render: the server renders the
    // status screen, and a client-only initial value would mismatch it).
    const initial = stepFromSearch(window.location.search);
    entries.current = [initial];
    setStep(initial);
    const sync = (): void => {
      const next = stepFromSearch(window.location.search);
      setStep(next);
      // Keep the owned-entry stack in step with the browser: back trims to the
      // entry we returned to, forward adds the one we moved onto.
      const stack = entries.current;
      const index = stack.lastIndexOf(next);
      entries.current = index >= 0 ? stack.slice(0, index + 1) : [...stack, next];
      // The OS back gesture is the in-app ‹ by another route (S-05b panel,
      // Codex, medium): landing on the status screen drops the pending pin
      // exactly as Cancel does, so nothing half-composed waits behind it.
      if (next === 'status') {
        setPendingBarId(null);
        setPendingRecipients([]);
        setPendingAudience('friends');
      }
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  /**
   * WHICH READ IS ALLOWED TO PAINT — the pair (account, night).
   *
   * Round 3 (Codex gate, HIGH): `reloadMine` called `setMinePin` unconditionally
   * after its await, so a read started for account A could settle after a
   * sign-out and put A's pinned bar and audience back on screen for whoever was
   * looking at the page. A night rollover is the same defect one axis over.
   *
   * The epoch is bumped in the same effect that starts the read, before its
   * first await, so a load can only ever paint into the view that asked for it.
   */
  const readEpoch = useRef(0);

  const reloadMine = useCallback(async (): Promise<void> => {
    const startedAt = readEpoch.current;
    if (!userId) {
      // Signed out: there is no pin to read, and nothing failed.
      setMinePin({ kind: 'ok', presence: null });
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) {
      // An unconfigured client is a FAILED read, not an absent pin.
      setMinePin({ kind: 'unreadable' });
      return;
    }
    const read = await fetchMyPresence(supabase);
    // The view moved on while we were away: this answer is about a different
    // account, or a different night, from the one on screen.
    if (startedAt !== readEpoch.current) return;
    // THREE KINDS IN, THREE STATES OUT — and the middle one is not optional.
    // Zero rows tonight is what `get_my_presence` returns for EVERY account on
    // EVERY night before its first pin; collapsing `unset` into `unreadable`
    // once left the rows permanently disabled. The switch is exhaustive on
    // purpose — a fourth kind must not compile until someone places it.
    switch (read.kind) {
      case 'ok':
        setMinePin({ kind: 'ok', presence: read.presence });
        return;
      case 'unset':
        setMinePin({ kind: 'ok', presence: null });
        return;
      case 'failed':
        setMinePin({ kind: 'unreadable' });
        return;
      default: {
        const exhaustive: never = read;
        return exhaustive;
      }
    }
  }, [userId, night]);

  useEffect(() => {
    // Synchronously, before `reloadMine` captures it: every read already in
    // flight belongs to the view that is leaving.
    readEpoch.current += 1;
    // Back to "we know nothing" rather than to "no pin", which is a claim about
    // this account we have not made yet.
    setMinePin({ kind: 'loading' });
    // AND SO DOES EVERYTHING HALF-COMPOSED (round-3 panel, both gates): account
    // A could compose a pin, sign out, and B's session would find A's bar and
    // A's recipients still on screen with a live "Pin it" that sends them under
    // B. The night rollover is the same defect on the other axis. Cleared HERE,
    // in the same effect that moves the epoch, so the two can never disagree.
    setPendingBarId(null);
    setPendingAudience('friends');
    setPendingRecipients([]);
    // Only the audience step is meaningless without a pending bar. The bar
    // step survives — this effect also fires when auth settles after mount,
    // and a deep link to ?step=where must not be thrown away by that.
    setStep((current) => (current === 'audience' ? 'status' : current));
    setFailed(false);
    void reloadMine();
  }, [reloadMine]);

  const mine = minePin.kind === 'ok' ? minePin.presence : null;
  /** The server has answered. The ONLY state in which a write may be built. */
  const mineKnown = minePin.kind === 'ok';

  /**
   * One tap sets a status; tapping the lit one clears it (V8-R-PRE-005).
   * Failure is REPORTED, never assumed away: if the write does not land, the
   * row says so and the previous state stands.
   */
  const choose = useCallback(
    async (status: PresenceStatus): Promise<void> => {
      if (busy) return;
      // A write built on a pin we have not read would carry a DEFAULT audience
      // over whatever the server is enforcing. Refuse rather than guess.
      if (!mineKnown) return;
      const supabase = getBrowserSupabase();
      if (!supabase) {
        setFailed(true);
        return;
      }
      setBusy(true);
      setFailed(false);
      const clearing = mine?.status === status;
      const ok = clearing
        ? await clearPresence(supabase)
        : await setPresence(supabase, {
            status,
            // Only 'going' may carry a bar; re-picking it is the pin sequence.
            barId: status === 'going' ? (mine?.barId ?? null) : null,
            audience: mine?.audience ?? 'friends',
            recipientIds: mine?.recipientIds ?? [],
          });
      if (ok) {
        await reloadMine();
        refresh();
        // The Stories rail's own-pin badge is a separate consumer of this row.
        announcePresenceChanged();
      } else {
        setFailed(true);
      }
      setBusy(false);
    },
    [busy, mine, mineKnown, reloadMine, refresh],
  );

  /**
   * STEP ONE OF THE PIN SEQUENCE: choosing the bar SELECTS it. It does not
   * write it (round 3, Codex HIGH: it used to publish on the tap, before anyone
   * was asked who should see it). The audience step opens on what the pin
   * already has, so a user changing only their spot re-confirms rather than
   * re-chooses; a new pinner starts at the contract's default.
   */
  const selectBar = useCallback(
    (barId: string): void => {
      setPendingBarId(barId);
      setPendingAudience(mine?.audience ?? 'friends');
      setPendingRecipients(mine?.recipientIds ?? []);
      setFailed(false);
      go('audience');
    },
    [mine, go],
  );

  /** Cancel drops the pending state and returns to the status screen. */
  const cancelPin = useCallback((): void => {
    setPendingBarId(null);
    setPendingRecipients([]);
    setPendingAudience('friends');
    goBackTo('status');
  }, [goBackTo]);

  /** Back from Pin your spot keeps the chosen bar; back from Where are you? drops it. */
  const stepBack = useCallback((): void => {
    if (step === 'audience') {
      goBackTo('where');
      return;
    }
    cancelPin();
  }, [step, goBackTo, cancelPin]);

  /**
   * STEP TWO: the confirmation, and the ONLY write in the sequence. Status, bar,
   * audience and recipients go together, so there is no instant at which the
   * pin exists under an audience nobody chose.
   */
  const confirmPin = useCallback(async (): Promise<void> => {
    if (busy || pendingBarId === null) return;
    // Never on a pin we have not read (S-05b panel, Fable, HIGH): the pending
    // audience was snapshotted from `mine`, and while the read is loading or
    // failed that snapshot is the DEFAULT, which would widen a live Custom pin.
    if (!mineKnown) return;
    // The held state is enforced HERE as well as on the button (R-02): Custom
    // with nobody picked must never reach the write, whatever the DOM says.
    if (isAudienceHeld(pendingAudience, pendingRecipients.length)) return;
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setFailed(true);
      return;
    }
    // The view this pin was composed in, captured before the first await.
    const startedAt = readEpoch.current;
    setBusy(true);
    setFailed(false);
    const ok = await setPresence(supabase, {
      status: 'going',
      barId: pendingBarId,
      audience: pendingAudience,
      recipientIds: pendingRecipients,
    });
    if (startedAt !== readEpoch.current) {
      setBusy(false);
      return;
    }
    if (ok) {
      setPendingBarId(null);
      setPendingRecipients([]);
      await reloadMine();
      refresh();
      announcePresenceChanged();
      // README §5: Pin it is the end of the sequence — back to Social, where
      // the header pin icon and Out tonight now reflect the write.
      router.push('/friends');
    } else {
      // The sequence STAYS OPEN on a failure: the chosen bar and audience are
      // still on screen to retry from.
      setFailed(true);
    }
    setBusy(false);
  }, [busy, mineKnown, pendingAudience, pendingBarId, pendingRecipients, reloadMine, refresh, router]);

  const writeAudience = useCallback(
    async (audience: PresenceAudience, recipientIds: readonly string[]): Promise<void> => {
      if (busy || !mine) return;
      const supabase = getBrowserSupabase();
      if (!supabase) {
        setFailed(true);
        return;
      }
      setBusy(true);
      setFailed(false);
      const ok = await setPresence(supabase, {
        status: mine.status,
        barId: mine.barId,
        audience,
        recipientIds,
      });
      if (ok) {
        await reloadMine();
        refresh();
        announcePresenceChanged();
      } else {
        setFailed(true);
      }
      setBusy(false);
    },
    [busy, mine, reloadMine, refresh],
  );

  /**
   * Changing the audience of a pin that is ALREADY LIVE. 'friends' and 'close'
   * are one tap. Custom needs a recipient list, and writing it without one is
   * refused server-side — so the tap opens Pin your spot on the live bar, with
   * the live recipients preselected, and Pin it re-sends the whole row.
   */
  const chooseAudience = useCallback(
    (audience: PresenceAudience): void => {
      if (audience === 'people') {
        if (!mine?.barId) return;
        setPendingBarId(mine.barId);
        setPendingAudience('people');
        setPendingRecipients(mine.recipientIds);
        setFailed(false);
        go('audience');
        return;
      }
      void writeAudience(audience, []);
    },
    [mine, writeAudience, go],
  );

  /**
   * The same choice inside the pin sequence, where nothing is live yet. README
   * §5: choosing Custom IS the choice — the row lights, the picker opens inline,
   * the count reads in words, and Pin it is HELD until someone is picked.
   */
  const choosePendingAudience = useCallback((audience: PresenceAudience): void => {
    setPendingAudience(audience);
    if (audience !== 'people') setPendingRecipients([]);
  }, []);

  const toggleRecipient = useCallback((id: string): void => {
    // A NEW ARRAY EVERY TIME — never mutate the held one.
    setPendingRecipients((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }, []);

  const myPin = mine ? describePresence(mine) : null;
  const myBar = myPin?.barId ? getBarById(myPin.barId) : null;
  const pendingBar = pendingBarId === null ? null : (getBarById(pendingBarId) ?? null);
  const signedOut = auth.status !== 'loading' && auth.status !== 'signed-in';
  // THE PUSHED STEPS ARE GATED LIKE THE ROW THAT OPENS THEM (S-05b panel,
  // Fable, HIGH): a deep link or a refresh on ?step=where must not offer the
  // bar picker to a visitor, or before the own-pin read has answered — the
  // pending audience is snapshotted from that read. And the audience step with
  // nothing chosen has nothing to show. (Refreshing mid-sequence drops the
  // pending pin — nothing was written, so nothing is lost.)
  const stepsOpen = mineKnown && !signedOut;
  const shown: PinStep = !stepsOpen || (step === 'audience' && pendingBarId === null) ? 'status' : step;

  useEffect(() => {
    // The URL says audience but there is nothing pending: say status in the
    // URL too, or a later swipe forward lands on a step that cannot render.
    if (step === 'audience' && pendingBarId === null) {
      setStep('status');
      router.replace(TONIGHT_PATH);
    }
  }, [step, pendingBarId, router]);

  const rowClass = (on: boolean): string =>
    [
      'flex w-full items-center justify-between gap-3 min-h-[60px] px-[18px] rounded-[20px] border text-left touch-manipulation transition-colors',
      on ? 'border-accent bg-accent/[0.10] text-text' : 'border-border bg-surface text-text',
    ].join(' ');

  return (
    <>
      <StepHeader step={shown} onBack={stepBack} />
      <div className="max-w-md mx-auto px-6 pt-2">
        {shown === 'where' ? (
          <WhereAreYouStep chosen={pendingBar} busy={busy} onPick={(bar) => selectBar(bar.id)} />
        ) : null}

        {shown === 'audience' && pendingBarId !== null ? (
          <PinYourSpotStep
            bar={pendingBar}
            barId={pendingBarId}
            audience={pendingAudience}
            recipients={pendingRecipients}
            // MUTUALS ONLY. D-C-37 intersects any narrowed audience with the
            // pinner's mutual friends server-side.
            friends={follows.mutuals}
            friendsLoading={follows.loading}
            friendsFailed={follows.circleFailed}
            busy={busy}
            onAudience={choosePendingAudience}
            onToggleRecipient={toggleRecipient}
            onConfirm={() => void confirmPin()}
            onCancel={cancelPin}
          />
        ) : null}

        {shown === 'status' ? (
          <div className="space-y-6" data-testid="presence-screen">
            <p className="text-[13px] leading-relaxed text-muted">
              Manual, always. Nothing here reads your location, and it all clears at 4 AM.
            </p>

            {signedOut ? (
              <div data-testid="presence-signed-out" className="rounded-3xl border border-border bg-surface p-5">
                <p className="text-sm leading-relaxed mb-3">
                  Sign in to say whether you&apos;re going out and to pin your spot.
                </p>
                <Link
                  href="/auth"
                  className="inline-flex items-center min-h-[44px] px-5 rounded-full border border-border font-display text-sm touch-manipulation hover:border-accent hover:text-accent transition-colors"
                >
                  Sign in
                </Link>
              </div>
            ) : null}

            <section aria-labelledby="presence-status-heading">
              <h2
                id="presence-status-heading"
                className="font-label text-[11px] font-bold uppercase tracking-[0.2em] text-muted mb-2.5"
              >
                Are you going out?
              </h2>
              <div className="space-y-2.5" role="group" aria-label="Your status tonight">
                {STATUS_ORDER.map((status) => {
                  const active = mine?.status === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={active}
                      // Disabled until the server has ANSWERED — unreadable and
                      // still-loading alike: every tap is a WRITE that would
                      // otherwise have to invent the audience. A visitor has no
                      // session to write with.
                      disabled={busy || !mineKnown || signedOut}
                      onClick={() => void choose(status)}
                      data-testid={`presence-status-${status}`}
                      className={rowClass(active)}
                    >
                      <span className="font-display text-base font-semibold">{PRESENCE_LABELS[status]}</span>
                      {/* The ✓ is ABSENT, not dimmed, on the rows that are not chosen. */}
                      {active ? (
                        <span aria-hidden="true" data-testid="presence-status-check" className="text-accent font-bold shrink-0">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {/* WE DO NOT KNOW YOUR PIN — and the two reasons say so differently.
                  Never the unset row, which invites a tap that would overwrite a
                  live pin with a default audience (V8-R-OPS-005). */}
              {minePin.kind === 'loading' ? (
                <p className="text-xs text-muted mt-3" role="status" data-testid="my-pin-loading">
                  Checking your pin tonight…
                </p>
              ) : null}
              {minePin.kind === 'unreadable' ? (
                <p className="text-xs text-muted mt-3" role="status" data-testid="my-pin-error">
                  Couldn&apos;t check your pin tonight. Pull again in a moment — nothing has been changed.
                </p>
              ) : null}
              {mine ? (
                <p className="text-sm text-muted mt-3" data-testid="my-pin">
                  {myBar ? (
                    <>
                      <span className="text-text font-display">{myBar.name}</span>
                      {' · Pinned now'}
                    </>
                  ) : (
                    `${PRESENCE_LABELS[mine.status]} · no bar pinned`
                  )}
                </p>
              ) : null}
            </section>

            {mineKnown && !signedOut ? (
              <section aria-labelledby="presence-where-heading">
                <h2
                  id="presence-where-heading"
                  className="font-label text-[11px] font-bold uppercase tracking-[0.2em] text-muted mb-2.5"
                >
                  Where are you?
                </h2>
                {/* V8-R-PRE-003, available whatever the status: pinning sets Going out. */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => go('where')}
                  data-testid="pin-my-spot"
                  className="flex w-full items-center gap-3.5 p-4 rounded-[20px] border border-border bg-surface text-left touch-manipulation hover:border-accent transition-colors"
                >
                  <span
                    aria-hidden="true"
                    className={[
                      'shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center border',
                      myBar ? 'border-accent bg-accent/[0.14] text-accent' : 'border-border text-muted',
                    ].join(' ')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="w-[19px] h-[19px]">
                      <path d="M12 21s-6-5.2-6-10.5a6 6 0 0 1 12 0C18 15.8 12 21 12 21Z" />
                      <circle cx="12" cy="10.5" r="2.2" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold truncate">
                      {myBar ? myBar.name : 'Pin my spot'}
                    </span>
                    <span className="block text-xs text-muted truncate mt-px">
                      {myBar
                        ? `${displayHood(myBar.neighborhood)} · ${AUDIENCE_LABELS[mine?.audience ?? 'friends']} can see it`
                        : 'Optional — a status without a place is fine'}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-accent shrink-0">›</span>
                </button>

                {/* Who can see my pin tonight? (V8-R-PRE-002 / D-C-37.) Only once a
                    pin is live; words, never colour alone. */}
                {mine && myBar ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Who can see my pin tonight?">
                      {AUDIENCE_ORDER.map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={mine.audience === value}
                          disabled={busy}
                          onClick={() => chooseAudience(value)}
                          data-testid={`pin-audience-${value}`}
                          className={[
                            'min-h-[44px] touch-manipulation px-4 rounded-full text-xs font-display border transition-colors',
                            mine.audience === value ? 'border-accent text-accent' : 'border-border text-muted hover:text-text',
                          ].join(' ')}
                        >
                          {AUDIENCE_LABELS[value]}
                        </button>
                      ))}
                    </div>
                    {mine.audience === 'people' ? (
                      <p className="text-xs text-muted" data-testid="pin-audience-count">
                        {mine.recipientIds.length}{' '}
                        {mine.recipientIds.length === 1 ? 'person' : 'people'} can see this pin tonight.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <p className="text-xs leading-relaxed text-muted mt-2.5">Pinning a bar sets you to Going out.</p>
              </section>
            ) : null}
          </div>
        ) : null}

        {failed ? (
          <p className="text-xs text-muted mt-4" role="status">
            That didn&apos;t save — try again in a moment.
          </p>
        ) : null}
      </div>
    </>
  );
}
