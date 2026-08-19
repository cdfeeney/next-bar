'use client';

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { nycNightKey } from '@/lib/nightKey';
import { createNightOut, getNightOut, inviteToNightOut } from '@/lib/nightOuts.server';

/**
 * A plan that was CREATED but never opened, parked where a route change cannot
 * take it (fix round 1, Codex).
 *
 * Component state alone was the whole recovery story, and it dies on unmount —
 * which a tab tap, a back gesture or any client-side navigation performs. The
 * user then returns to an armed Start button with no memory of the plan they
 * already made, and the next tap creates a SECOND plan for the same night. That
 * is the exact duplicate-plan defect criterion 4 exists to prevent, reached by a
 * different door than the one that was closed.
 *
 * localStorage, not sessionStorage. sessionStorage was the original choice and
 * the reasoning was "an unopened plan is one tab's in-flight intent, it should
 * not outlive the session". Cold-panel round 2 (Codex) showed that reasoning
 * defeats the criterion it was written to serve: sessionStorage dies with the
 * TAB, so a create that succeeded while its follow-up read failed is forgotten
 * the moment the user closes the tab. Reopen the page the same night, press
 * Start, and `create_night_out` — which has no per-(owner, night) uniqueness —
 * makes a SECOND plan. That is criterion 4's exact defect, reached by closing a
 * tab instead of by navigating within one.
 *
 * The two properties that made sessionStorage feel safe now live in the VALUE,
 * not the store: the record is keyed by user id (so it cannot leak to another
 * account) and stamped with its night key (so it cannot outlive the night it
 * belongs to, and stale nights are pruned on every write). What is left is a
 * record that survives exactly as long as it is still true.
 *
 * (The plan is NOT yet reachable from a plan list: no surface lists plans you
 * own. That gap is recorded as a residual product gap in
 * V8-3-HANDOFF-2026-08-16b.md, which is why this recovery path carries more
 * weight than it looks like it should.)
 */
const STARTED_KEY = 'next-bar:started-night-out:v1';

/**
 * Real account ids only. The consensus list mixes followed friends (profile
 * UUIDs) with demo entries whose id is a HANDLE, and with the literal
 * YOU_ID 'you'. night_out_members is FK-bound to profiles, so anything that is
 * not a uuid would fail at the database — silently, since invite returns false.
 * Filtering here keeps that from ever being attempted.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * WHOSE plan, and for WHICH night. Round 2 filed the unscoped version twice.
 *
 * Claude (HIGH): the store is per TAB or per ORIGIN, never per account, and
 * this key is in no wipe set. So user A parks an
 * unopened plan, signs out, and user B signing in to the same tab inherits A's
 * plan id: Start is disabled, "Open it" silently no-ops because getNightOut
 * returns null under B's RLS, and nothing ever clears the key. B cannot create a
 * night out for the rest of the session.
 *
 * Codex, independently: also unscoped by night, so a browser reopened tomorrow
 * keeps Start disabled for yesterday's plan. Now that the record outlives the
 * tab, the night stamp is what bounds it — it is load bearing, not defensive.
 *
 * Both are the same missing idea — a parked plan is only meaningful for the
 * identity and the night that created it.
 */
type ParkedPlan = { planId: string; nightKey: string };

/**
 * One record PER USER, under one literal key.
 *
 * Round 1 of this cycle, filed by BOTH lanes: a single slot meant the last
 * writer won. "Ignore another account's record" protected owner A only while B
 * *looked* — the moment B successfully created their own plan, rememberStarted
 * overwrote A's record and the subsequent open cleared it. A returned the same
 * night to an armed Start with no recovery, and the next tap made exactly the
 * duplicate plan criterion 4 exists to prevent, with A's first plan unreachable
 * because no surface lists plans you own.
 *
 * A per-user KEY (`...:v1:${userId}`) is the obvious shape and is forbidden
 * here: storageInventory.test.ts fails any interpolated storage key, because a
 * computed key cannot be seen by the data-continuity registry that governs
 * account wipes. That constraint is right, so the scoping goes INSIDE the value
 * instead — one literal key, a map keyed by user id.
 */
type ParkedByUser = Record<string, ParkedPlan>;

/**
 * Last-resort store for when the store throws (Safari private mode at quota,
 * some webviews).
 *
 * Codex (round 2): a purely best-effort write left criterion 4 unfixed exactly
 * where storage is unavailable — the duplicate-plan bug came back for those
 * users while the code looked like it had been handled. A module-level value
 * lives as long as the JS context, which is precisely the span a route change
 * unmounts a component across, so it closes the same window without pretending
 * to be durable.
 */
let inMemoryParked: ParkedByUser = {};
/**
 * Did the last write actually land? A WRITABLE store is authoritative: if it
 * says nothing is parked, nothing is parked. The in-memory copy is consulted
 * only when the store could not be written or could not be read — otherwise a
 * stale module-level value would outrank the real answer and re-offer a
 * recovery the user has already finished with.
 */
let storageUsable = true;

/**
 * Accounts with a create RPC in flight, module-scoped on purpose.
 *
 * Cycle 3 round 1, both lanes. A per-component ref died with the instance, and
 * nothing is parked until the create RESOLVES — so tapping Start, navigating
 * away before the RPC answered, and coming back gave a remounted component no
 * parked record and no in-flight marker. Start was armed, a second tap called
 * create_night_out again, and 0044 has no per-(owner, night) uniqueness, so the
 * server happily made a second plan. The first create's dead closure then parked
 * plan #1 over the newer one's slot.
 *
 * That is the exact symmetric twin of the read-in-flight window this component
 * already closes, and the one unmount case the test file never covered — every
 * unmount test held the READ, never the CREATE.
 *
 * Module scope is the same reasoning as `inMemoryParked` directly above: the
 * span that must be covered is the JS context, not the component instance.
 */
const creatingOwners = new Set<string>();

/**
 * Live instances have to be TOLD when a create settles.
 *
 * Cycle 3 round 2, both lanes: a component remounted mid-create derived
 * `busy` from `creatingOwners` and then never heard anything again — the create
 * resolved inside the DEAD instance's closure, parked the plan and cleared the
 * marker, but every setState there was a no-op and the live instance's effect
 * deps ([userId]) never changed. The screen sat on a disabled "Starting…" with
 * no recovery affordance while module state said the plan was parked and ready.
 *
 * Safe direction — no duplicate is possible — but a stuck, self-contradicting
 * screen until the user happens to navigate away and back. A module-level
 * version read through useSyncExternalStore is the ordinary React 18 answer for
 * state that lives outside the tree.
 */
let creatingVersion = 0;
const creatingListeners = new Set<() => void>();

/**
 * ANOTHER TAB parked a plan. Round-2 panel (Codex, medium).
 *
 * Moving the record to localStorage made it visible to every tab, but visible
 * is not the same as noticed: a tab that was already mounted re-derives its
 * parked state only from `creatingTick`, which is module-scoped and therefore
 * per-realm. So tab A could create a plan, fail its follow-up read and park it,
 * while tab B sat on an armed Start with no idea — and B's tap made the second
 * plan criterion 4 exists to prevent.
 *
 * The `storage` event is the platform's own answer: it fires in every OTHER tab
 * of the origin on a write. Routing it into the SAME tick the local path uses
 * means there is one way to say "re-derive what is parked", not two.
 *
 * What this does NOT close, stated rather than implied: two tabs tapping Start
 * within the same instant, before either has parked anything. Nothing on the
 * client can serialize that — it needs per-(owner, night) uniqueness in
 * `create_night_out`, which no finding in this goal names. Recorded as a
 * residual gap in V8-3-HANDOFF-2026-08-16b.md.
 */
/**
 * Accounts whose parked record another realm REMOVED while our create was still
 * in flight (round-5 panel, Codex).
 *
 * A record disappearing elsewhere mid-create means the answer we are about to
 * write is already stale: the owner opened that plan in the other tab, or their
 * account was erased. Writing it back re-offers a recovery the user has
 * finished with, or resurrects identifiers a wipe just removed.
 *
 * The test is a PRESENT -> ABSENT transition for that specific owner, read from
 * the event's own `oldValue`/`newValue`. "Absent now" alone is not the test and
 * getting that wrong would be worse than the bug: our own create has not parked
 * anything yet, so any other account's park would look like our abandonment and
 * silently discard a real recovery record.
 */
const abandonedCreates = new Set<string>();

function ownersIn(raw: string | null): Set<string> {
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return new Set();
    return new Set(Object.keys(parsed as Record<string, unknown>));
  } catch {
    return new Set();
  }
}

/**
 * The account-cache owner marker. `clearAccountCache` removes it, and account
 * DELETION is one of the two callers; an ordinary sign-out deliberately seals
 * rather than clears, so this is not a sign-out signal.
 *
 * Round 9 (Codex, re-filing a gap this goal had recorded as unclosable). The
 * earlier reasoning — "no diff of the parked key can distinguish a create that
 * never parked from an ordinary concurrent write, and a tombstone naming the
 * deleted user would be the residue deletion exists to remove" — was too
 * narrow. It only ever looked at diffs of the parked key. Deletion also removes
 * THIS key, which crosses realms through the same `storage` event and names
 * nobody, so the signal existed the whole time.
 *
 * The literal is repeated from accountCache on purpose: storage keys must appear
 * as literals to stay visible to `storageInventory.test.ts`.
 */
const ACCOUNT_OWNER_KEY = 'next-bar:account:owner:v1';

function onCrossTabStorage(event: StorageEvent): void {
  // A null key means the whole store was cleared, which invalidates everything.
  const wholeStoreCleared = event.key === null;
  const ownerWiped =
    wholeStoreCleared
    || (event.key === ACCOUNT_OWNER_KEY && event.newValue === null);
  if (!wholeStoreCleared && event.key !== STARTED_KEY && !ownerWiped) return;
  if (creatingOwners.size > 0) {
    if (ownerWiped) {
      // An account cache was destroyed elsewhere. Nothing in flight has a
      // record yet, so there is no transition to read — the wipe itself is the
      // answer, and re-parking after it would restore identifiers the strongest
      // erase in the app has just removed.
      for (const owner of creatingOwners) abandonedCreates.add(owner);
    } else {
      const before = ownersIn(event.oldValue);
      const after = ownersIn(event.newValue);
      for (const owner of creatingOwners) {
        if (before.has(owner) && !after.has(owner)) abandonedCreates.add(owner);
      }
    }
  }
  markCreatingChanged();
}

function subscribeCreating(listener: () => void): () => void {
  creatingListeners.add(listener);
  return () => {
    creatingListeners.delete(listener);
  };
}

function getCreatingVersion(): number {
  return creatingVersion;
}

function markCreatingChanged(): void {
  creatingVersion += 1;
  for (const listener of creatingListeners) listener();
}

/** Every parked record in the store, validated. Unreadable input yields {}. */
function readAll(): ParkedByUser {
  // A store we could not WRITE is not a source of truth, whatever it returns.
  //
  // Round 2, filed by both lanes: this consulted `storageUsable` only when the
  // read came back null, which fails in exactly the environment the fallback
  // exists for. Safari at quota throws on setItem while getItem keeps serving
  // the last persisted value — so after a park, a quota failure, and an open,
  // the stale map outranked the fresh in-memory one and resurrected a recovery
  // for a plan the user had already opened. The comment on `storageUsable`
  // claimed this was handled; the code only handled the empty case.
  if (!storageUsable) return inMemoryParked;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STARTED_KEY);
  } catch {
    return inMemoryParked;
  }
  if (raw === null) return {};
  const out: ParkedByUser = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    for (const [userId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!UUID_RE.test(userId) || typeof value !== 'object' || value === null) continue;
      const { planId, nightKey } = value as Record<string, unknown>;
      if (typeof planId !== 'string' || !UUID_RE.test(planId)) continue;
      if (typeof nightKey !== 'string' || nightKey === '') continue;
      out[userId] = { planId, nightKey };
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(next: ParkedByUser): void {
  inMemoryParked = next;
  try {
    window.localStorage.setItem(STARTED_KEY, JSON.stringify(next));
    storageUsable = true;
  } catch {
    // Covered by inMemoryParked — never let this throw block navigation.
    storageUsable = false;
  }
}

/**
 * Drop every record whose night has rolled over, whoever it belongs to.
 *
 * This ran only inside `rememberStarted`, so the pruning the registry doc
 * promises happened only when SOMEBODY created a plan (round-5 panel, Codex):
 * user A opening their plan the next morning called `forgetStarted(A)`, whose
 * write preserved user B's expired entry indefinitely. A store that outlives
 * the tab then keeps one dead account id per user per night forever. Pruning on
 * every write is what makes the documented lifetime true rather than aspiration.
 */
function withoutExpired(all: ParkedByUser, nightKey: string): ParkedByUser {
  const kept: ParkedByUser = {};
  for (const [id, record] of Object.entries(all)) {
    if (record.nightKey === nightKey) kept[id] = record;
  }
  return kept;
}

function rememberStarted(userId: string, parked: ParkedPlan): void {
  // Our create was abandoned by another realm while it was in flight — see
  // `abandonedCreates`. Re-parking would resurrect a record that tab
  // deliberately removed, including after an account deletion wiped it.
  //
  // READ ONLY. Clearing it here was a defect (round-8 panel, Claude): this runs
  // only when a create SUCCEEDS, so a create that failed left the flag set and
  // the owner's next successful create silently refused to park — reopening the
  // very duplicate-plan hole the flag protects. `settleCreate` clears it,
  // because "the create is over" is the moment the flag stops meaning anything,
  // and every path reaches it.
  if (abandonedCreates.has(userId)) return;
  writeAll({ ...withoutExpired(readAll(), parked.nightKey), [userId]: parked });
}

function recallStarted(userId: string): ParkedPlan | null {
  return readAll()[userId] ?? null;
}

/**
 * Drops only THIS user's record. Another account's parked plan is not ours.
 *
 * EXPORTED (round-9 panel, Codex) because this component is the wrong place to
 * decide the plan was opened. It used to clear the record and then call
 * `router.push`, which is fire-and-forget: a navigation that fails or is
 * superseded before the route commits left the record already gone, so a later
 * remount armed Start and the next tap made a second plan. "Opened" means the
 * plan page rendered, and only the plan page knows that.
 *
 * Keeping the record one moment too LONG is safe — the worst case is a
 * recovery affordance for a plan the user has already seen, which the night
 * stamp sweeps anyway. Dropping it one moment too early is the duplicate.
 *
 * `planId` is REQUIRED, and it is the round-10 finding (Codex): the plan page
 * cleared whatever this user had parked, not the plan it was rendering. Park
 * plan A behind a failed follow-up read, then open plan B — any plan of the
 * same user's — and A's record was gone, Start re-armed, and the next tap made
 * a second plan for the same night. The record is spent by the plan it is
 * about, and by nothing else.
 */
export function forgetStartedNightOut(userId: string, planId: string): void {
  forgetStarted(userId, planId);
}

function forgetStarted(userId: string, planId: string): void {
  const all = readAll();
  const mine = all[userId];
  const dropped = mine !== undefined && mine.planId === planId ? mine : undefined;
  const rest = dropped === undefined ? all : (({ [userId]: _drop, ...keep }) => keep)(all);
  const pruned = withoutExpired(rest, nycNightKey());
  // Nothing of ours to drop AND nothing expired to sweep: leave the store alone
  // rather than rewriting it for no reason.
  if (dropped === undefined && Object.keys(pruned).length === Object.keys(rest).length) return;
  writeAll(pruned);
}

/**
 * The canonical Night Out entry point (V8-3 review: the lifecycle had no
 * production create surface). Signed-in only — creation is an authenticated
 * RPC (criterion 6); the consensus flow itself keeps working signed-out on
 * local data, so this renders nothing there.
 */

export default function StartNightOutButton({
  inviteeIds = [],
  disabled = false,
}: {
  /** Selected people from the consensus list; non-account entries are dropped. */
  inviteeIds?: readonly string[];
  /**
   * The invitee list is not settled yet — hold the button.
   *
   * `inviteeIds` is DERIVED state, and an empty array is indistinguishable
   * from "nobody selected" once it arrives here. The consensus page builds it
   * from the followed circle, which is empty while follows load, so starting
   * in that window created a real plan and invited NOBODY — no error, no empty
   * state, a night out with no guests (cold panel, both lanes, HIGH). The
   * caller owns the readiness signal because only the caller knows whether an
   * empty list means "still loading" or "none chosen".
   */
  disabled?: boolean;
} = {}): JSX.Element | null {
  const auth = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const [createdPlanId, setCreatedPlanId] = useState<string | null>(null);
  const [inviteFailures, setInviteFailures] = useState(0);
  /**
   * Minted once per attempt and REUSED across retries. That is the whole point:
   * a create whose response never arrived may already have made the plan, and
   * without a stable key the retry makes a second one (cold panel, Codex).
   */
  const attemptKey = useRef<string | null>(null);
  /**
   * Navigation must not fire from an unmounted component (fix round 1, Codex):
   * `handleStart`'s read can settle long after a route change, and pushing then
   * yanks the user off whatever they deliberately opened.
   */
  const mounted = useRef(true);
  /**
   * LAYOUT effect (round-8 panel, Codex), for the same reason `liveUserId`
   * below is one and the plan page's epoch is one.
   *
   * A passive cleanup runs in a task AFTER the unmount commits, so a read
   * settling in between saw `mounted.current === true` on a component that is
   * already gone — and this guard gates `forgetStarted` and `router.push`, so a
   * discarded screen could delete the parked plan and yank the user off
   * whatever they had deliberately opened.
   */
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    window.addEventListener('storage', onCrossTabStorage);
    return () => {
      window.removeEventListener('storage', onCrossTabStorage);
    };
  }, []);
  /**
   * THIS instance is the one still opening the plan.
   *
   * The create-settled tick below re-derives state from the parked record, and a
   * parked record means "created but not opened" — which is true from the moment
   * the plan is parked, including while this instance's own follow-up read is
   * still in flight. Without this guard, releasing the marker at park time (see
   * `settleCreate`) paints the "couldn't open it" recovery panel over a read that
   * is about to succeed and navigate.
   */
  const opening = useRef(false);

  // Re-arm the recovery affordance instead of the Start button. A plan created
  // in this session but never opened is the one state where offering "Start" is
  // actively harmful.
  //
  // Keyed on the signed-in user: a parked plan belonging to someone else, or to
  // an earlier night, is discarded rather than shown. Without that, the recovery
  // UI locks the NEXT account out of creating a plan (round 2, both lanes).
  /**
   * WHICH ACCOUNT is on screen, as a monotonic epoch. The same mechanism
   * `/night-out/[token]` uses, and the one this goal asked for in its own
   * constraints: "items 1, 2 and 4 are three instances of one defect shape — an
   * async result applied to state that has since moved on. Fix them as one
   * shape, not three ad-hoc patches."
   *
   * The page got the shape. This component got five ad-hoc patches instead, and
   * each one created the next defect, because every version answered "whose
   * record is this?" and none answered "is the answer I am holding still
   * addressed to the screen?". `useAuth` updates IN PLACE via
   * onAuthStateChange, so a cross-tab sign-out/sign-in lands mid-flight with no
   * unmount, and:
   *
   *   - the reset effect cleared `busy` while a create was still in flight, so
   *     Start re-armed and a second tap made a second plan for the same night
   *     (criterion 4, through the door the reset itself opened);
   *   - the stale closure then resolved and called setCreatedPlanId /
   *     setReadFailed unguarded, painting A's recovery panel into B's view.
   *
   * Every async result below captures this epoch before its first await and
   * refuses to act if it has moved. `mounted` is kept for the separate question
   * of whether the component still exists at all.
   */
  const userId = auth.status === 'signed-in' ? auth.user.id : null;
  /**
   * The account on screen RIGHT NOW, readable from inside a stale closure.
   *
   * A counter was the first shape tried and it was wrong here: auth cycling
   * A -> signed-out -> A bumps twice, so A's own in-flight create would have
   * been discarded on A's own screen. The page keys its epoch on (auth, token)
   * because that is its view identity; this component's view identity is the
   * ACCOUNT, so that is what gets captured and compared.
   */
  const liveUserId = useRef<string | null>(userId);
  /**
   * LAYOUT effect, not a passive one, and not a render-phase write.
   *
   * Render-phase assignment was filed by Codex: a render React throws away must
   * not change the identity that committed handlers compare against. Moving it
   * to a passive effect then opened the opposite hole (Claude, next round):
   * passive effects flush in a task AFTER paint, so a settling RPC could
   * interleave between the commit of a cross-tab auth change and the flush, pass
   * the owner guard against the OLD account, destroy that account's parked
   * record and navigate the NEW viewer to the old account's plan.
   *
   * useLayoutEffect runs synchronously inside the commit, so no external task
   * can observe this stale against a committed UI — and it is not a render-phase
   * write, so the first objection does not apply either.
   */
  useLayoutEffect(() => {
    liveUserId.current = userId;
  }, [userId]);

  // Re-runs the reset effect when a create settles in another (possibly dead)
  // instance's closure.
  const creatingTick = useSyncExternalStore(
    subscribeCreating,
    getCreatingVersion,
    getCreatingVersion,
  );

  useEffect(() => {
    // EVERY path through this effect ends in a definite state for the CURRENT
    // account. Round 2 (Claude, HIGH): the previous version early-returned when
    // the new user had no parked record, leaving the PREVIOUS account's
    // createdPlanId and readFailed in React state.
    //
    // Scoping the storage per user was not enough, because `useAuth` subscribes
    // to onAuthStateChange and updates IN PLACE — a sign-out and a different
    // sign-in propagating from another tab reach this component with no
    // unmount. B then inherited A's disabled Start and A's recovery panel, and
    // "Open it" failed under B's RLS into a message telling B their night out
    // exists. That is the round-2 lockout again, one layer up, and every
    // multi-account test missed it because they all unmount between switches.
    //
    // So: clear first, then re-arm only from a record that is genuinely ours.
    setCreatedPlanId(null);
    setReadFailed(false);
    setRetryFailed(false);
    // `error` too (cycle 3, Claude): without it, B rendered A's "Couldn't start
    // it — try again." after an in-place account switch — a false failure
    // attributed to the wrong account, and a direct contradiction of this
    // effect's own stated invariant.
    setError(false);
    // `busy` is NOT blindly cleared: an in-flight create belonging to the
    // account still on screen must keep Start disabled, or a sign-out/sign-in
    // round trip re-arms it mid-create and the next tap makes a second plan for
    // the same night. It IS cleared when the account changed, because the new
    // account has nothing in flight.
    setBusy(userId !== null && creatingOwners.has(userId));
    if (userId === null) return;
    // Only ever OUR record. Another account's parked plan is a different entry
    // in the same map rather than something to inherit, ignore or destroy —
    // the earlier single-slot design could do all three.
    const parked = recallStarted(userId);
    if (parked === null) return;
    // A STALE NIGHT is spent, and clearing it is what stops yesterday's plan
    // disabling Start today. This drops only our own entry.
    if (parked.nightKey !== nycNightKey()) {
      forgetStarted(userId, parked.planId);
      return;
    }
    setCreatedPlanId(parked.planId);
    setReadFailed(true);
  }, [userId]);

  /**
   * A create settled somewhere else — refresh, but do NOT reset.
   *
   * Deliberately separate from the account-change effect above. Folding this
   * into that one looked tidier and immediately broke a real case: the tick
   * fires from `handleStart`'s `finally`, so the full reset ran microseconds
   * after a failed create and wiped the "Couldn't start it" message the user
   * needed to see. Account change means "throw everything away"; a settling
   * create means "re-derive what is in flight and whether a recovery is
   * waiting" — different questions, different effects.
   */
  useEffect(() => {
    if (userId === null) return;
    // Our own read is still in flight: this instance already knows the plan is
    // parked and will report the outcome itself. Re-deriving here would announce
    // a read failure that has not happened.
    if (opening.current) return;
    setBusy(creatingOwners.has(userId));
    const parked = recallStarted(userId);
    if (parked === null || parked.nightKey !== nycNightKey()) return;
    setCreatedPlanId(parked.planId);
    setReadFailed(true);
  }, [creatingTick, userId]);

  /**
   * Retry the READ, not the create. The first version of this told the user to
   * refresh — advice that loses the plan id from component state and re-arms
   * the Start button, walking them straight back into the duplicate-plan bug it
   * was written to prevent (cold panel 2, Codex). Advice the UI cannot honour
   * is worse than no advice.
   */
  const retryOpen = async (): Promise<void> => {
    const supabase = getBrowserSupabase();
    // `userId`, not `auth.user.id`: this closure is defined above the
    // signed-in guard, so the narrowed type is not available here — and a
    // signed-out retry has no record of its own to clear anyway.
    if (!supabase || createdPlanId === null || userId === null) return;
    const owner = userId;
    setRetryFailed(false);
    const plan = await getNightOut(supabase, createdPlanId);
    // Still the same account on screen, and still mounted.
    if (!mounted.current || owner !== liveUserId.current) return;
    if (plan === null) {
      // Round 2 (Claude): this returned silently, so a plan that had genuinely
      // gone — deleted, or a read that keeps failing — turned "Open it" into a
      // dead control with no message and Start still disabled. A button that
      // does nothing and says nothing is worse than a reported failure, because
      // the user cannot tell it from a slow tap.
      setRetryFailed(true);
      return;
    }
    // NOT cleared here — the plan page clears it when it actually renders.
    router.push(`/night-out/${plan.shareToken}`);
  };

  if (auth.status !== 'signed-in') return null;

  const handleStart = async (): Promise<void> => {
    const supabase = getBrowserSupabase();
    // Guarded here too, not only via the disabled attribute: a click can be
    // dispatched programmatically, and a plan created early cannot be un-made.
    if (!supabase || busy || disabled) return;
    // Captured BEFORE the first await. Every setState and every write below is
    // addressed to THIS account's screen; if a different account is on screen
    // when the answer arrives, it is not ours to apply.
    const owner = auth.user.id;
    // Refuses a second create for an account that already has one in flight,
    // even from a freshly mounted component that has no local memory of it.
    if (creatingOwners.has(owner)) return;
    // And a SYNCHRONOUS re-read of the store, because `creatingOwners` is
    // module-scoped and therefore per-realm (round 4, Codex).
    //
    // The `storage` event that tells this tab about another tab's park is
    // delivered asynchronously, and the React state it drives commits later
    // still. Between tab A parking its plan and this tab's effect running,
    // Start is enabled and `busy` is false — a click in that window issued a
    // second `create_night_out`. The event is what keeps the UI honest; this is
    // what keeps the ACTION honest, and it costs one localStorage read on a
    // path the user takes at most once a night.
    const alreadyParked = recallStarted(owner);
    if (alreadyParked !== null && alreadyParked.nightKey === nycNightKey()) {
      setCreatedPlanId(alreadyParked.planId);
      setReadFailed(true);
      return;
    }
    creatingOwners.add(owner);
    markCreatingChanged();
    /**
     * Idempotent, so it can be called the moment the create is genuinely over
     * and again from `finally` without double-notifying.
     */
    const settleCreate = (): void => {
      // The abandonment flag is scoped to ONE create attempt, so it dies with
      // that attempt however it ends — success, refusal, or throw. `finally`
      // calls this on every path.
      abandonedCreates.delete(owner);
      if (creatingOwners.delete(owner)) markCreatingChanged();
    };
    setBusy(true);
    setError(false);
    try {
      // ONE reading of the clock for this whole attempt (cycle 1, Codex). The
      // night key was read again when parking, so a 6am NYC rollover landing
      // between the two calls tagged the parked record with a night the plan
      // does not belong to, and the scoping check then discarded a live
      // recovery as stale.
      const nightKey = nycNightKey();
      // Minted once per attempt and REUSED across retries: a create whose
      // response never arrived may already have made the plan, and without a
      // stable key the retry makes a second one (cold panel, Codex).
      if (attemptKey.current === null) attemptKey.current = crypto.randomUUID();
      const planId = await createNightOut(supabase, nightKey, undefined, attemptKey.current);
      if (owner !== liveUserId.current) {
        // A different account is on screen. The plan (if any) still belongs to
        // `owner`, so park it rather than dropping it — but paint nothing.
        if (planId !== null) rememberStarted(owner, { planId, nightKey });
        return;
      }
      if (planId === null) {
        setBusy(false);
        setError(true);
        return;
      }
      // The plan EXISTS from here on. A failed follow-up read is a read
      // failure, not a create failure: reporting it as one and re-enabling the
      // button made the next tap create a SECOND plan for the same night,
      // splitting the group between two plans nobody could tell apart.
      // Parked BEFORE the follow-up read, because the window this closes is the
      // one where the read is still in flight and the user navigates away.
      rememberStarted(owner, { planId, nightKey });
      setCreatedPlanId(planId);
      // The CREATE is over here, not after the read (round 3, Codex). Holding
      // the marker until the follow-up read settles means a component that was
      // unmounted mid-create — the one case this marker exists for — leaves the
      // REMOUNTED screen on a disabled "Starting…" for as long as the read takes,
      // with no "Open it", even though the plan is already parked and ready. A
      // read that never settles makes that permanent. From this line the only
      // thing still pending is opening the plan, which is this instance's own
      // business and is tracked in `opening`.
      opening.current = true;
      settleCreate();

      // Invitations are sent AFTER the plan exists and BEFORE navigating, so the
      // owner learns here if some did not land. A failed invite never blocks
      // reaching the plan — the plan is real either way — but it is never silent
      // either: an invitation nobody sent and nobody mentioned is the whole
      // defect this wiring exists to fix.
      const accounts = inviteeIds.filter((id) => UUID_RE.test(id));
      let failed = 0;
      for (const id of accounts) {
        // Sequential on purpose: invite_to_night_out serialises on a per-plan
        // advisory lock, so firing them in parallel would just queue on the lock.
        if (!(await inviteToNightOut(supabase, planId, id))) failed += 1;
      }
      if (owner !== liveUserId.current) return;
      setInviteFailures(failed);

      const plan = await getNightOut(supabase, planId);
      if (owner !== liveUserId.current) return;
      if (plan === null) {
        // Nothing will clear `busy` for us any more — the tick that used to do
        // it fired at park time, and this instance was skipping it.
        setBusy(false);
        setReadFailed(true);
        return;
      }
      if (!mounted.current) return;
      // NOT cleared here — see `forgetStartedNightOut`.
      router.push(`/night-out/${plan.shareToken}`);
    } finally {
      // ALWAYS. `finally` is what makes an orphaned marker impossible — an
      // orphan would be a permanent lockout for that account, strictly worse
      // than the duplicate the marker prevents. The notification is here too,
      // so it fires after every storage mutation above has already happened.
      opening.current = false;
      settleCreate();
    }
  };

  return (
    <div className="mt-4 text-center">
      <button
        type="button"
        onClick={() => void handleStart()}
        // A plan already exists for this session — the only safe action left is
        // opening it. Leaving Start armed here is precisely how the second plan
        // gets created. `disabled` is the caller's own veto, kept alongside it.
        disabled={busy || disabled || createdPlanId !== null}
        className="rounded-full border border-accent px-5 py-2 text-accent touch-manipulation disabled:opacity-50"
      >
        {busy ? 'Starting…' : 'Start the official Night Out'}
      </button>
      {error ? (
        <p className="mt-2 text-sm text-red-400">
          Couldn&apos;t start it — try again.
        </p>
      ) : null}
      {inviteFailures > 0 ? (
        <p className="mt-2 text-sm text-red-400">
          {inviteFailures === 1
            ? "One invite didn't send — you can share the link instead."
            : `${inviteFailures} invites didn't send — you can share the link instead.`}
        </p>
      ) : null}
      {readFailed ? (
        <div className="mt-2">
          <p className="text-sm text-red-400">
            Your night out was created, but this page couldn&apos;t open it.
            Don&apos;t start another one.
          </p>
          <button
            type="button"
            onClick={() => void retryOpen()}
            className="mt-2 rounded-full border px-5 py-2 text-sm"
          >
            Open it
          </button>
          {retryFailed ? (
            <p className="mt-2 text-sm text-red-400" role="status">
              Still couldn&apos;t open it. Your night out exists — try again in a
              moment.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
