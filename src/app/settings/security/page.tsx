'use client';

import Link from 'next/link';
import { useState } from 'react';
import SetPassword from '@/components/SetPassword';
import { drainBarWrites, useRatings } from '@/hooks/useRatings';
import { useAuth, type AuthState } from '@/hooks/useAuth';
import {
  abandonInFlightSyncs,
  destroyAccountDataOnDeletion,
} from '@/lib/accountCache';
import { deleteAllServerComparisons } from '@/lib/pairwise.server';
import { deleteAllServerRatings } from '@/lib/ratings.server';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { signOutAndRevokePush } from '../_signOut';
import { ButtonRow, Group, SlotRow, StackHeader, StatusRow } from '../_ui';
import {
  requestAccountDeletionOutcome,
  type DeletionOutcome,
} from './_deleteRequest';

/**
 * Security & account (approved/next-bar-account-a-settings.png, screen 5).
 * V8-R-ACC-011 for the account rows, V8-R-ACC-012 and V8-R-GRP-009 for the
 * danger zone.
 *
 * Delete stays two levels away from the profile — gear, then here, then a
 * typed confirmation. It is the only outlined-red control in the stack, sits
 * in its own danger zone below everything else, and Cancel is the larger, more
 * prominent of the two buttons in the confirm.
 *
 * The destructive paths are deliberately SEPARATE units below — the two
 * server-side wipes (`clearAllRatings`, `performAccountDeletion`) are plain
 * functions with no JSX, and the danger zone is its own component. Reviewing
 * the deletion ordering should not mean reading past a hundred lines of markup.
 */

type Auth = ReturnType<typeof useAuth>;
type SignedInAuth = Extract<AuthState, { status: 'signed-in' }> &
  Pick<Auth, 'signOut'>;

/**
 * Wipe every rating, locally and (when signed in) on the server.
 *
 * Signed-in: server rows are the source of truth — delete them BEFORE the
 * reload, or useRatings re-fetches them and everything reappears.
 */
async function clearAllRatings(auth: Auth): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!window.confirm('Clear ALL bar ratings? This cannot be undone.')) return;

  if (auth.status === 'signed-in') {
    const supabase = getBrowserSupabase();
    if (supabase) {
      const failure = await clearServerRatings(supabase, auth.user.id);
      if (failure !== null) {
        window.alert(failure);
        return;
      }
    }
  }

  window.localStorage.removeItem('next-bar:ratings:v1');
  // Stale pairwise comparisons would silently re-derive scores onto freshly
  // re-rated bars — clear them together with the ratings they came from.
  window.localStorage.removeItem('next-bar:pairwise:v1');
  // Clearing all ratings also clears the sample night, so reset the
  // demo-seeded flags — otherwise Settings still offers "Remove sample
  // night" while Rankings is empty.
  window.localStorage.removeItem('next-bar:demo:seeded:v1');
  window.localStorage.removeItem('next-bar:demo:seeded-ids:v1');
  // E4.1: the night visit log is the most sensitive local record (which
  // bars, in order, when) — the documented wipe control must cover it
  // (privacy page: "wiped any time from Settings").
  window.localStorage.removeItem('next-bar:night-log:v1');
  // useRatings reads on next mount; a hard reload is the simplest correct
  // refresh.
  window.location.reload();
}

/**
 * Delete this user's server-side ratings and comparisons.
 * Returns null on success, or the user-facing message for a partial failure.
 */
async function clearServerRatings(
  supabase: NonNullable<ReturnType<typeof getBrowserSupabase>>,
  userId: string,
): Promise<string | null> {
  // supabase-js resolves with { error } instead of throwing, so the helpers
  // return success booleans; try/catch is kept for genuine transport throws.
  //
  // Two deletes cannot be atomic from the client. Order + honest partial
  // reporting instead: comparisons go FIRST — they are derived judgments, so
  // losing them while ratings survive is harmless, whereas the reverse leaves
  // orphaned comparisons re-deriving stale scores.
  let comparisonsOk = false;
  let ratingsOk = false;
  try {
    // Stop new sync enqueues FIRST: the sign-in retry loop checks the epoch
    // per entry, so bumping it here prevents writes from being enqueued AFTER
    // the drain snapshot below — those landed after the server delete and
    // restored rows the user had just cleared.
    abandonInFlightSyncs();
    // Then settle every already-pending same-tab write: a delayed
    // write-through landing AFTER the server delete silently restored the
    // cleared row. Two passes: the first settles queued tasks, the second
    // catches a task that was mid-enqueue when the first snapshot was taken.
    // Bounded, so a user tapping ratings during the clear cannot livelock it.
    await drainBarWrites();
    await drainBarWrites();
    comparisonsOk = await deleteAllServerComparisons(supabase, userId);
    if (comparisonsOk) {
      ratingsOk = await deleteAllServerRatings(supabase, userId);
    }
  } catch {
    // fall through with the flags as they stand
  }
  if (!comparisonsOk) {
    return "Couldn't reach the server, so your ratings were NOT cleared. Try again in a moment.";
  }
  if (!ratingsOk) {
    return 'Your comparison history was cleared, but your ratings could NOT be — try "Clear all ratings" again in a moment.';
  }
  return null;
}

/**
 * Destroy the account server-side and leave.
 *
 * Returns what is KNOWN about the outcome, not a success flag: `refused` means
 * the server answered before deleting anything, `unknown` means no usable
 * answer came back and the account may already be gone. Only `deleted` leaves
 * — and it never returns usefully, because the page has been replaced.
 */
async function performAccountDeletion(
  auth: SignedInAuth,
): Promise<DeletionOutcome> {
  const outcome = await requestAccountDeletionOutcome(auth.session.access_token);
  if (outcome !== 'deleted') return outcome;
  // The auth user is gone server-side. signOut() SEALS the cache — right for
  // an ordinary sign-out, wrong here: this owner can never return. Deletion
  // hard-destroys EVERYTHING, personal keys included; clearing the cache alone
  // removed the ownership signal while leaving lists/night-log/profile, and
  // the next account then passed the foreign guard and inherited them.
  // try/finally: the redirect must happen even if signOut throws — the account
  // no longer exists, so staying on a signed-in-looking page lies. Captured
  // BEFORE signOut: the parked unopened-plan record is a map keyed by user id,
  // and by the time `finally` runs `auth` no longer names the account.
  const deletedUserId = auth.user.id;
  try {
    await signOutAndRevokePush(auth.signOut);
  } finally {
    destroyAccountDataOnDeletion(deletedUserId);
    window.location.assign('/');
  }
  return 'deleted';
}

export default function SecurityAccountPage(): JSX.Element {
  const auth = useAuth();
  const { ratings } = useRatings();
  const clearRatings = () => void clearAllRatings(auth);

  return (
    <main className="min-h-screen">
      <StackHeader title="Security & account" backHref="/settings/preferences" />

      <div className="max-w-md mx-auto px-4 py-5 space-y-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {auth.status === 'signed-in' ? (
          <SignedInAccount
            auth={auth}
            hasRatings={ratings.length > 0}
            onClearRatings={clearRatings}
          />
        ) : (
          <SignedOutAccount
            hasRatings={ratings.length > 0}
            onClearRatings={clearRatings}
          />
        )}
      </div>
    </main>
  );
}

function SignedInAccount({
  auth,
  hasRatings,
  onClearRatings,
}: {
  auth: SignedInAuth;
  hasRatings: boolean;
  onClearRatings: () => void;
}): JSX.Element {
  return (
    <>
      <Group label="Account">
        <SlotRow>
          <p className="text-xs text-muted uppercase tracking-widest">
            Email &amp; password · Verified
          </p>
          <p className="text-sm break-all">
            {auth.user.email ?? 'Not available'}
          </p>
        </SlotRow>
        <SlotRow>
          <SetPassword />
        </SlotRow>
        {/* V8-R-ACC-011 draws a device count. Supabase exposes other sessions
            only through the admin API, which is service-role and server-side —
            no client can enumerate them, and printing "1 device" would be a
            guess dressed as a fact. */}
        <StatusRow
          label="Active sessions"
          value="This device"
          description="Signing out ends the session on this device. Next Bar cannot list your other devices on this build."
        />
        {/* Sign out is an ordinary secondary action and is deliberately NOT
            grouped with deletion (V8-R-ACC-011). It is also on Settings home.
            Both go through the helper that also revokes this installation's
            notification token, which the requirement makes part of the same
            action. */}
        <ButtonRow
          label="Sign out"
          onClick={() => void signOutAndRevokePush(auth.signOut)}
        />
      </Group>

      <Group
        label="Data"
        footnote="Everything you've rated lives on this device and, when you're signed in, on your account. Clearing removes both."
      >
        <ButtonRow
          label="Clear all ratings"
          onClick={onClearRatings}
          disabled={!hasRatings}
        />
      </Group>

      <DangerZone auth={auth} />
    </>
  );
}

function SignedOutAccount({
  hasRatings,
  onClearRatings,
}: {
  hasRatings: boolean;
  onClearRatings: () => void;
}): JSX.Element {
  return (
    <>
      <Group label="Account">
        <SlotRow>
          <p className="text-sm text-muted leading-relaxed">
            Sign in to manage your password, sessions and account deletion.
          </p>
          <Link
            href="/auth"
            className="inline-flex items-center justify-center bg-accent text-bg font-display text-sm px-5 py-2 rounded-full min-h-[44px] touch-manipulation"
          >
            Sign in →
          </Link>
        </SlotRow>
      </Group>

      <Group
        label="Data"
        footnote="Everything you've rated lives only on this device until you sign in."
      >
        <ButtonRow
          label="Clear all ratings"
          onClick={onClearRatings}
          disabled={!hasRatings}
        />
      </Group>
    </>
  );
}

// Account deletion: idle → armed (type-to-confirm visible) → deleting.
// A finished attempt that did NOT leave the page rests in one of two states,
// and collapsing them was the defect: 'failed' is the server answering that it
// deleted nothing, 'unknown' is no usable answer at all. Both keep the
// type-to-confirm form on screen; they differ only in what they can honestly
// claim about the account.
type DeleteState = 'idle' | 'armed' | 'deleting' | 'failed' | 'unknown';

/**
 * The confirmation is EXACT — not trimmed, not case-folded.
 *
 * The label tells the user the precise word, and this action is irreversible
 * and all-or-nothing, so the check has to be the one the screen advertises.
 * `trim().toLowerCase()` accepted "delete" and " DELETE ", which is a weaker
 * gate than the sentence above the field claims. The input carries
 * autoCapitalize="characters" so a phone keyboard helps rather than fights it.
 */
const DELETE_CONFIRMATION = 'DELETE';

function isDeleteConfirmed(text: string): boolean {
  return text === DELETE_CONFIRMATION;
}

function DangerZone({ auth }: { auth: SignedInAuth }): JSX.Element {
  const [state, setState] = useState<DeleteState>('idle');
  const [confirmText, setConfirmText] = useState('');

  /**
   * NO CLIENT-SIDE MEMORY OF PAST ATTEMPTS — the cycle-5 redesign.
   *
   * This screen used to carry a latch recording that an attempt had ended
   * `unknown`, because a retry's `unauthorized` meant both "you were never
   * signed in" and "the account is already gone". Four review rounds moved
   * that latch through every scope it could have — component state, view state
   * Cancel reset, a mount a reload discarded, a second tab, a storage that
   * refused the write — and each fix was correct and relocated the problem,
   * because the browser was being asked to remember something only the server
   * could know.
   *
   * `/api/account/delete` now answers a validly signed token whose user is
   * gone with success. The retry is authoritative, so `refused` is certain on
   * every attempt and there is nothing here to keep.
   */
  const handleDelete = async () => {
    if (state === 'deleting') return;
    if (!isDeleteConfirmed(confirmText)) return;
    setState('deleting');
    const outcome = await performAccountDeletion(auth);
    // 'deleted' has already navigated away. The other two both stay here and
    // say only what they know: a refusal proves THIS ATTEMPT changed nothing,
    // a lost answer proves nothing at all, and neither is licensed to make a
    // claim about whether the account still exists.
    if (outcome === 'refused') setState('failed');
    if (outcome === 'unknown') setState('unknown');
  };

  return (
    <section>
      <h2 className="font-label text-[11px] uppercase tracking-[0.2em] text-red-400 mb-2 px-1">
        Danger zone
      </h2>
      <div className="bg-surface border border-red-400/60 rounded-2xl p-4 space-y-3">
        {/* V8-R-ACC-012 requires the confirmation to ENUMERATE what is
            destroyed, and V8-R-GRP-009 requires group memberships to be named
            among it. Deletion cascades from auth.users through profiles, and
            0067's succession trigger hands administration to the
            longest-standing remaining member (lowest profile id breaks a tie)
            or deletes an emptied group — so this sentence is describing what
            the database actually does, not a promise the UI invented. */}
        <p className="text-xs text-muted leading-relaxed">
          This permanently deletes, where it applies to you: your profile, photo
          and @username; your posts, stories and night recaps; friendships,
          followers and group memberships; ratings, saved bars and account data.
          Groups you administer pass to their longest-standing remaining member,
          or are deleted if you were the last one in them. There is no undo.
        </p>
        {state === 'idle' ? (
          <button
            type="button"
            onClick={() => setState('armed')}
            className="w-full min-h-[44px] rounded-full border border-red-400 text-red-400 font-display text-sm touch-manipulation"
          >
            Delete account
          </button>
        ) : (
          <DeleteConfirm
            state={state}
            confirmText={confirmText}
            onConfirmTextChange={setConfirmText}
            onCancel={() => {
              setState('idle');
              setConfirmText('');
            }}
            onDelete={() => void handleDelete()}
          />
        )}
      </div>
    </section>
  );
}

function DeleteConfirm({
  state,
  confirmText,
  onConfirmTextChange,
  onCancel,
  onDelete,
}: {
  state: DeleteState;
  confirmText: string;
  onConfirmTextChange: (value: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <div className="space-y-3">
      <label htmlFor="delete-confirm" className="block text-xs text-muted">
        Type <span className="text-text font-display">DELETE</span> to confirm.
        This cannot be undone.
      </label>
      <input
        id="delete-confirm"
        type="text"
        inputMode="text"
        autoComplete="off"
        // The confirmation is case-sensitive, so the phone keyboard should
        // offer capitals rather than suppress them.
        autoCapitalize="characters"
        spellCheck={false}
        // Arming unmounts the trigger button — move focus here so
        // keyboard/screen-reader users aren't dropped to <body>.
        autoFocus
        value={confirmText}
        onChange={(e) => onConfirmTextChange(e.target.value)}
        className="w-full bg-bg border border-red-400 rounded-2xl px-4 py-3 text-base text-text placeholder:text-muted focus:outline-none min-h-[44px]"
      />
      {/* A CLAIM ABOUT THE ATTEMPT, NOT ABOUT THE ACCOUNT.
          "Nothing was removed" was a statement about the account's whole
          history, and the classifier cannot support it: `rate_limited` and
          `unavailable` are returned BEFORE the route ever looks the user up,
          so a throttled retry after a lost successful deletion printed that
          sentence over an account that was already gone.
          Reclassifying those as `unknown` would be wrong in the other
          direction — an ordinary first-attempt throttle would tell someone
          whose account demonstrably still exists that it "may already be
          gone". What the response actually proves is that THIS request
          changed nothing, which is true on every path that reaches here, so
          that is what it says. */}
      {state === 'failed' ? (
        <p className="text-red-400 text-xs" role="status">
          That attempt was refused and removed nothing. Try again in a moment,
          or email hi@next-bar.app.
        </p>
      ) : null}
      {/* The honest sentence for a lost answer. It must NOT say "nothing was
          removed": the route deletes the account and only then replies, so a
          dropped response is exactly the case where the account is most likely
          already gone. Telling someone their data survived, when it did not,
          stops them checking — the one outcome worse than saying "we don't
          know". */}
      {state === 'unknown' ? (
        <p className="text-red-400 text-xs" role="status">
          We couldn&apos;t confirm whether your account was deleted — it may
          already be gone. Reload this page and try to sign in to check before
          trying again, or email hi@next-bar.app.
        </p>
      ) : null}
      {/* Cancel is the larger, more prominent of the two. */}
      <button
        type="button"
        onClick={onCancel}
        disabled={state === 'deleting'}
        className="w-full min-h-[48px] rounded-full bg-surface border border-border text-text font-display text-sm touch-manipulation disabled:opacity-40"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={!isDeleteConfirmed(confirmText) || state === 'deleting'}
        className="w-full min-h-[44px] rounded-full border border-red-400 text-red-400 font-display text-sm touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {state === 'deleting' ? 'Deleting…' : 'Permanently delete'}
      </button>
    </div>
  );
}
