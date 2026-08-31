'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
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
import { PinAudienceDialog, PinBarDialog } from '@/lib/presence/PinDialogs';
import { usePinnedHandles, announcePresenceChanged } from './usePinnedHandles';

/**
 * Social · Tonight — current awareness (V8-R-SOC-001, V8-R-PRE-001..005).
 *
 * Two parts, in the approved order: the compact pin row for YOUR status, then
 * who else is out. Both obey the same rules:
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
 * The three-state read matters: "still loading", "nobody is out" and "could not
 * load" render differently. Showing the empty state on a failed fetch would
 * tell the viewer their friends are staying in (V8-R-OPS-005).
 */

const STATUS_ORDER: readonly PresenceStatus[] = ['going', 'maybe', 'not-going'];

/**
 * The audience choices, in the contract's order (V8-R-PRE-002).
 *
 * 'close' sits between them as the mutual-follow narrowing this branch already
 * shipped. The contract's own third top-level choice — a single named GROUP —
 * is ABSENT because there is no groups model on this branch to name one; see
 * `PresenceAudience` and migration 0068 section 3c, where the gap is recorded
 * rather than faked with a control that could not resolve a group.
 */
const AUDIENCE_ORDER: readonly PresenceAudience[] = [
  'friends',
  'close',
  'people',
];

/** '2026-07-25T02:00:00Z' → '10:00 PM'. Empty string when unparseable. */
function timeLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(at);
}

/**
 * WHAT WE KNOW ABOUT THE VIEWER'S OWN PIN, as three states that cannot collapse.
 *
 * Round 2 separated "you have no pin" from "we could not read your pin", which
 * closed the write-with-a-default-audience hole for a FAILED read. Round 3
 * (Codex gate, HIGH) found the third state was still missing: while the very
 * first `get_my_presence` was in flight, the component was in neither of the two
 * — `mine` was null and `mineUnreadable` false, i.e. exactly the shape of "no
 * pin" — so the status pills rendered ENABLED, and a tap in that window wrote
 * `audience: 'friends'` with an empty recipient list over a live 'close' or
 * 'people' pin. `set_night_presence` replaces the row wholesale, so the pin
 * widened to every follower and lost its recipients before the read that would
 * have said so came back.
 *
 * A union rather than a second boolean: the pills read `kind === 'ok'`, so a
 * fourth state added later cannot silently default to "safe to write".
 */
type MinePinState =
  /** The first read has not answered yet. We know nothing. */
  | { kind: 'loading' }
  /** The server answered: `presence` is the pin, or null for no pin at all. */
  | { kind: 'ok'; presence: MyPresence | null }
  /** The read failed. Different from "no pin", and never written over. */
  | { kind: 'unreadable' };

export default function TonightPresence(): JSX.Element {
  // 0019 swap-day rule: this component renders getBarById lookups, so it
  // subscribes to a live server-catalog swap.
  useBars();
  const auth = useAuth();
  const { loading, rows, night, refresh } = usePinnedHandles();
  // The mutual-follow list the 'people' audience picks from. Read here rather
  // than inside the dialog so the dialog stays a presentation of a list it is
  // given, and so "still loading" is distinguishable from "you have nobody".
  const follows = useFollows();
  const [minePin, setMinePin] = useState<MinePinState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pickingBar, setPickingBar] = useState(false);
  /**
   * Which flow opened the recipient picker: the live pin's audience row, or the
   * pin sequence's own audience step. Both need the same dialog and they write
   * to different places, so the dialog cannot know on its own.
   */
  const [pickingPeople, setPickingPeople] = useState<null | 'live' | 'pending'>(
    null,
  );
  /**
   * A bar the user has CHOSEN but not yet pinned, plus the audience they are
   * choosing for it. Nothing here has been written; see `pinSequence` below.
   */
  const [pendingBarId, setPendingBarId] = useState<string | null>(null);
  const [pendingAudience, setPendingAudience] =
    useState<PresenceAudience>('friends');
  const [pendingRecipients, setPendingRecipients] = useState<readonly string[]>(
    [],
  );

  const userId = auth.status === 'signed-in' ? auth.user.id : null;

  /**
   * WHICH READ IS ALLOWED TO PAINT — the pair (account, night).
   *
   * Round 3 (Codex gate, HIGH): `reloadMine` called `setMinePin` unconditionally
   * after its await, so a read started for account A could settle after a
   * sign-out and put A's pinned bar and audience back on screen for whoever was
   * looking at the page. The effect below clears the row first, and the stale
   * completion then restored it. A night rollover is the same defect one axis
   * over: the answer is about a night that is no longer the one being shown.
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
    //
    // Round 3 collapsed `unset` into `unreadable` with a two-way ternary, which
    // is the whole write path for every account that has not pinned yet: zero
    // rows tonight is what `get_my_presence` returns for EVERY account on EVERY
    // night before its first pin, so the pills sat permanently disabled behind
    // "couldn't check your pin" and nobody could ever set a first status. The
    // switch is exhaustive on purpose — `MyPresenceRead` gaining a fourth kind
    // must not compile until someone says which of these three it is.
    switch (read.kind) {
      case 'ok':
        setMinePin({ kind: 'ok', presence: read.presence });
        return;
      case 'unset':
        // The server ANSWERED. There is no pin, which is a fact we may write
        // over with the contract's default audience.
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
    // ...and what is on screen belongs to it too. Back to "we know nothing"
    // rather than to "no pin", which is a claim about this account we have not
    // made yet.
    setMinePin({ kind: 'loading' });
    // AND SO DOES EVERYTHING HALF-COMPOSED (round-3 panel, both gates). The
    // pin sequence holds a bar, an audience and a recipient list that have not
    // been written yet, and none of it survived a check that it still belongs
    // to the account and night on screen: account A could compose a pin, sign
    // out, and B's session would find A's bar and A's recipients still on
    // screen with a live "Pin it" that sends them under B. The night rollover
    // is the same defect on the other axis — confirming after 4:00 AM would
    // write the previous night's choice into the new one.
    //
    // Cleared HERE, in the same effect that moves the epoch, so the two can
    // never disagree about which view this state belongs to.
    setPendingBarId(null);
    setPendingAudience('friends');
    setPendingRecipients([]);
    setPickingBar(false);
    setPickingPeople(null);
    setFailed(false);
    void reloadMine();
  }, [reloadMine]);

  const mine = minePin.kind === 'ok' ? minePin.presence : null;
  /** The server has answered. The ONLY state in which a write may be built. */
  const mineKnown = minePin.kind === 'ok';

  /**
   * One tap sets a status; tapping the lit one clears it (V8-R-PRE-005:
   * "tapping the pinned row again to change or clear it").
   *
   * Failure is REPORTED, never assumed away: if the write does not land, the
   * row says so and the previous state stands. Optimistically flipping the
   * pill would tell the user their friends can see a pin that was never
   * written.
   */
  const choose = useCallback(
    async (status: PresenceStatus): Promise<void> => {
      if (busy) return;
      // A write built on a pin we have not read — because the read failed, or
      // because it has not answered yet — would carry a DEFAULT audience over
      // whatever the server is actually enforcing. Refuse rather than guess;
      // the row already says which of the two it is.
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
            // Changing the STATUS never silently keeps a bar that no longer
            // applies: only 'going' may carry one, and re-picking the bar is
            // the "Where are you tonight?" step below.
            barId: status === 'going' ? (mine?.barId ?? null) : null,
            audience: mine?.audience ?? 'friends',
            recipientIds: mine?.recipientIds ?? [],
          });
      if (ok) {
        await reloadMine();
        refresh();
        // Tell every other reader of this row — the Stories rail's own-pin badge is a
        // separate consumer and would otherwise sit a whole night behind this write.
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
   * write it.
   *
   * Round 3 (Codex gate, HIGH). This used to send `set_night_presence` the
   * moment a bar was tapped, carrying `mine?.audience ?? 'friends'`, and then
   * close the dialog — so a first-time pinner's location went live to every
   * follower before they were ever asked who should see it, and the audience
   * step the docstring promised did not exist. V8-R-PRE-003 → V8-R-PRE-002 is
   * two steps in one direction: "tapping a result selects that bar and advances
   * straight to the audience step". Selecting is not publishing.
   *
   * So the bar is held here, the audience step renders, and ONE write happens
   * on confirmation — which also means pinning from Maybe never passes through
   * the invalid "at a bar, not going out" pair the RPC and the check constraint
   * both refuse.
   */
  const selectBar = useCallback(
    (barId: string): void => {
      setPendingBarId(barId);
      // The audience step opens on what the pin already has, so a user changing
      // only their spot re-confirms rather than re-chooses. A new pinner starts
      // at the contract's default and still has to press Pin it.
      setPendingAudience(mine?.audience ?? 'friends');
      setPendingRecipients(mine?.recipientIds ?? []);
      setFailed(false);
      setPickingBar(false);
    },
    [mine],
  );

  const cancelPin = useCallback((): void => {
    setPendingBarId(null);
    setPendingRecipients([]);
    setPickingPeople(null);
  }, []);

  /**
   * STEP TWO: the confirmation, and the ONLY write in the sequence. Status, bar,
   * audience and recipients go together, so there is no instant at which the
   * pin exists under an audience nobody chose.
   */
  const confirmPin = useCallback(async (): Promise<void> => {
    if (busy || pendingBarId === null) return;
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setFailed(true);
      return;
    }
    // The view this pin was composed in, captured before the first await. A
    // sign-out or a rollover landing mid-write means neither the success nor
    // the failure belongs to whatever is on screen now.
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
    } else {
      // The sequence STAYS OPEN on a failure: the user's chosen bar and
      // audience are still on screen to retry from, rather than being thrown
      // away with a banner.
      setFailed(true);
    }
    setBusy(false);
  }, [busy, pendingAudience, pendingBarId, pendingRecipients, reloadMine, refresh]);

  const writeAudience = useCallback(
    async (
      audience: PresenceAudience,
      recipientIds: readonly string[],
    ): Promise<void> => {
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
        // The audience decides who ELSE can see this pin, so the circle list
        // and the rail are both downstream of it — not just this panel.
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
   * are one tap. 'people' cannot be: it needs a recipient list, and writing it
   * without one is refused server-side rather than falling back to a wider
   * audience — so the tap opens the picker instead of sending a request that
   * can only fail.
   */
  const chooseAudience = useCallback(
    (audience: PresenceAudience): void => {
      if (audience === 'people') {
        setPickingPeople('live');
        return;
      }
      void writeAudience(audience, []);
    },
    [writeAudience],
  );

  /**
   * The same choice inside the pin sequence, where nothing is live yet, so it
   * only records what the confirmation will send.
   */
  const choosePendingAudience = useCallback(
    (audience: PresenceAudience): void => {
      if (audience === 'people') {
        setPickingPeople('pending');
        return;
      }
      setPendingAudience(audience);
      setPendingRecipients([]);
    },
    [],
  );

  const myPin = mine ? describePresence(mine) : null;
  const myBar = myPin?.barId ? getBarById(myPin.barId) : null;
  const pendingBar = pendingBarId === null ? null : getBarById(pendingBarId);

  return (
    <div className="space-y-8" data-testid="social-tonight">
      {/* Your status — the compact pin row directly under the stories rail
          (V8-R-PRE-001 entry point). */}
      <section>
        <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
          You tonight
        </h2>
        <div
          className="flex items-center gap-2"
          role="group"
          aria-label="Your status tonight"
        >
          {STATUS_ORDER.map((status) => {
            const active = mine?.status === status;
            return (
              <button
                key={status}
                type="button"
                aria-pressed={active}
                // Disabled until the server has ANSWERED — unreadable and
                // still-loading alike. Every one of these taps is a WRITE that
                // would otherwise have to invent the audience, and inventing it
                // over a live 'close' or 'people' pin widens it to everyone.
                disabled={busy || !mineKnown}
                onClick={() => void choose(status)}
                className={[
                  'min-h-[44px] touch-manipulation px-5 rounded-full font-display text-sm border transition-colors disabled:opacity-60',
                  active
                    ? 'bg-transparent border-accent text-accent'
                    : 'bg-transparent border-border text-muted hover:text-text',
                ].join(' ')}
              >
                {PRESENCE_LABELS[status]}
              </button>
            );
          })}
        </div>

        {/* WE DO NOT KNOW YOUR PIN — and the two reasons say so differently.
            Never the unset row, which invites a tap that would overwrite a live
            pin with a default audience (V8-R-OPS-005 — the same rule the circle
            list below follows). */}
        {minePin.kind === 'loading' ? (
          <p
            className="text-xs text-muted mt-3"
            role="status"
            data-testid="my-pin-loading"
          >
            Checking your pin tonight…
          </p>
        ) : null}
        {minePin.kind === 'unreadable' ? (
          <p
            className="text-xs text-muted mt-3"
            role="status"
            data-testid="my-pin-error"
          >
            Couldn&apos;t check your pin tonight. Pull again in a moment —
            nothing has been changed.
          </p>
        ) : null}

        {mine ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-muted" data-testid="my-pin">
              {myBar ? (
                <>
                  <span className="text-text font-display">{myBar.name}</span>
                  {' · Pinned now'}
                </>
              ) : (
                `${PRESENCE_LABELS[mine.status]} · no bar pinned`
              )}
            </p>

            {/* V8-R-PRE-003, THE STEP THAT WAS MISSING. Choosing Going out sets
                a status; it does not put you anywhere. Without this control a
                new pinner could never create a bar-level pin at all, because
                the only bar the write could carry was one they already had. */}
            {mine.status === 'going' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setPickingBar(true)}
                data-testid="pin-my-spot"
                className="min-h-[44px] touch-manipulation px-4 rounded-full text-xs font-display border border-border text-muted hover:text-text transition-colors disabled:opacity-60"
              >
                {myBar ? 'Change my spot' : 'Pin my spot'}
              </button>
            ) : null}

            {/* Who can see my pin tonight? (V8-R-PRE-002 / D-C-37.) */}
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label="Who can see my pin tonight?"
            >
              {AUDIENCE_ORDER.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mine.audience === value}
                  disabled={busy}
                  onClick={() => chooseAudience(value)}
                  data-testid={`pin-audience-${value}`}
                  className={[
                    'min-h-[44px] touch-manipulation px-4 rounded-full text-xs font-display border transition-colors disabled:opacity-60',
                    mine.audience === value
                      ? 'border-accent text-accent'
                      : 'border-border text-muted hover:text-text',
                  ].join(' ')}
                >
                  {AUDIENCE_LABELS[value]}
                </button>
              ))}
            </div>

            {/* WHO, IN WORDS. An audience of "some people" that does not say how
                many is not an audience the pinner can check. */}
            {mine.audience === 'people' ? (
              <p className="text-xs text-muted" data-testid="pin-audience-count">
                {mine.recipientIds.length}{' '}
                {mine.recipientIds.length === 1 ? 'person' : 'people'} can see
                this pin tonight.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* STEP TWO OF THE PIN SEQUENCE, in the page rather than in a dialog.
            Nothing here is live: the bar is chosen, the audience is being
            chosen, and only "Pin it" writes. That is the whole fix for a pin
            that used to go out to every follower the instant a bar was tapped
            (V8-R-PRE-003 → V8-R-PRE-002). */}
        {pendingBarId !== null ? (
          <div
            className="mt-4 rounded-2xl border border-border p-4 space-y-3"
            data-testid="pin-audience-step"
          >
            <p className="text-sm">
              <span className="font-display text-text">
                {pendingBar?.name ?? pendingBarId}
              </span>
              {' — who can see this?'}
            </p>
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label="Who can see this pin tonight?"
            >
              {AUDIENCE_ORDER.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={pendingAudience === value}
                  disabled={busy}
                  onClick={() => choosePendingAudience(value)}
                  data-testid={`pin-pending-audience-${value}`}
                  className={[
                    'min-h-[44px] touch-manipulation px-4 rounded-full text-xs font-display border transition-colors disabled:opacity-60',
                    pendingAudience === value
                      ? 'border-accent text-accent'
                      : 'border-border text-muted hover:text-text',
                  ].join(' ')}
                >
                  {AUDIENCE_LABELS[value]}
                </button>
              ))}
            </div>
            {pendingAudience === 'people' ? (
              <p
                className="text-xs text-muted"
                data-testid="pin-pending-audience-count"
              >
                {pendingRecipients.length}{' '}
                {pendingRecipients.length === 1 ? 'person' : 'people'} will see
                this pin tonight.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                // 'people' with nobody selected is refused server-side rather
                // than widened, so the confirmation does not offer to send it.
                disabled={
                  busy ||
                  (pendingAudience === 'people' && pendingRecipients.length === 0)
                }
                onClick={() => void confirmPin()}
                data-testid="pin-confirm"
                className="min-h-[44px] touch-manipulation px-5 rounded-full text-sm font-display border border-accent text-accent transition-colors disabled:opacity-60"
              >
                {busy ? 'Pinning…' : 'Pin it'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={cancelPin}
                data-testid="pin-cancel"
                className="min-h-[44px] touch-manipulation px-5 rounded-full text-sm font-display border border-border text-muted hover:text-text transition-colors disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {failed ? (
          <p className="text-xs text-muted mt-2" role="status">
            That didn&apos;t save — try again in a moment.
          </p>
        ) : null}
      </section>

      {/* Who else is out. */}
      <section>
        <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
          Out tonight
        </h2>
        <CircleList
          loading={loading}
          rows={rows}
          signedOut={auth.status !== 'loading' && auth.status !== 'signed-in'}
        />
      </section>

      {/* THE TWO STEPS OF THE PIN SEQUENCE (V8-R-PRE-003 then V8-R-PRE-002).
          Mounted only while open: `useModalDialog` marks the rest of the page
          `inert` for as long as it lives, so a dialog left mounted-and-hidden
          would take the page down with it. */}
      {pickingBar ? (
        <PinBarDialog
          busy={busy}
          onClose={() => setPickingBar(false)}
          // SELECTS, does not pin. The audience step above is step two.
          onPick={(bar) => selectBar(bar.id)}
        />
      ) : null}

      {pickingPeople !== null ? (
        <PinAudienceDialog
          // MUTUALS ONLY. D-C-37 intersects any narrowed audience with the
          // pinner's mutual friends server-side, so anyone else shown here
          // would be a recipient the server had already dropped.
          friends={follows.mutuals}
          friendsLoading={follows.loading}
          // THE FAILED READ IS ITS OWN STATE (round-6 panel, Codex, MEDIUM).
          // Without it an empty `mutuals` from a failed `get_following` was
          // rendered as "you have no mutual friends" — the same lie CircleList
          // refuses to tell about the presence read a few lines up.
          friendsFailed={follows.circleFailed}
          initialSelection={
            pickingPeople === 'pending'
              ? pendingRecipients
              : (mine?.recipientIds ?? [])
          }
          busy={busy}
          onClose={() => setPickingPeople(null)}
          onConfirm={(recipientIds) => {
            const flow = pickingPeople;
            setPickingPeople(null);
            // The pin sequence has not written anything yet, so its recipients
            // are recorded and sent once, by "Pin it".
            if (flow === 'pending') {
              setPendingAudience('people');
              setPendingRecipients(recipientIds);
              return;
            }
            void writeAudience('people', recipientIds);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The four states, kept in one place so no caller can accidentally render the
 * empty state for a failed read — or for a visitor who has no circle to read.
 */
function CircleList({
  loading,
  rows,
  signedOut,
}: {
  loading: boolean;
  rows: ReturnType<typeof usePinnedHandles>['rows'];
  signedOut: boolean;
}): JSX.Element {
  if (loading) {
    return (
      <p className="text-muted text-sm" role="status">
        Checking who&apos;s out…
      </p>
    );
  }

  // SIGNED OUT IS ITS OWN STATE. usePinnedHandles hands back `[]` here, and its
  // own header says why that is not an empty circle: "there is simply no circle
  // to ask about". Rendering "No friends out yet tonight" at a visitor is the
  // same category of lie as rendering it on a failed read — a claim about
  // friends we never asked about, made to someone who has not told us who they
  // are (V8-R-OPS-005). The forward path differs too: a visitor cannot invite
  // anyone until they sign in.
  if (signedOut) {
    return (
      <div data-testid="presence-signed-out">
        <p className="text-muted text-sm mb-3">
          Sign in to see who&apos;s out and pin your own spot.
        </p>
        <Link
          href="/auth"
          className="inline-flex items-center min-h-[44px] px-5 rounded-full border border-border font-display text-sm touch-manipulation hover:border-accent hover:text-accent transition-colors"
        >
          Sign in
        </Link>
      </div>
    );
  }

  // Load FAILURE. Never "nobody is out" — that would be a claim about the
  // viewer's friends that we have no evidence for (V8-R-OPS-005).
  if (rows === null) {
    return (
      <p className="text-muted text-sm" role="status" data-testid="presence-error">
        Couldn&apos;t load tonight. Pull again in a moment.
      </p>
    );
  }

  // Genuinely nobody: offer the forward path rather than an empty box, and
  // show no story ring at all (V8-R-SOC-001, V8-R-OPS-005).
  if (rows.length === 0) {
    return (
      <div data-testid="presence-empty">
        <p className="text-muted text-sm mb-3">No friends out yet tonight.</p>
        <Link
          href="/friends/following"
          className="inline-flex items-center min-h-[44px] px-5 rounded-full border border-border font-display text-sm touch-manipulation hover:border-accent hover:text-accent transition-colors"
        >
          Invite friends
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-2" data-testid="presence-list">
      {rows.map((person) => {
        const { barId, note } = describePresence(person);
        const bar = barId ? getBarById(barId) : null;
        const who = person.displayName?.trim()
          ? person.displayName.trim()
          : `@${person.handle}`;
        const when = timeLabel(person.updatedAt);
        return (
          <li
            key={person.handle}
            className="bg-surface border border-border rounded-2xl px-4 py-3"
          >
            {/* Lead with the bar. When there is none, lead with the person —
                never with a venue nobody claimed. */}
            <p className="font-display text-sm truncate">
              {bar ? bar.name : who}
            </p>
            <p className="text-muted text-xs truncate">
              {bar ? `${who} · ${note}` : note}
              {when ? ` · ${when}` : ''}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
