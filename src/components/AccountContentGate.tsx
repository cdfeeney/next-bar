'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  ACCOUNT_CONTENT_KEYS,
  type AccountContentKey,
} from '@/lib/accountContent.local';
import { ACCOUNT_CONTENT_LABELS } from '@/lib/accountContent.labels';
import {
  ACCOUNT_CONTENT_QUARANTINE_KEY,
  getPendingForeign,
  listResolutionRequired,
  readQuarantinedAccountContent,
  resolvePendingForeign,
} from '@/lib/accountContent.quarantine';
import {
  ensureAccountContentReady,
  invalidateAccountContentReadiness,
} from '@/lib/accountContent.ready';
import { subscribeAccountContentContext } from '@/lib/accountContent.context';
import {
  listAccountContentTooLargeKeys,
  wasAccountContentAuthRejected,
  wasAccountContentClockRejected,
} from '@/lib/accountContent.capability';
import {
  resolveAccountContentConflict,
  type ConflictChoice,
} from '@/lib/accountContentSync';

/**
 * AccountContentGate — resolution UI for the preservation machinery (v2.1).
 *
 * Renders nothing in the happy path. Three surfaces, none of which ever
 * blocks sign-in or unrelated app features:
 *
 *  1. Foreign-residue dialog (blocking for account-content only): another
 *     account's content was found on this device — it is already safely
 *     quarantined under its owner; the current user chooses Keep-it-for-them
 *     or Delete-permanently.
 *  2. Conflict dialog: a restore found the device copy losing LWW without
 *     ever being server-confirmed. Use device version / Keep account
 *     version / Decide later.
 *  3. Status banners: resolution-required (preserved, needs a human) and
 *     auth-rejected (surfaced, never blindly retried).
 */
export default function AccountContentGate(): JSX.Element | null {
  const auth = useAuth();
  const [storeEpoch, setStoreEpoch] = useState(0);
  const [deferred, setDeferred] = useState<ReadonlySet<AccountContentKey>>(
    () => new Set(),
  );
  const [busy, setBusy] = useState(false);

  const readiness = useSyncExternalStore(
    subscribeAccountContentContext,
    () => {
      const r = ensureAccountContentReady();
      return r.status === 'blocked' ? `blocked:${r.reason}` : 'ready';
    },
    () => 'blocked:auth-unknown' as const,
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === ACCOUNT_CONTENT_QUARANTINE_KEY || event.key === null) {
        setStoreEpoch((n) => n + 1);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const signedIn = auth.status === 'signed-in';
  const userId = signedIn ? auth.user.id : null;

  const resolveForeign = useCallback((choice: 'keep' | 'delete'): void => {
    if (
      choice === 'delete' &&
      !window.confirm(
        "Delete the other account's saved content from this device permanently? This cannot be undone.",
      )
    ) {
      return;
    }
    resolvePendingForeign(choice);
    invalidateAccountContentReadiness();
    setStoreEpoch((n) => n + 1);
  }, []);

  const resolveConflict = useCallback(
    async (key: AccountContentKey, choice: ConflictChoice): Promise<void> => {
      if (!userId) return;
      if (choice === 'later') {
        setDeferred((prev) => new Set(prev).add(key));
        return;
      }
      const supabase = getBrowserSupabase();
      if (!supabase) return;
      setBusy(true);
      try {
        await resolveAccountContentConflict({
          supabase,
          userId,
          key,
          choice,
          stillCurrent: () => true,
        });
      } finally {
        setBusy(false);
        setStoreEpoch((n) => n + 1);
      }
    },
    [userId],
  );

  // storeEpoch keys the re-reads below; reference keeps the dep honest.
  void storeEpoch;

  const pendingForeign = signedIn ? getPendingForeign() : null;
  const showForeignDialog =
    signedIn && readiness === 'blocked:foreign-residue' && pendingForeign !== null;

  const conflicts: AccountContentKey[] = userId
    ? ACCOUNT_CONTENT_KEYS.filter(
        (key) =>
          readQuarantinedAccountContent(userId)[key]?.status === 'conflict' &&
          !deferred.has(key),
      )
    : [];
  const activeConflict = conflicts[0] ?? null;

  const resolutionRequired = listResolutionRequired().length > 0;
  const authRejected = signedIn && wasAccountContentAuthRejected();
  const clockRejected = signedIn && wasAccountContentClockRejected();
  const tooLargeLabels = signedIn
    ? listAccountContentTooLargeKeys()
        .filter((key): key is AccountContentKey =>
          (ACCOUNT_CONTENT_KEYS as readonly string[]).includes(key),
        )
        .map((key) => ACCOUNT_CONTENT_LABELS[key])
    : [];

  if (
    !showForeignDialog &&
    !activeConflict &&
    !resolutionRequired &&
    !authRejected &&
    !clockRejected &&
    tooLargeLabels.length === 0
  ) {
    return null;
  }

  return (
    <>
      {showForeignDialog ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Another account's saved content"
          data-testid="foreign-residue-dialog"
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 pb-24"
        >
          <div className="bg-surface border border-border rounded-3xl p-6 max-w-sm w-full">
            <h2 className="font-display text-xl mb-2">
              Another account&apos;s saved content is on this device
            </h2>
            <p className="text-muted text-sm mb-5 leading-relaxed">
              It has been set aside safely and is not visible to you. Keep it
              for when they sign back in, or delete it permanently. Your own
              account is unaffected either way.
            </p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => resolveForeign('keep')}
                className="bg-accent text-bg rounded-full px-6 py-3 min-h-[48px] touch-manipulation font-display"
              >
                Keep it for them
              </button>
              <button
                type="button"
                onClick={() => resolveForeign('delete')}
                className="border border-border text-muted rounded-full px-6 py-3 min-h-[48px] touch-manipulation font-display hover:text-text"
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeConflict && !showForeignDialog ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Two versions of your content"
          data-testid={`content-conflict-dialog-${activeConflict}`}
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 pb-24"
        >
          <div className="bg-surface border border-border rounded-3xl p-6 max-w-sm w-full">
            <h2 className="font-display text-xl mb-2">
              Two versions of {ACCOUNT_CONTENT_LABELS[activeConflict]}
            </h2>
            <p className="text-muted text-sm mb-5 leading-relaxed">
              This device holds a version that never synced, and your account
              has a newer one. Nothing has been deleted — choose which to
              keep, or decide later.
            </p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void resolveConflict(activeConflict, 'use-device')}
                className="bg-accent text-bg rounded-full px-6 py-3 min-h-[48px] touch-manipulation font-display disabled:opacity-60"
              >
                Use device version
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void resolveConflict(activeConflict, 'keep-account')}
                className="border border-border rounded-full px-6 py-3 min-h-[48px] touch-manipulation font-display disabled:opacity-60"
              >
                Keep account version
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void resolveConflict(activeConflict, 'later')}
                className="text-muted text-sm min-h-[44px] touch-manipulation underline-offset-4 hover:underline"
              >
                Decide later
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resolutionRequired ? (
        <p
          role="status"
          data-testid="content-resolution-banner"
          className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] inset-x-4 z-[60] bg-surface border border-border rounded-2xl px-4 py-3 text-xs text-muted text-center"
        >
          Some saved content needs attention — nothing has been deleted.
        </p>
      ) : null}

      {authRejected && !resolutionRequired ? (
        <p
          role="status"
          data-testid="content-auth-rejected-banner"
          className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] inset-x-4 z-[60] bg-surface border border-border rounded-2xl px-4 py-3 text-xs text-muted text-center"
        >
          Account sync was rejected — try signing out and back in.
        </p>
      ) : null}

      {clockRejected && !resolutionRequired && !authRejected ? (
        <p
          role="status"
          data-testid="content-clock-rejected-banner"
          className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] inset-x-4 z-[60] bg-surface border border-border rounded-2xl px-4 py-3 text-xs text-muted text-center"
        >
          This device&apos;s clock looks wrong — content can&apos;t sync until
          it&apos;s corrected. Nothing has been lost.
        </p>
      ) : null}

      {tooLargeLabels.length > 0 &&
      !resolutionRequired &&
      !authRejected &&
      !clockRejected ? (
        <p
          role="status"
          data-testid="content-too-large-banner"
          className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] inset-x-4 z-[60] bg-surface border border-border rounded-2xl px-4 py-3 text-xs text-muted text-center"
        >
          Too large to sync: {tooLargeLabels.join(', ')}. It stays safe on this
          device.
        </p>
      ) : null}
    </>
  );
}
