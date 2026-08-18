'use client';

/**
 * NotificationPreferences — Settings section for the four V8-4 Night Out
 * push event types (migration 0060). A missing `notification_preferences`
 * row means "never touched this screen" — the RPC's own documented default is
 * all four ON, so a missing ROW renders the four defaults.
 *
 * A FAILED READ IS NOT A MISSING ROW. It used to render those same defaults,
 * and because a toggle writes ALL FOUR columns, one user tapping one switch
 * during a database blip silently re-enabled every opt-out they had saved.
 * An unreadable answer now renders an error and no toggles at all: there is
 * nothing safe to write on top of state we never read.
 *
 * Deliberately does NOT request iOS permission on mount — that would be the
 * exact anti-pattern the PRD calls out (asking before the user has done
 * anything push-worthy). The optional "Enable on this device" button is the
 * only explicit trigger this component owns; the other trigger lives in
 * night-out/[token]/page.tsx, fired after a real invite/accept action.
 */

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch } from '@/lib/accountCache';
import {
  isNativePushAvailable,
  markPromptedForNativePush,
  registerNativePush,
  type NativePushResult,
} from '@/lib/nativePush';

type PrefKey = 'invited' | 'accepted' | 'bar_suggested' | 'plan_changed';
type Prefs = Record<PrefKey, boolean>;

const DEFAULT_PREFS: Prefs = {
  invited: true,
  accepted: true,
  bar_suggested: true,
  plan_changed: true,
};

// Fixed order the four toggles render in — matches the RPC's own parameter
// order (0060 set_notification_preferences), so there is one vocabulary
// rather than a UI order that can drift from the write path.
/**
 * The section is a labelled landmark, not a bare div. Two reasons, and the
 * second is what caught it: a screen-reader user gets a navigable region
 * instead of loose content, and every assertion about "the notification
 * toggles" can scope to it. Unscoped, `getByRole('switch')` also matches the
 * Privacy toggle elsewhere on this page and `getByRole('alert')` also matches
 * Next's route announcer — both produced e2e failures that looked like product
 * bugs and were not.
 */
const HEADING_ID = 'notification-preferences-heading';

const PREF_ORDER: PrefKey[] = ['invited', 'accepted', 'bar_suggested', 'plan_changed'];

const PREF_LABELS: Record<PrefKey, string> = {
  invited: 'When someone invites you to a Night Out',
  accepted: 'When someone accepts your invitation',
  bar_suggested: 'When someone suggests a bar',
  plan_changed: 'When the plan changes',
};

const NATIVE_RESULT_MESSAGE: Partial<Record<NativePushResult, string>> = {
  'permission-denied':
    "Notifications are off for Next Bar in iOS Settings — turn them on there, then try again.",
  unsupported: 'Not available on this device.',
  failed: "Couldn't enable notifications — try again in a moment.",
};

/**
   * A loaded answer and the account it belongs to, indivisible. `status`
   * distinguishes "these are their real preferences" from "we could not read
   * them", which must never render as the defaults.
   */
type Snapshot =
  | { readonly userId: string; readonly status: 'loaded'; readonly prefs: Prefs }
  | { readonly userId: string; readonly status: 'error' };

type PrefRow = {
  invited: boolean | null;
  accepted: boolean | null;
  bar_suggested: boolean | null;
  plan_changed: boolean | null;
};

export default function NotificationPreferences(): JSX.Element {
  const auth = useAuth();
  // WHOSE preferences these are, not merely THAT some were loaded. A boolean
  // could only be corrected by an effect, and an effect runs AFTER the render
  // that already showed the previous account's toggles as loaded — one tap in
  // that window wrote their values into the new account's row. Comparing the
  // owner makes an account switch take effect in the same render.
  //
  // The owner and the VALUES are one piece of state for the same reason. While
  // they were separate, the effect reset the values on every account change
  // but left the owner alone, so signing out and back into the SAME account
  // rendered all-ON defaults as that account's loaded preferences — and one
  // tap wrote those fabricated defaults over their real opt-outs. They can
  // only be written together now, so they cannot disagree.
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /**
   * The in-flight save, tagged with a sequence number so only the save that
   * set it can clear it. A save that resolved after the account changed used
   * to clear whatever flag it found, releasing the NEW account's guard and
   * letting two whole-row writes overlap.
   */
  const [busy, setBusy] = useState<{ key: PrefKey; seq: number } | null>(null);
  const saveSeq = useRef(0);
  const [nativeBusy, setNativeBusy] = useState(false);
  const [nativeResult, setNativeResult] = useState<NativePushResult | null>(null);

  const userId = auth.status === 'signed-in' ? auth.user.id : null;
  const mine = snapshot !== null && snapshot.userId === userId ? snapshot : null;
  const loaded = mine?.status === 'loaded';
  const loadError = mine?.status === 'error';
  const prefs = mine?.status === 'loaded' ? mine.prefs : DEFAULT_PREFS;

  useEffect(() => {
    // Keyed on the USER, not just the status: a switch from one signed-in user
    // straight to another used not to refetch at all. Nothing here is
    // load-bearing for correctness — `loaded`, `loadError` and `prefs` all
    // come from the owner-tagged snapshot above, so they are already right in
    // the first render after a change.
    setSaveError(null);
    // These DO depend on the effect: a save or a device registration still in
    // flight when the account changed left its busy flag set, and every later
    // tap was silently dropped by the busy guard until a remount.
    setBusy(null);
    setNativeBusy(false);
    setNativeResult(null);
    if (userId === null) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let cancelled = false;
    // Epoch guard (accountCache convention, used throughout settings/page.tsx):
    // a sign-out wipe mid-fetch must abandon the hydrate rather than
    // repopulate the next account's screen with this account's toggles.
    const epoch = getCacheEpoch();
    supabase
      .from('notification_preferences')
      .select('invited, accepted, bar_suggested, plan_changed')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || getCacheEpoch() !== epoch) return;
        if (error) {
          // Stay UNLOADED. Rendering toggles here would show fabricated
          // state, and the first tap would write it over the real row.
          setSnapshot({ userId, status: 'error' });
          return;
        }
        const row = data as PrefRow | null;
        setSnapshot({
          userId,
          status: 'loaded',
          prefs:
            row === null
              ? DEFAULT_PREFS
              : {
                  invited: row.invited ?? true,
                  accepted: row.accepted ?? true,
                  bar_suggested: row.bar_suggested ?? true,
                  plan_changed: row.plan_changed ?? true,
                },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleToggle = async (key: PrefKey): Promise<void> => {
    // `loaded` is the proof these four values came from the database, and it
    // is tied to the account they came from. Without it every write is built
    // from defaults nobody chose.
    if (userId === null || busy !== null || !loaded) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const previous = prefs;
    const next: Prefs = { ...prefs, [key]: !prefs[key] };
    const epoch = getCacheEpoch();
    const seq = (saveSeq.current += 1);
    setSaveError(null);
    setBusy({ key, seq });
    // Optimistic — reverted below on failure. Written against this account, so
    // a snapshot that has since moved on is left alone.
    setSnapshot({ userId, status: 'loaded', prefs: next });
    const { data, error } = await supabase.rpc('set_notification_preferences', {
      p_invited: next.invited,
      p_accepted: next.accepted,
      p_bar_suggested: next.bar_suggested,
      p_plan_changed: next.plan_changed,
    });
    // Cleared FIRST, and only if it is still OURS. Returning before clearing
    // left every toggle disabled for the next account on a page that stays
    // mounted across a sign-out; clearing unconditionally released a newer
    // account's guard and let two whole-row writes overlap.
    setBusy((current) => (current?.seq === seq ? null : current));
    if (getCacheEpoch() !== epoch) return;
    if (error || data !== true) {
      setSnapshot((current) =>
        current?.userId === userId && current.status === 'loaded'
          ? { userId, status: 'loaded', prefs: previous }
          : current,
      );
      setSaveError("That didn't save — try again.");
    }
  };

  const handleEnableNative = async (): Promise<void> => {
    if (auth.status !== 'signed-in' || nativeBusy) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setNativeBusy(true);
    const result = await registerNativePush(supabase);
    markPromptedForNativePush();
    setNativeBusy(false);
    setNativeResult(result);
  };

  if (auth.status !== 'signed-in') {
    return (
      <section aria-labelledby={HEADING_ID}>
        <h2
          id={HEADING_ID}
          className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3"
        >
          Notifications
        </h2>
        <div className="bg-surface border border-border rounded-3xl p-5">
          <p className="text-sm text-muted leading-relaxed">
            Sign in to choose which Night Out notifications you get.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby={HEADING_ID}>
      <h2
        id={HEADING_ID}
        className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3"
      >
        Notifications
      </h2>
      <div className="bg-surface border border-border rounded-3xl p-5 space-y-4">
        {loadError ? (
          <p className="text-accent text-sm" role="alert">
            Couldn&apos;t load your notification settings — reload to try again.
          </p>
        ) : !loaded ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : (
          <ul className="space-y-4">
            {PREF_ORDER.map((key) => (
              <li key={key} className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm">{PREF_LABELS[key]}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs[key]}
                  aria-label={PREF_LABELS[key]}
                  disabled={busy?.key === key}
                  onClick={() => void handleToggle(key)}
                  className={[
                    'shrink-0 relative w-12 h-7 rounded-full border transition-colors touch-manipulation disabled:opacity-50',
                    prefs[key] ? 'bg-accent border-accent' : 'bg-surface border-border',
                  ].join(' ')}
                >
                  <span
                    aria-hidden
                    className={[
                      'absolute top-0.5 w-5 h-5 rounded-full transition-all',
                      prefs[key] ? 'right-0.5 bg-bg' : 'left-0.5 bg-muted',
                    ].join(' ')}
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
        {saveError !== null ? (
          <p className="text-accent text-sm" role="alert">
            {saveError}
          </p>
        ) : null}
        {isNativePushAvailable() ? (
          <div className="pt-3 border-t border-border">
            <button
              type="button"
              onClick={() => void handleEnableNative()}
              disabled={nativeBusy}
              className="text-sm text-accent underline-offset-4 hover:underline min-h-[44px] touch-manipulation disabled:opacity-50"
            >
              {nativeBusy
                ? 'Enabling…'
                : nativeResult === 'registered'
                  ? 'Notifications enabled on this device'
                  : 'Enable on this device'}
            </button>
            {nativeResult !== null && nativeResult !== 'registered' ? (
              <p className="text-accent text-xs mt-1" role="alert">
                {NATIVE_RESULT_MESSAGE[nativeResult]}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
