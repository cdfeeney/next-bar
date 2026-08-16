'use client';

/**
 * NotificationPreferences — Settings section for the four V8-4 Night Out
 * push event types (migration 0051). A missing `notification_preferences`
 * row means "never touched this screen" — the RPC's own documented default
 * is all four ON, so a read failure or a missing row both fall back to that
 * same default rather than silently going dark.
 *
 * Deliberately does NOT request iOS permission on mount — that would be the
 * exact anti-pattern the PRD calls out (asking before the user has done
 * anything push-worthy). The optional "Enable on this device" button is the
 * only explicit trigger this component owns; the other trigger lives in
 * night-out/[token]/page.tsx, fired after a real invite/accept action.
 */

import { useEffect, useState } from 'react';
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
// order (0051 set_notification_preferences), so there is one vocabulary
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

type PrefRow = {
  invited: boolean | null;
  accepted: boolean | null;
  bar_suggested: boolean | null;
  plan_changed: boolean | null;
};

export default function NotificationPreferences(): JSX.Element {
  const auth = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<PrefKey | null>(null);
  const [nativeBusy, setNativeBusy] = useState(false);
  const [nativeResult, setNativeResult] = useState<NativePushResult | null>(null);

  useEffect(() => {
    if (auth.status !== 'signed-in') return;
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
      .eq('user_id', auth.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || getCacheEpoch() !== epoch) return;
        const row = !error ? (data as PrefRow | null) : null;
        setPrefs(
          row === null
            ? DEFAULT_PREFS
            : {
                invited: row.invited ?? true,
                accepted: row.accepted ?? true,
                bar_suggested: row.bar_suggested ?? true,
                plan_changed: row.plan_changed ?? true,
              },
        );
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  const handleToggle = async (key: PrefKey): Promise<void> => {
    if (auth.status !== 'signed-in' || busyKey !== null) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const previous = prefs;
    const next: Prefs = { ...prefs, [key]: !prefs[key] };
    const epoch = getCacheEpoch();
    setSaveError(null);
    setBusyKey(key);
    setPrefs(next); // optimistic — reverted below on failure
    const { data, error } = await supabase.rpc('set_notification_preferences', {
      p_invited: next.invited,
      p_accepted: next.accepted,
      p_bar_suggested: next.bar_suggested,
      p_plan_changed: next.plan_changed,
    });
    if (getCacheEpoch() !== epoch) return;
    setBusyKey(null);
    if (error || data !== true) {
      setPrefs(previous);
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
        {!loaded ? (
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
                  disabled={busyKey === key}
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
