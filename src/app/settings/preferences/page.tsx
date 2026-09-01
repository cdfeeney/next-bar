'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import InstallPrompt from '@/components/InstallPrompt';
import { OperationalState } from '@/components/states/OperationalState';
import { useOperationalLoad } from '@/components/states/useOperationalLoad';
import { useAuth } from '@/hooks/useAuth';
import { useFollowRequests } from '@/hooks/useFollowRequests';
import { useFollows } from '@/hooks/useFollows';
import { useRatings } from '@/hooks/useRatings';
import { getCacheEpoch } from '@/lib/accountCache';
import { clearSampleNight, isDemoSeeded, seedSampleNight } from '@/lib/demo';
import { listBlockedProfiles } from '@/lib/moderation/blocks';
import { setOwnPrivacy } from '@/lib/profile.server';
import { loadProfile } from '@/lib/storedProfile';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { signOutAndRevokePush } from '../_signOut';
import {
  ButtonRow,
  Group,
  LinkRow,
  SlotRow,
  StackHeader,
  StatusRow,
  SwitchRow,
} from '../_ui';
import { useOwnProfile } from '../_useOwnProfile';

/**
 * Settings home — the gear route (approved/next-bar-account-a-settings.png,
 * screen 2), and the five grouped sections V8-R-ACC-005 names: Profile,
 * Connections, Privacy & sharing, Notifications, Security & account.
 *
 * A predictable grouped list, not an expressive surface: personality lives on
 * the Account root, and every row states its current value so the list answers
 * "what is this set to?" without opening anything. Back returns to Account.
 * Help, Privacy policy and Terms sit below the fold, deliberately last.
 *
 * WHERE A ROW STATES A VALUE IT CANNOT CHANGE. The approved reference draws
 * switches and audience pickers whose persistence does not exist in this repo:
 * there is no stored default story or pin audience (V8-R-ACC-007), no tag
 * consent column (V8-R-ACC-008) and no notification preference table or push
 * sender (V8-R-ACC-010) on any migration in `supabase/migrations`, and this
 * lane mints none. A switch that silently forgets is a fallback presented as a
 * success, which V8-R-OPS-001 forbids outright — so those rows are `StatusRow`
 * and say what is actually true today. They become controls in the same change
 * that adds their storage, not before.
 *
 * WHICH CHANGE THAT IS, so this is a dependency rather than an open question:
 * the operator ruled on 2026-09-01 that the preference columns and their RLS
 * belong to a separate T0 migration goal, `0078_account_preferences`. This lane
 * CONSUMES it and does not create it. As of this commit no `0078_*` file exists
 * in `supabase/migrations` (the head here is `0075`), so the rows stay
 * statements. Three requirements are held open by exactly that one file:
 * V8-R-ACC-007, V8-R-ACC-008 and V8-R-ACC-010.
 */
export default function SettingsHomePage(): JSX.Element {
  const auth = useAuth();
  const { ratings } = useRatings();
  const { mutuals } = useFollows();
  const { requests } = useFollowRequests();
  const profile = useOwnProfile();

  return (
    <main className="min-h-screen">
      <StackHeader title="Settings" backHref="/settings" />

      <div className="max-w-md mx-auto px-4 py-5 space-y-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <ProfileGroup
          displayName={profile.displayName}
          handle={profile.handle}
          ratingsCount={ratings.length}
        />

        <ConnectionsGroup
          friendCount={mutuals.length}
          pendingCount={requests.length}
          signedIn={auth.status === 'signed-in'}
        />

        <PrivacyGroup
          profile={profile}
          authStatus={auth.status}
          userId={auth.status === 'signed-in' ? auth.user.id : null}
        />

        <NotificationsGroup />

        <Group label="Security & account">
          <LinkRow
            href="/settings/security"
            label="Email & password"
            value={auth.status === 'signed-in' ? 'Verified' : 'Signed out'}
          />
          {auth.status === 'signed-in' ? (
            // V8-R-ACC-011 makes revoking this installation's notification
            // token part of signing out, so both live behind one helper.
            <ButtonRow
              label="Sign out"
              onClick={() => void signOutAndRevokePush(auth.signOut)}
            />
          ) : null}
        </Group>

        {/* V8-R-ACC-005 fixes the list at FIVE sections, then "Help, Privacy
            policy and Terms sit below the fold, deliberately last". The
            install prompt and the sample night used to sit in a sixth primary
            "App" section between Security & account and Help, which the
            approved structure does not admit — and the heading test only
            checked the first five and the last, so nothing caught it. They are
            below-the-fold utilities, so they live in the below-the-fold group
            rather than inventing a section for themselves. */}
        <Group label="Help">
          <AppRows ratingsCount={ratings.length} />
          <LinkRow
            href="mailto:hi@next-bar.app?subject=Bar+correction"
            label="Tell us if something's wrong"
          />
          <LinkRow href="/privacy" label="Privacy policy" />
          <LinkRow href="/terms" label="Terms of use" />
        </Group>

        <div className="text-xs text-muted space-y-1 px-1">
          <p>Next Bar · NYC · 2026</p>
          <p>
            Coverage: Manhattan and parts of Brooklyn. More neighborhoods
            rolling out.
          </p>
          <p>Hours and specials are best-effort.</p>
        </div>
      </div>
    </main>
  );
}

/** Profile rows (V8-R-ACC-004, V8-R-ACC-006). The vibe-profile value re-reads
 *  after a clear-ratings wipe, which also clears the stored quiz answers. */
function ProfileGroup({
  displayName,
  handle,
  ratingsCount,
}: {
  displayName: string | null;
  handle: string | null;
  ratingsCount: number;
}): JSX.Element {
  const [hasVibeProfile, setHasVibeProfile] = useState(false);

  useEffect(() => {
    setHasVibeProfile(loadProfile() !== null);
  }, [ratingsCount]);

  return (
    <Group label="Profile">
      <LinkRow
        href="/settings/profile"
        label="Edit profile"
        value={displayName ?? (handle !== null ? `@${handle}` : undefined)}
      />
      {/* /quiz is load-bearing and kept: the vibe profile is derived from it,
          never hand-edited. */}
      <LinkRow
        href="/quiz"
        label="Vibe profile"
        value={hasVibeProfile ? 'From quiz' : 'Not taken'}
      />
    </Group>
  );
}

/**
 * Connections (V8-R-ACC-009). Both rows carry their count on the list itself,
 * which is the requirement's accessibility line. Blocked & muted is here —
 * under Connections, a relationship surface — and deliberately NOT under
 * Privacy & sharing, where it would read as a sharing default.
 */
function ConnectionsGroup({
  friendCount,
  pendingCount,
  signedIn,
}: {
  friendCount: number;
  pendingCount: number;
  signedIn: boolean;
}): JSX.Element {
  /**
   * THE SHARED HOOK, not a hand-rolled copy of half of it.
   *
   * The first fix for the unexplained em dash added a `failed` flag and a
   * Retry, which named the failure but skipped the rest of the policy: the
   * three SILENT auto-retries and the refresh on reconnect that
   * V8-R-OPS-001 requires. One transient blip therefore asked the user to fix
   * it. `useOperationalLoad` is this lane's own module and already applies the
   * whole rule, so using it is both smaller and more correct than the flag it
   * replaces.
   *
   * The loader returns `null` for a failed read, which is the hook's own
   * convention for "it did not work"; a successful EMPTY list is `[]`, not
   * null, so "you have blocked nobody" is never inferred from a broken lookup.
   * The epoch guard stays: an identity change mid-fetch must not repopulate
   * the next account's view.
   */
  const load = useCallback(async (): Promise<number | null> => {
    if (!signedIn) return null;
    const epoch = getCacheEpoch();
    const result = await listBlockedProfiles(getBrowserSupabase());
    if (getCacheEpoch() !== epoch || !result.ok) return null;
    return result.value.length;
  }, [signedIn]);

  const blocked = useOperationalLoad(load);
  const blockedCount = signedIn ? blocked.value : null;
  const failed = signedIn && blocked.state === 'failed';

  const rows = (
    <Group label="Connections">
      <LinkRow
        href="/friends"
        label="Friends & requests"
        value={`${friendCount} · ${pendingCount} pending`}
      />
      <LinkRow
        href="/settings/connections/blocked"
        label="Blocked & muted"
        value={blockedCount === null ? '—' : `${blockedCount}`}
      />
    </Group>
  );

  if (!failed) return rows;
  // The rows stay — the Friends count is still true, and the destination is
  // still reachable. Only the failed READ is reported, with one recovery, and
  // only once the hook's silent budget is spent.
  return (
    <OperationalState
      kind="failed"
      message="We couldn't load your blocked list, so that count is missing."
      recovery={{ label: 'Retry', onAction: blocked.retry }}
    >
      {rows}
    </OperationalState>
  );
}

/**
 * Privacy & sharing.
 *
 * ONE backed setting today: the private-account switch. The two sharing
 * defaults (V8-R-ACC-007) and the tag consent switches (V8-R-ACC-008) have no
 * column, table or RPC anywhere in this repo, so they are stated rather than
 * offered — see the file header. What they state is the behaviour that
 * actually runs: `publish_story` takes its audience per post and defaults to
 * friends, and a tagged person can always remove their own tag, which is
 * enforced independently of any consent switch.
 */
function PrivacyGroup({
  profile,
  authStatus,
  userId,
}: {
  profile: ReturnType<typeof useOwnProfile>;
  authStatus: ReturnType<typeof useAuth>['status'];
  userId: string | null;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  /**
   * The last write was rejected by the server.
   *
   * The revert alone was the defect: the switch flipped back on its own and
   * said nothing, so the only signal that a SETTING DID NOT SAVE was a control
   * moving by itself — which reads as a UI glitch, not as a refusal, and
   * leaves the user believing whichever position they last saw. A silent
   * revert is a fallback presented as a success, which V8-R-OPS-001 forbids by
   * name.
   */
  const [saveFailed, setSaveFailed] = useState(false);

  /**
   * A FAILURE BELONGS TO THE IDENTITY THAT PRODUCED IT.
   *
   * Signing out on this same page left the message standing over an account
   * the screen no longer had: `profile.isPrivate` resets to null, which reads
   * as "public", so it said "your account is still public" about nobody, with
   * a Try again that silently no-ops because `userId` is null. The same
   * missing reset stranded `busy` at true when an identity change landed
   * mid-write (the epoch guard returns before `setBusy(false)`), leaving the
   * switch permanently disabled.
   */
  useEffect(() => {
    setSaveFailed(false);
    setBusy(false);
  }, [userId]);

  const handleToggle = useCallback(async () => {
    if (busy || userId === null || profile.isPrivate === null) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const next = !profile.isPrivate;
    // Optimistic flip with revert — the server response is authoritative. The
    // epoch guard stops an identity change mid-write from reverting user A's
    // value into user B's view.
    const epoch = getCacheEpoch();
    profile.setIsPrivate(next);
    setBusy(true);
    setSaveFailed(false);
    const ok = await setOwnPrivacy(supabase, userId, next);
    if (getCacheEpoch() !== epoch) return;
    setBusy(false);
    if (!ok) {
      profile.setIsPrivate(!next);
      setSaveFailed(true);
    }
  }, [busy, profile, userId]);

  const canTogglePrivacy =
    authStatus === 'signed-in'
    && userId !== null
    && profile.isPrivate !== null
    && profile.consentLive;

  return (
    <Group label="Privacy & sharing">
      {canTogglePrivacy ? (
        <>
          <SwitchRow
            label="Private account"
            description={
              profile.isPrivate
                ? 'New followers must send a request you approve. People who already follow you keep access.'
                : 'Anyone can follow you and your username appears in search.'
            }
            checked={profile.isPrivate === true}
            busy={busy}
            onChange={() => void handleToggle()}
          />
          {/* INSIDE the guard, so it cannot outlive the account it is about.
              The switch has already flipped back by the time this renders:
              say WHY, so the revert reads as the server's refusal it is
              rather than a glitch, and offer the same action again — which is
              reachable here precisely because the guard that renders it is the
              one that makes `handleToggle` able to do anything. */}
          {saveFailed ? (
            <SlotRow>
              <p className="text-red-400 text-xs leading-relaxed" role="status">
                We couldn&apos;t save that change, so your account is still{' '}
                {profile.isPrivate ? 'private' : 'public'}.
              </p>
              <button
                type="button"
                onClick={() => void handleToggle()}
                disabled={busy}
                className="w-full min-h-[44px] rounded-full bg-surface border border-border text-text font-display text-sm touch-manipulation disabled:opacity-40"
              >
                Try again
              </button>
            </SlotRow>
          ) : null}
        </>
      ) : null}
      <StatusRow
        label="Default story audience"
        value="Friends"
        description="Chosen on the post itself. This build stores no separate default, so every story starts at Friends and the audience is confirmed when you share."
      />
      <StatusRow
        label="Default pin audience"
        value="Friends"
        description="A separate setting from the story audience, and never changed by it. Like stories, it is confirmed at the moment of sharing on this build."
      />
      <StatusRow
        label="Tags & mentions"
        value="Always removable"
        description="Anyone you tag can remove themselves from the story, and that is enforced whatever the consent switches say. The switches themselves need per-account storage this build does not have."
      />
    </Group>
  );
}

/**
 * Notifications (V8-R-ACC-010).
 *
 * The three categories the requirement names are listed, and each says what is
 * true: nothing is delivered. There is no push sender anywhere in `src/`, no
 * notification preference storage on any migration, and the APNs work is a
 * separate blocked goal. A switch here would persist to nowhere and be read by
 * nobody.
 *
 * The one rule this DOES satisfy today, and must keep satisfying: the iOS
 * permission is never requested on first launch. Nothing in this build asks
 * for it at all.
 */
function NotificationsGroup(): JSX.Element {
  return (
    <Group
      label="Notifications"
      footnote="Next Bar does not send push notifications yet. When it does, these become per-account settings, and iOS is asked for permission only after you send or accept an invitation — never on first launch."
    >
      <StatusRow
        label="Plans"
        value="Not delivered yet"
        description="Invitations, acceptances, suggested bars and plan changes. Invitations are recorded on the plan and readable in the app today."
      />
      <StatusRow
        label="Tags & stories"
        value="Not delivered yet"
        description="Being tagged in a story, and replies to your own."
      />
      <StatusRow
        label="Group activity"
        value="Not delivered yet"
        description="Group messages are in-app unread state only, by design: V8 sends no push for an ordinary group message."
      />
    </Group>
  );
}

/**
 * Install prompt + the demo sample night. Self-contained: the seeded flag is
 * read and written only here, so it stays out of the settings list itself.
 * `ratingsCount` re-reads the flag after a clear-ratings wipe, which also
 * removes the sample night.
 */
function AppRows({ ratingsCount }: { ratingsCount: number }): JSX.Element {
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    setSeeded(isDemoSeeded());
  }, [ratingsCount]);

  return (
    <>
      <SlotRow>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted leading-relaxed">
            Add Next Bar to your home screen for the full app experience.
          </p>
          <InstallPrompt />
        </div>
      </SlotRow>
      <SlotRow>
        <p className="text-xs text-muted leading-relaxed">
          Load a sample night of ratings to see Rankings and the group
          &ldquo;Where should we go?&rdquo; picks come alive — no sign-in
          needed.
        </p>
        {seeded ? (
          <div className="flex items-center gap-4 flex-wrap">
            <Link
              href="/rankings"
              className="inline-flex items-center justify-center bg-accent text-bg font-display text-sm px-5 py-2 rounded-full min-h-[44px] touch-manipulation"
            >
              View rankings →
            </Link>
            <button
              type="button"
              onClick={() => {
                clearSampleNight();
                setSeeded(false);
              }}
              className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
            >
              Remove sample night
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              seedSampleNight();
              setSeeded(true);
            }}
            className="inline-flex items-center justify-center bg-accent text-bg font-display text-sm px-5 py-2 rounded-full min-h-[44px] touch-manipulation"
          >
            Load sample night →
          </button>
        )}
      </SlotRow>
    </>
  );
}
