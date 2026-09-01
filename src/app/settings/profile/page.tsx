'use client';

import { useEffect, useState } from 'react';
import ClaimHandle from '@/components/ClaimHandle';
import DisplayNameEditor from '@/components/DisplayNameEditor';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
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
 */
export default function EditProfilePage(): JSX.Element {
  const auth = useAuth();
  const profile = useOwnProfile();

  return (
    <main className="min-h-screen">
      <StackHeader title="Edit profile" backHref="/settings/preferences" />

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

            <Group label="Display name">
              <SlotRow>
                {profile.known ? (
                  <DisplayNameEditor
                    userId={auth.user.id}
                    initialName={profile.displayName}
                    onSaved={profile.setDisplayName}
                  />
                ) : (
                  <p className="text-muted text-sm">Loading…</p>
                )}
              </SlotRow>
            </Group>

            <UsernameGroup
              known={profile.known}
              handle={profile.handle}
              onClaimed={profile.setHandle}
            />
          </>
        ) : (
          <SignedOutProfileGroup />
        )}

        <VibeProfileGroup />
      </div>
    </main>
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
