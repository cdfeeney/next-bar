'use client';

import { useEffect, useState } from 'react';
import ClaimHandle from '@/components/ClaimHandle';
import DisplayNameEditor from '@/components/DisplayNameEditor';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useModalDialog } from '@/hooks/useModalDialog';
import { clearProfile, loadProfile } from '@/lib/storedProfile';
import { Group, LinkRow, SlotRow, StackHeader, StatusRow } from '../_ui';
import { useOwnProfile } from '../_useOwnProfile';

// Dismissal flag for the claim-your-username nudge. UI preference only —
// deliberately NOT in accountCache ALL_KEYS (it holds no account data; a
// shared browser leaking "nudge was dismissed" is harmless).
const HANDLE_NUDGE_DISMISSED_KEY = 'next-bar:handle-nudge-dismissed:v1';

/**
 * Edit profile (approved/next-bar-account-a-settings.png, screen 3).
 *
 * V8-R-ACC-006, quoted in full: "Only photo, display name and @username are
 * hand-editable." Two of those three are editable here. The THIRD is not, and
 * the row below says so rather than the comment quietly dropping the clause —
 * an earlier version of this header paraphrased the requirement as "only
 * display name and @username", which hid the gap from the next reader.
 *
 * WHY PHOTO IS A STATUS ROW, not a control. There is no photo or avatar column
 * on `profiles` anywhere in `supabase/migrations`, no storage bucket for one,
 * and this lane mints no migration. Every avatar in the app is generated from
 * a seed (`src/components/Avatar.tsx`). An upload control with nowhere to
 * persist would be a fallback presented as a success, which V8-R-OPS-001
 * forbids outright — the same reason ACC-007, ACC-008 and ACC-010 are stated
 * rather than offered. It becomes a control in the change that adds its
 * storage, not before.
 *
 * V8-R-ACC-004: the vibe profile is quiz-derived — this screen links out to
 * the quiz rather than offering a text field that would let someone contradict
 * their own answers.
 *
 * Each group owns the state it reads, so the page function is the layout and
 * nothing else.
 *
 * UNSAVED EDITS (V8-R-ACC-006 failure_recovery): "leaving with unsaved edits
 * raises 'Discard changes?' with Keep editing as the default". Back is
 * intercepted below and nothing is lost silently.
 *
 * WHY DIRTINESS IS OBSERVED RATHER THAN ASKED FOR. Both editors —
 * `DisplayNameEditor` and `ClaimHandle` — already track their own dirty state
 * and own their own Save buttons, but neither reports it upward and both live
 * in `src/components/`, outside this lane's write scope. Adding an
 * `onDirtyChange` prop is the right shape and is the first thing to do when
 * those files are assignable. Until then the wrapper below listens for the
 * `input` events they bubble, which is a strict over-approximation: typing and
 * then retyping the original value still counts as dirty. That errs toward
 * asking, and "Keep editing" is the default answer, so the cost of the
 * over-approximation is one extra tap and never a lost edit.
 *
 * THE "FIXED SAVE CHANGES" HALF OF ACC-006 IS NOT BUILT, and this is the note
 * saying so rather than a comment implying it is. The requirement also asks
 * for a single Save action pinned above the home indicator. Each editor ships
 * its own submit button inside its own form; a second, page-level Save would
 * have to reach into two forms this lane cannot edit, and a Save button that
 * saves only one of the two fields is a control that lies. It arrives with the
 * change that can touch those components.
 */
export default function EditProfilePage(): JSX.Element {
  const auth = useAuth();
  const profile = useOwnProfile();
  const [dirty, setDirty] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  return (
    <main className="min-h-screen">
      <StackHeader
        title="Edit profile"
        backHref="/settings/preferences"
        onBack={() => {
          if (!dirty) return true;
          setConfirmingDiscard(true);
          return false;
        }}
      />

      <div
        onInput={() => setDirty(true)}
        className="max-w-md mx-auto px-4 py-5 space-y-6 pb-[max(2rem,env(safe-area-inset-bottom))]"
      >
        {auth.status === 'signed-in' ? (
          <>
            <Group label="Photo">
              <StatusRow
                label="Profile photo"
                value="Not on this build"
                description="Next Bar doesn't store profile photos yet — your avatar is generated from your username. Uploading arrives with the storage that keeps it."
              />
            </Group>

            <Group label="Display name">
              <SlotRow>
                {profile.known ? (
                  <DisplayNameEditor
                    userId={auth.user.id}
                    initialName={profile.displayName}
                    onSaved={(name) => {
                      profile.setDisplayName(name);
                      setDirty(false);
                    }}
                  />
                ) : (
                  <p className="text-muted text-sm">Loading…</p>
                )}
              </SlotRow>
            </Group>

            <UsernameGroup
              known={profile.known}
              handle={profile.handle}
              onClaimed={(handle) => {
                profile.setHandle(handle);
                setDirty(false);
              }}
            />
          </>
        ) : (
          <SignedOutProfileGroup />
        )}

        <VibeProfileGroup />
      </div>

      {confirmingDiscard ? (
        <DiscardChangesDialog
          onKeepEditing={() => setConfirmingDiscard(false)}
          backHref="/settings/preferences"
        />
      ) : null}
    </main>
  );
}

/**
 * "Discard changes?" — V8-R-ACC-006's failure_recovery, with Keep editing as
 * the default.
 *
 * NOT `window.confirm`. The native dialog focuses its OK button, so the
 * default answer there is the destructive one, which is the opposite of what
 * the requirement asks for. Here Keep editing is first in the DOM, visually
 * primary, and what Escape resolves to — `useModalDialog` supplies the focus
 * trap, background `inert`, scroll lock and Escape handling the rest of the
 * app's dialogs already use, so this adds a screen and not a second contract.
 *
 * Discard is a real navigation rather than a re-click of the intercepted link:
 * the edits live in component state that unmounts with the route, so leaving
 * IS discarding and there is nothing else to undo.
 */
function DiscardChangesDialog({
  onKeepEditing,
  backHref,
}: {
  onKeepEditing: () => void;
  backHref: string;
}): JSX.Element {
  const dialog = useModalDialog<HTMLDivElement>(onKeepEditing);

  return (
    <div
      ref={dialog}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="discard-changes-title"
      className="fixed inset-0 z-[1500] bg-bg/95 backdrop-blur-sm flex items-center justify-center px-6 outline-none"
    >
      <div className="max-w-sm w-full bg-surface border border-border rounded-3xl p-6 text-center space-y-3">
        <h2 id="discard-changes-title" className="font-display text-xl">
          Discard changes?
        </h2>
        <p className="text-muted text-sm leading-relaxed">
          You have edits you haven&apos;t saved yet. Leaving now loses them.
        </p>
        <button
          type="button"
          onClick={onKeepEditing}
          className="w-full bg-accent hover:bg-accentDim transition-colors text-bg font-display text-base py-3 rounded-full min-h-[44px] touch-manipulation"
        >
          Keep editing
        </button>
        <Link
          href={backHref}
          className="block w-full text-red-400 font-display text-base py-3 min-h-[44px] touch-manipulation"
        >
          Discard
        </Link>
      </div>
    </div>
  );
}

/** Claim-once username: the nudge, the claim form, or the claimed value. */
function UsernameGroup({
  known,
  handle,
  onClaimed,
}: {
  known: boolean;
  handle: string | null;
  onClaimed: (handle: string) => void;
}): JSX.Element {
  const [nudgeDismissed, setNudgeDismissed] = useState(true);

  useEffect(() => {
    setNudgeDismissed(
      window.localStorage.getItem(HANDLE_NUDGE_DISMISSED_KEY) === '1',
    );
  }, []);

  return (
    <Group label="Username">
      <SlotRow>
        {!known ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : handle === null ? (
          <>
            {!nudgeDismissed ? (
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-muted leading-relaxed">
                  Usernames are here — claim yours so friends can find you.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    window.localStorage.setItem(
                      HANDLE_NUDGE_DISMISSED_KEY,
                      '1',
                    );
                    setNudgeDismissed(true);
                  }}
                  aria-label="Dismiss username nudge"
                  className="text-muted text-xs underline-offset-4 hover:underline min-h-[44px] touch-manipulation shrink-0"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
            <ClaimHandle onClaimed={onClaimed} />
          </>
        ) : (
          <>
            <p className="font-display text-lg">@{handle}</p>
            <p className="text-xs text-muted leading-relaxed">
              Your username is how friends find you. It is claimed once and
              cannot be changed here.
            </p>
          </>
        )}
      </SlotRow>
    </Group>
  );
}

function SignedOutProfileGroup(): JSX.Element {
  return (
    <Group label="Profile">
      <SlotRow>
        <p className="text-sm text-muted leading-relaxed">
          Sign in to claim a username and set a display name.
        </p>
        <Link
          href="/auth"
          className="inline-flex items-center justify-center bg-accent text-bg font-display text-sm px-5 py-2 rounded-full min-h-[44px] touch-manipulation"
        >
          Sign in →
        </Link>
      </SlotRow>
    </Group>
  );
}

/** Quiz-derived, never hand-edited: view, retake, or clear (V8-R-ACC-004). */
function VibeProfileGroup(): JSX.Element {
  const [hasVibeProfile, setHasVibeProfile] = useState(false);

  useEffect(() => {
    setHasVibeProfile(loadProfile() !== null);
  }, []);

  const handleClear = () => {
    if (
      !window.confirm(
        'Clear your saved vibe profile? You can retake the quiz anytime.',
      )
    )
      return;
    clearProfile();
    setHasVibeProfile(false);
  };

  return (
    <Group
      label="Vibe profile"
      footnote="Your vibe profile is derived from the quiz. View or retake the quiz — it is not rewritten by hand here."
    >
      <SlotRow>
        <p className="text-sm">
          {hasVibeProfile
            ? 'Your quiz answers are saved.'
            : 'No vibe profile yet.'}
        </p>
      </SlotRow>
      <LinkRow
        href="/quiz"
        label={hasVibeProfile ? 'Retake the quiz' : 'Take the quiz'}
      />
      {hasVibeProfile ? (
        <SlotRow>
          <button
            type="button"
            onClick={handleClear}
            className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
          >
            Clear saved quiz answers
          </button>
        </SlotRow>
      ) : null}
    </Group>
  );
}
