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
 * those files are assignable. Until then the wrappers below listen for the
 * `input` events they bubble, which is a strict over-approximation: typing and
 * then retyping the original value still counts as dirty. That errs toward
 * asking, and "Keep editing" is the default answer, so the cost of the
 * over-approximation is one extra tap and never a lost edit.
 *
 * ONE FLAG PER EDITOR, NOT ONE FOR THE PAGE. A single page-level flag was
 * observed by both review lanes to be a lost edit: it was set by input from
 * EITHER editor and cleared by a save from either, so typing a display name
 * and a username, then saving only the name, disarmed the guard while the
 * username draft was still on screen. Back then left silently. Each editor now
 * has its own wrapper and its own flag; the page is dirty while ANY of them
 * is, and a save clears only the one that saved.
 *
 * AND EVERY EXIT IS GUARDED, not just the back arrow. The Vibe profile row
 * navigates to `/quiz` from inside the form, and as a plain link it walked off
 * the screen with unsaved text and no prompt — the guard was not weak there,
 * it was absent. `guardExit` is one function and every way off this screen
 * calls it, so a new row cannot quietly reintroduce an unguarded exit.
 *
 * THE "FIXED SAVE CHANGES" HALF OF ACC-006 IS NOT BUILT, and this is the note
 * saying so rather than a comment implying it is. The requirement also asks
 * for a single Save action pinned above the home indicator. Each editor ships
 * its own submit button inside its own form; a second, page-level Save would
 * have to reach into two forms this lane cannot edit, and a Save button that
 * saves only one of the two fields is a control that lies. It arrives with the
 * change that can touch those components.
 */
const SETTINGS_HOME = '/settings/preferences';

export default function EditProfilePage(): JSX.Element {
  const auth = useAuth();
  const profile = useOwnProfile();
  const [nameDirty, setNameDirty] = useState(false);
  const [handleDirty, setHandleDirty] = useState(false);
  /** Where the intercepted tap was heading, so Discard finishes that trip
   *  rather than always falling back to the settings list. */
  const [pendingExit, setPendingExit] = useState<string | null>(null);

  const dirty = nameDirty || handleDirty;

  /**
   * The exits the BROWSER owns rather than this app: reload, tab close, and
   * navigation to another origin. `beforeunload` is the only hook the platform
   * gives for those, and it shows the browser's own wording — not the
   * "Discard changes?" dialog below — so this is a second, coarser guard, not
   * the same one reused.
   *
   * ponytail: in-app browser/hardware Back is still NOT intercepted. The App
   * Router exposes no navigation guard, and the usual workaround — pushing a
   * sentinel history entry and cancelling on `popstate` — corrupts the back
   * stack for every other screen in the stack and breaks the one-level-back
   * contract the operator settled on 2026-09-01. Closing that gap properly
   * needs a router-level guard (or Next's `unstable_useNavigationGuard` once
   * it stabilises), which is a change to routing this lane does not own. The
   * gap is recorded rather than papered over: this comment is the honest
   * statement that the guard is partial.
   */
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers require a returnValue to show the prompt at all.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** The one gate every exit from this screen passes through. Returns whether
   *  the navigation may proceed. */
  const guardExit = (href: string): boolean => {
    if (!dirty) return true;
    setPendingExit(href);
    return false;
  };

  return (
    <main className="min-h-screen">
      <StackHeader
        title="Edit profile"
        backHref={SETTINGS_HOME}
        onBack={() => guardExit(SETTINGS_HOME)}
      />

      <div className="max-w-md mx-auto px-4 py-5 space-y-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {auth.status === 'signed-in' ? (
          <>
            <Group label="Photo">
              <StatusRow
                label="Profile photo"
                value="Not on this build"
                description="Next Bar doesn't store profile photos yet — your avatar is generated from your username. Uploading arrives with the storage that keeps it."
              />
            </Group>

            <div onInput={() => setNameDirty(true)}>
              <Group label="Display name">
                <SlotRow>
                  {profile.known ? (
                    <DisplayNameEditor
                      userId={auth.user.id}
                      initialName={profile.displayName}
                      onSaved={(name) => {
                        profile.setDisplayName(name);
                        setNameDirty(false);
                      }}
                    />
                  ) : (
                    <p className="text-muted text-sm">Loading…</p>
                  )}
                </SlotRow>
              </Group>
            </div>

            <div onInput={() => setHandleDirty(true)}>
              <UsernameGroup
                known={profile.known}
                handle={profile.handle}
                onClaimed={(handle) => {
                  profile.setHandle(handle);
                  setHandleDirty(false);
                }}
              />
            </div>
          </>
        ) : (
          <SignedOutProfileGroup />
        )}

        <VibeProfileGroup onNavigate={guardExit} />
      </div>

      {pendingExit ? (
        <DiscardChangesDialog
          onKeepEditing={() => setPendingExit(null)}
          backHref={pendingExit}
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

/**
 * Quiz-derived, never hand-edited: VIEW, retake, or clear (V8-R-ACC-004).
 *
 * "View or retake" is the requirement's own title, and the view half was
 * missing: the row said only "Your quiz answers are saved" and its one link
 * started a NEW quiz. The saved profile — archetype, tags, neighborhoods —
 * was on the device the whole time and unreachable, so the footnote promised
 * a view the screen did not have. It reads that profile out now.
 *
 * Still no text field: the profile is DERIVED, and the only way to change it
 * is to answer the questions again. That is the exclusion the ledger states.
 */
function VibeProfileGroup({
  onNavigate,
}: {
  onNavigate: (href: string) => boolean;
}): JSX.Element {
  const [vibe, setVibe] = useState<ReturnType<typeof loadProfile>>(null);

  useEffect(() => {
    setVibe(loadProfile());
  }, []);

  const handleClear = () => {
    if (
      !window.confirm(
        'Clear your saved vibe profile? You can retake the quiz anytime.',
      )
    )
      return;
    clearProfile();
    setVibe(null);
  };

  return (
    <Group
      label="Vibe profile"
      footnote="Your vibe profile is derived from the quiz. View or retake the quiz — it is not rewritten by hand here."
    >
      {vibe ? (
        <SlotRow>
          <p className="font-display text-lg">{vibe.archetype}</p>
          {vibe.tags.length > 0 ? (
            <p className="text-sm text-muted leading-relaxed">
              {vibe.tags.join(' · ')}
            </p>
          ) : null}
          {vibe.preferredNeighborhoods.length > 0 ? (
            <p className="text-xs text-muted leading-relaxed">
              Neighborhoods: {vibe.preferredNeighborhoods.join(', ')}
            </p>
          ) : null}
          <p className="text-xs text-muted">
            Saved {new Date(vibe.savedAt).toLocaleDateString()}
          </p>
        </SlotRow>
      ) : (
        <SlotRow>
          <p className="text-sm">No vibe profile yet.</p>
        </SlotRow>
      )}
      <LinkRow
        href="/quiz"
        label={vibe ? 'Retake the quiz' : 'Take the quiz'}
        onNavigate={() => onNavigate('/quiz')}
      />
      {vibe ? (
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
